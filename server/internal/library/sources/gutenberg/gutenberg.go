// Package gutenberg searches and imports Chinese and Japanese texts of
// Project Gutenberg. The catalog is pg_catalog.csv; a work is fetched as
// its image-free epub, which goes through the epub parser and its hard
// output caps.
package gutenberg

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"qinqin/internal/library"
	"qinqin/internal/library/epub"
	"qinqin/internal/library/sources"
)

const (
	defaultBase = "https://www.gutenberg.org"
	catalogPath = "/cache/epub/feeds/pg_catalog.csv"

	catalogTTL  = 7 * 24 * time.Hour // Gutenberg asks robots to be gentle
	workTTL     = 24 * time.Hour
	negativeTTL = 30 * time.Second
	loadTimeout = 90 * time.Second

	maxCatalog = 64 << 20 // the live file is about 21 MB
	maxEpub    = 32 << 20

	defaultLimit = 25
	maxLimit     = 100

	licenseNote = "Distributed by Project Gutenberg as public domain in the USA; copyright status elsewhere may differ."
)

var idPattern = regexp.MustCompile(`^[0-9]{1,10}$`)

type work struct {
	id, title, author, language string
	ntitle, nauthor             string // normalized title and author for search
}

type catalog struct {
	works []*work
	byID  map[string]*work
}

// flight is one in-progress catalog download shared by all waiters.
type flight struct {
	done chan struct{}
	cat  *catalog
	err  error
}

type adapter struct {
	c            *sources.HTTPClient
	base         string // scheme and host of the site; the catalog and works are built from it
	allowedHosts map[string]bool
	hostSuffix   string // also allowed: any host ending in this (".gutenberg.org")
	allowHTTP    bool   // production fetches over https only
	maxEpub      int64

	mu        sync.Mutex
	cat       *catalog
	expires   time.Time
	flight    *flight
	failErr   error     // negative cache of the last failed load
	failUntil time.Time // until when failErr is returned without retrying
}

// New returns the Project Gutenberg source. It fetches over https only,
// from gutenberg.org and its subdomains, and enforces that on every
// redirect hop too.
func New(c *sources.HTTPClient) sources.Source {
	return newAdapter(c, defaultBase, map[string]bool{"gutenberg.org": true}, ".gutenberg.org", false)
}

func newAdapter(c *sources.HTTPClient, base string, hosts map[string]bool, suffix string, allowHTTP bool) *adapter {
	a := &adapter{base: base, allowedHosts: hosts, hostSuffix: suffix, allowHTTP: allowHTTP, maxEpub: maxEpub}
	a.c = c.For(func(u *url.URL) error {
		if !a.urlAllowed(u) {
			return errors.New("gutenberg: host not allowed")
		}
		return nil
	})
	return a
}

func (a *adapter) ID() string { return "gutenberg" }

func (a *adapter) urlAllowed(u *url.URL) bool {
	if u.Scheme != "https" && !(a.allowHTTP && u.Scheme == "http") {
		return false
	}
	// www.gutenberg.org is a subdomain; any other port than the default
	// is a different host string and is refused.
	return a.allowedHosts[u.Host] || (a.hostSuffix != "" && strings.HasSuffix(u.Host, a.hostSuffix))
}

func normalize(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, strings.ToLower(norm.NFKC.String(s)))
}

// languageOf returns the first supported language code of a catalog
// Language value such as "en;zh", or "" if it has none. Codes match
// whole, so "zhx" is not "zh".
func languageOf(field string) string {
	for _, code := range strings.Split(field, ";") {
		switch code = strings.ToLower(strings.TrimSpace(code)); code {
		case "zh", "ja":
			return code
		}
	}
	return ""
}

var requiredColumns = []string{"Text#", "Type", "Title", "Language", "Authors"}

func parseCatalog(raw []byte) (*catalog, error) {
	raw = bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf"))
	r := csv.NewReader(bytes.NewReader(raw))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	head, err := r.Read()
	if err != nil {
		return nil, fmt.Errorf("gutenberg: catalog header: %w", err)
	}
	col := map[string]int{}
	for i, h := range head {
		col[strings.TrimSpace(h)] = i
	}
	for _, name := range requiredColumns {
		if _, ok := col[name]; !ok {
			return nil, fmt.Errorf("gutenberg: catalog column %q not found", name)
		}
	}
	cat := &catalog{byID: map[string]*work{}}
	for {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("gutenberg: catalog: %w", err)
		}
		get := func(name string) string {
			if i := col[name]; i < len(rec) {
				return strings.TrimSpace(rec[i])
			}
			return ""
		}
		id := get("Text#")
		lang := languageOf(get("Language"))
		if get("Type") != "Text" || lang == "" || !idPattern.MatchString(id) || cat.byID[id] != nil {
			continue
		}
		w := &work{id: id, title: get("Title"), author: get("Authors"), language: lang}
		w.ntitle, w.nauthor = normalize(w.title), normalize(w.author)
		cat.works = append(cat.works, w)
		cat.byID[id] = w
	}
	return cat, nil
}

// catalog returns the parsed catalog. Downloads are single-flight and
// run detached from any one caller's context; waiters give up when their
// own ctx ends. A failed load is remembered for negativeTTL, and while a
// stale catalog exists it is served instead of the error.
func (a *adapter) catalog(ctx context.Context) (*catalog, error) {
	a.mu.Lock()
	now := a.c.Now()
	if a.cat != nil && now.Before(a.expires) {
		cat := a.cat
		a.mu.Unlock()
		return cat, nil
	}
	if a.failErr != nil && now.Before(a.failUntil) {
		cat, err := a.cat, a.failErr
		a.mu.Unlock()
		if cat != nil {
			return cat, nil
		}
		return nil, err
	}
	f := a.flight
	if f == nil {
		f = &flight{done: make(chan struct{})}
		a.flight = f
		go a.load(f)
	}
	a.mu.Unlock()
	select {
	case <-f.done:
		return f.cat, f.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (a *adapter) load(f *flight) {
	ctx, cancel := context.WithTimeout(context.Background(), loadTimeout)
	defer cancel()
	cat, err := a.download(ctx)
	a.mu.Lock()
	defer a.mu.Unlock()
	now := a.c.Now()
	if err == nil {
		a.cat, a.expires, a.failErr = cat, now.Add(catalogTTL), nil
		f.cat = cat
	} else {
		a.failErr, a.failUntil = err, now.Add(negativeTTL)
		if a.cat != nil { // keep serving the stale catalog
			f.cat = a.cat
		} else {
			f.err = err
		}
	}
	a.flight = nil
	close(f.done)
}

func (a *adapter) download(ctx context.Context) (*catalog, error) {
	u := a.base + catalogPath
	data, err := a.c.Get(ctx, u, maxCatalog, catalogTTL)
	if err != nil {
		return nil, err
	}
	cat, err := parseCatalog(data)
	if err != nil {
		a.c.Invalidate(u) // do not let a bad body stick for the TTL
		return nil, err
	}
	return cat, nil
}

func (a *adapter) Search(ctx context.Context, q string, limit int) ([]sources.Result, error) {
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	cat, err := a.catalog(ctx)
	if err != nil {
		return nil, err
	}
	return cat.search(normalize(q), limit), nil
}

// search returns at most limit works matching the normalized query nq,
// ranked (exact title, title prefix, author, substring; ties by id)
// before truncating.
func (cat *catalog) search(nq string, limit int) []sources.Result {
	out := []sources.Result{}
	for _, w := range sources.TopMatches(cat.works, limit,
		func(w *work) int { return sources.MatchRank(nq, w.ntitle, w.nauthor) },
		func(w *work) string { return w.id }) {
		out = append(out, sources.Result{SourceID: w.id, Title: w.title, Author: w.author, Language: w.language})
	}
	return out
}

func (a *adapter) Fetch(ctx context.Context, sourceID string) (sources.Imported, error) {
	if !idPattern.MatchString(sourceID) {
		return sources.Imported{}, fmt.Errorf("gutenberg: source id must be digits: %w", sources.ErrNotFound)
	}
	cat, err := a.catalog(ctx)
	if err != nil {
		return sources.Imported{}, err
	}
	w := cat.byID[sourceID]
	if w == nil {
		return sources.Imported{}, fmt.Errorf("gutenberg: #%s is not a Chinese or Japanese text: %w", sourceID, sources.ErrNotFound)
	}
	epubURL := a.base + "/ebooks/" + w.id + ".epub.noimages"
	body, err := a.c.Get(ctx, epubURL, a.maxEpub, workTTL)
	if err != nil {
		return sources.Imported{}, err
	}
	_, chapters, err := epub.Parse(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		a.c.Invalidate(epubURL)
		return sources.Imported{}, err
	}
	attr := []string{"Project Gutenberg #" + w.id, w.title}
	if w.author != "" {
		attr = append(attr, w.author)
	}
	return sources.Imported{
		Meta: library.Book{
			Language:    w.language, // from the catalog, not the epub's dc:language
			Title:       w.title,
			Author:      w.author,
			Source:      "gutenberg",
			SourceID:    w.id,
			SourceURL:   a.base + "/ebooks/" + w.id,
			Attribution: strings.Join(attr, "\n"),
			LicenseNote: licenseNote,
		},
		Chapters: chapters,
	}, nil
}
