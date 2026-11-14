// Package aozora searches and imports public-domain works of Aozora
// Bunko. Only works for which the catalog flags both the work and the
// author as free of copyright are ever listed or fetched; any other
// flag value, including an empty one, excludes the work.
package aozora

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/html"
	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/unicode/norm"

	"qinqin/internal/lang"
	"qinqin/internal/library"
	"qinqin/internal/library/sources"
)

const (
	defaultCatalogURL = "https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip"
	catalogTTL        = 7 * 24 * time.Hour
	workTTL           = 24 * time.Hour
	negativeTTL       = 30 * time.Second
	loadTimeout       = 90 * time.Second

	maxCatalogZip = 32 << 20  // download
	maxCatalogCSV = 128 << 20 // unzipped
	maxWorkBody   = 32 << 20  // downloaded xhtml or zip
	maxWorkText   = 32 << 20  // unzipped text

	// Output caps, same philosophy as the epub parser's.
	maxText       = 32 << 20
	maxRuns       = 2_000_000
	maxParagraphs = 500_000
	maxChapters   = 2000

	defaultLimit = 20
	maxLimit     = 100

	noCopyright = "なし"
	rootNote    = "青空文庫 (https://www.aozora.gr.jp/)"
)

var idPattern = regexp.MustCompile(`^[0-9]{1,10}$`)

type work struct {
	id, title, author, published string
	cardURL, textURL, htmlURL    string
	ntitle, nauthor              string // normalized title and author for search
	reading, authorReading       string // 作品名読み and 姓読み+名読み, when the catalog has them
	ptitle, pauthor              string // phonetic keys of the readings (lang.PhoneticKey)
	blocked                      bool
	hasAuthorRole                bool
}

type catalog struct {
	works []*work          // free works, ordered by id
	byKey map[string]*work // id without leading zeros
}

// flight is one in-progress catalog download shared by all waiters.
type flight struct {
	done chan struct{}
	cat  *catalog
	err  error
}

type adapter struct {
	c            *sources.HTTPClient
	catalogURL   string
	allowedHosts map[string]bool
	allowHTTP    bool  // production fetches over https only
	maxBody      int64 // cap for one card or text zip

	mu        sync.Mutex
	cat       *catalog
	expires   time.Time
	flight    *flight
	failErr   error     // negative cache of the last failed load
	failUntil time.Time // until when failErr is returned without retrying
}

// New returns the Aozora Bunko source. It fetches over https only, from
// aozora.gr.jp (the live catalog points nowhere else), and enforces that
// on every redirect hop too.
func New(c *sources.HTTPClient) sources.Source {
	return newAdapter(c, defaultCatalogURL, map[string]bool{
		"www.aozora.gr.jp": true,
		"aozora.gr.jp":     true,
	}, false)
}

func newAdapter(c *sources.HTTPClient, catalogURL string, hosts map[string]bool, allowHTTP bool) *adapter {
	a := &adapter{catalogURL: catalogURL, allowedHosts: hosts, allowHTTP: allowHTTP, maxBody: maxWorkBody}
	a.c = c.For(func(u *url.URL) error {
		if !a.urlAllowed(u) {
			return errors.New("aozora: host not allowed")
		}
		return nil
	})
	return a
}

func (a *adapter) ID() string { return "aozora" }

func normalize(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, strings.ToLower(norm.NFKC.String(s)))
}

func idKey(id string) string {
	if k := strings.TrimLeft(id, "0"); k != "" {
		return k
	}
	return "0"
}

// readZipEntry returns the first entry whose name ends in suffix.
// Entry names are lookup keys only; nothing touches the filesystem.
func readZipEntry(data []byte, suffix string, max int64) ([]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("aozora: bad zip: %w", err)
	}
	for _, f := range zr.File {
		if !strings.HasSuffix(strings.ToLower(f.Name), suffix) {
			continue
		}
		if f.UncompressedSize64 > uint64(max) {
			return nil, sources.ErrTooLarge
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("aozora: bad zip: %w", err)
		}
		defer rc.Close()
		b, err := io.ReadAll(io.LimitReader(rc, max+1))
		if err != nil {
			return nil, fmt.Errorf("aozora: bad zip: %w", err)
		}
		if int64(len(b)) > max {
			return nil, sources.ErrTooLarge
		}
		return b, nil
	}
	return nil, fmt.Errorf("aozora: no %s entry in zip", suffix)
}

var requiredColumns = []string{
	"作品ID", "作品名", "作品著作権フラグ", "公開日", "図書カードURL", "姓", "名",
	"役割フラグ", "人物著作権フラグ", "テキストファイルURL", "XHTML/HTMLファイルURL",
}

// Optional reading columns. Verified against the live
// list_person_all_extended_utf8.csv on 2026-11-13, whose header carries
// 作品名読み, ソート用読み, 副題読み, 姓読み, 名読み, 姓読みソート用,
// 名読みソート用, 姓ローマ字 and 名ローマ字. The readings are hiragana
// with katakana for loanwords (ウェストミンスターじいん). A catalog
// without them (an old cache, a fixture) still loads; its works are then
// matched on their written title and author only.
const (
	colTitleReading  = "作品名読み"
	colFamilyReading = "姓読み"
	colGivenReading  = "名読み"
)

func parseCatalog(zipData []byte, usable func(*work) bool) (*catalog, error) {
	raw, err := readZipEntry(zipData, ".csv", maxCatalogCSV)
	if err != nil {
		return nil, err
	}
	raw = bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf"))
	r := csv.NewReader(bytes.NewReader(raw))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	head, err := r.Read()
	if err != nil {
		return nil, fmt.Errorf("aozora: catalog header: %w", err)
	}
	col := map[string]int{}
	for i, h := range head {
		col[strings.TrimSpace(h)] = i
	}
	for _, name := range requiredColumns {
		if _, ok := col[name]; !ok {
			return nil, fmt.Errorf("aozora: catalog column %q not found", name)
		}
	}
	byID := map[string]*work{}
	for {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("aozora: catalog: %w", err)
		}
		get := func(name string) string {
			if i, ok := col[name]; ok && i < len(rec) {
				return strings.TrimSpace(rec[i])
			}
			return ""
		}
		id := get("作品ID")
		if !idPattern.MatchString(id) {
			continue
		}
		w := byID[id]
		if w == nil {
			w = &work{
				id: id, title: get("作品名"), published: get("公開日"), cardURL: get("図書カードURL"),
				textURL: get("テキストファイルURL"), htmlURL: get("XHTML/HTMLファイルURL"),
				reading: get(colTitleReading),
			}
			byID[id] = w
		}
		// Fail closed: every row of the work must carry no-copyright flags.
		if get("作品著作権フラグ") != noCopyright || get("人物著作権フラグ") != noCopyright {
			w.blocked = true
		}
		name, nameReading := get("姓")+get("名"), get(colFamilyReading)+get(colGivenReading)
		if role := get("役割フラグ"); role == "著者" && !w.hasAuthorRole {
			w.author, w.authorReading, w.hasAuthorRole = name, nameReading, true
		} else if w.author == "" {
			w.author, w.authorReading = name, nameReading
		}
	}
	cat := &catalog{byKey: map[string]*work{}}
	for _, w := range byID {
		if w.blocked || !usable(w) {
			continue
		}
		w.ntitle, w.nauthor = normalize(w.title), normalize(w.author)
		w.ptitle, w.pauthor = lang.PhoneticKey(w.reading), lang.PhoneticKey(w.authorReading)
		cat.works = append(cat.works, w)
	}
	sort.Slice(cat.works, func(i, j int) bool { return cat.works[i].id < cat.works[j].id })
	for _, w := range cat.works {
		cat.byKey[idKey(w.id)] = w
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
	data, err := a.c.Get(ctx, a.catalogURL, maxCatalogZip, catalogTTL)
	if err != nil {
		return nil, err
	}
	cat, err := parseCatalog(data, a.usable)
	if err != nil {
		a.c.Invalidate(a.catalogURL) // do not let a bad body stick for the TTL
		return nil, err
	}
	return cat, nil
}

// usable reports whether the work has a download URL this adapter may use.
func (a *adapter) usable(w *work) bool {
	return a.allowed(w.htmlURL) || a.allowed(w.textURL)
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
	return cat.search(normalize(q), lang.PhoneticKey(q), limit), nil
}

// search returns at most limit works matching the normalized query nq
// on their title or author, or else the phonetic query pq on their
// readings, ranked (written matches first: exact title, title prefix,
// author, substring; then phonetic matches in the same order; ties by
// id) before truncating. A phonetic match carries the title's reading.
func (cat *catalog) search(nq, pq string, limit int) []sources.Result {
	rank := func(w *work) (int, bool) {
		return sources.CombinedRank(nq, w.ntitle, w.nauthor, pq, w.ptitle, w.pauthor)
	}
	out := []sources.Result{}
	for _, w := range sources.TopMatches(cat.works, limit,
		func(w *work) int { r, _ := rank(w); return r },
		func(w *work) string { return w.id }) {
		res := w.result()
		if _, phonetic := rank(w); phonetic {
			res.Reading = w.reading
		}
		out = append(out, res)
	}
	return out
}

func (w *work) result() sources.Result {
	note := ""
	if w.published != "" {
		note = "公開日 " + w.published
	}
	return sources.Result{SourceID: w.id, Title: w.title, Author: w.author, Language: "ja", Note: note}
}

// Browse returns an assortment of the public-domain works (see
// sources.Browser), seeded by the source id and seed. Aozora holds only
// Japanese works: any language but "ja" or "" is an empty list.
func (a *adapter) Browse(ctx context.Context, language, seed string, limit int) ([]sources.Result, error) {
	if language != "" && language != "ja" {
		return []sources.Result{}, nil
	}
	cat, err := a.catalog(ctx)
	if err != nil {
		return nil, err
	}
	out := []sources.Result{}
	for _, w := range sources.Assortment(cat.works, a.ID()+":"+seed, min(max(limit, 1), maxLimit)) {
		out = append(out, w.result())
	}
	return out, nil
}

func (a *adapter) urlAllowed(u *url.URL) bool {
	return (u.Scheme == "https" || (a.allowHTTP && u.Scheme == "http")) && a.allowedHosts[u.Host]
}

// allowed reports whether rawURL is a URL this adapter may fetch.
func (a *adapter) allowed(rawURL string) bool {
	u, err := url.Parse(rawURL)
	return rawURL != "" && err == nil && a.urlAllowed(u)
}

func (a *adapter) Fetch(ctx context.Context, sourceID string) (sources.Imported, error) {
	if !idPattern.MatchString(sourceID) {
		return sources.Imported{}, fmt.Errorf("aozora: source id must be digits: %w", sources.ErrNotFound)
	}
	cat, err := a.catalog(ctx)
	if err != nil {
		return sources.Imported{}, err
	}
	w := cat.byKey[idKey(sourceID)]
	if w == nil {
		return sources.Imported{}, fmt.Errorf("aozora: work %s not found among public-domain works: %w", sourceID, sources.ErrNotFound)
	}
	var (
		chapters []library.Chapter
		footer   []string
		tried    bool
		lastErr  error
	)
	if a.allowed(w.htmlURL) {
		tried = true
		body, err := a.c.Get(ctx, w.htmlURL, a.maxBody, workTTL)
		if err == nil {
			chapters, footer, err = parseXHTML(body, w.title)
			if err != nil {
				a.c.Invalidate(w.htmlURL)
			}
		}
		// A card over the size caps is an error, deliberately not a
		// reason to try the text zip: it holds the same work.
		if errors.Is(err, sources.ErrTooLarge) {
			return sources.Imported{}, err
		}
		lastErr = err
	}
	if chapters == nil && a.allowed(w.textURL) {
		tried = true
		body, err := a.c.Get(ctx, w.textURL, a.maxBody, workTTL)
		if err == nil {
			chapters, footer, err = parseZipText(body, w.title)
			if err != nil {
				a.c.Invalidate(w.textURL)
			}
		}
		lastErr = err
	}
	if !tried {
		return sources.Imported{}, errors.New("aozora: no allowed download URL for work")
	}
	if chapters == nil {
		if lastErr == nil {
			lastErr = errors.New("aozora: work has no text")
		}
		return sources.Imported{}, lastErr
	}
	cardURL := w.cardURL
	if cardURL == "" {
		cardURL = w.htmlURL
	}
	return sources.Imported{
		Meta: library.Book{
			Language:    "ja",
			Title:       w.title,
			Author:      w.author,
			Source:      "aozora",
			SourceID:    w.id,
			SourceURL:   cardURL,
			Attribution: attribution(footer),
			LicenseNote: "In the public domain: the Aozora Bunko catalog flags both the work and its author as 著作権なし (no copyright).",
		},
		Chapters: chapters,
	}, nil
}

// attribution joins the 底本 footer lines, stopping before Aozora's
// boilerplate about how the file was made.
func attribution(footer []string) string {
	lines := []string{rootNote}
	for _, l := range footer {
		l = strings.TrimSpace(l)
		if strings.HasPrefix(l, "青空文庫作成ファイル") {
			break
		}
		if l != "" {
			lines = append(lines, l)
		}
	}
	return strings.Join(lines, "\n")
}

// budget enforces the output caps.
type budget struct{ text, runs, paras, chapters int }

func (b *budget) addRun(n int) error {
	b.text += n
	b.runs++
	if b.text > maxText || b.runs > maxRuns {
		return sources.ErrTooLarge
	}
	return nil
}

func (b *budget) addParagraph() error {
	b.paras++
	if b.paras > maxParagraphs {
		return sources.ErrTooLarge
	}
	return nil
}

func (b *budget) addChapter() error {
	b.chapters++
	if b.chapters > maxChapters {
		return sources.ErrTooLarge
	}
	return nil
}

var (
	reGaiji      = regexp.MustCompile(`※［＃[^］]*］`)
	reAnnotation = regexp.MustCompile(`［＃[^］]*］`)
	reCodepoint  = regexp.MustCompile(`U\+([0-9A-Fa-f]{4,6})`)
	reRuby       = regexp.MustCompile(`｜([^《｜》]+)《([^》]+)》|([\p{Han}々〆ヶ〇]+)《([^》]+)》`)
)

// gaiji returns the character a gaiji note names by code point, or the
// geta mark when it only describes the glyph.
func gaiji(note string) string {
	if m := reCodepoint.FindStringSubmatch(note); m != nil {
		if n, err := strconv.ParseInt(m[1], 16, 32); err == nil && utf8.ValidRune(rune(n)) && !unicode.IsControl(rune(n)) {
			return string(rune(n))
		}
	}
	return "〓"
}

// isDash reports an Aozora "-------" separator line.
func isDash(l string) bool {
	l = strings.TrimSpace(l)
	return len(l) >= 10 && strings.Trim(l, "-") == ""
}

func parseZipText(zipData []byte, title string) ([]library.Chapter, []string, error) {
	raw, err := readZipEntry(zipData, ".txt", maxWorkText)
	if err != nil {
		return nil, nil, err
	}
	return parseText(raw, title)
}

// parseText reads the Shift_JIS text format.
func parseText(raw []byte, title string) ([]library.Chapter, []string, error) {
	dec, err := japanese.ShiftJIS.NewDecoder().Bytes(raw)
	if err != nil {
		return nil, nil, fmt.Errorf("aozora: text is not Shift_JIS: %w", err)
	}
	s := strings.ReplaceAll(string(dec), "\r\n", "\n")
	lines := strings.Split(strings.ReplaceAll(s, "\r", "\n"), "\n")

	// Drop the title lines and the 記号について block, which sit above
	// the second separator.
	var dashes []int
	for i, l := range lines {
		if isDash(l) {
			dashes = append(dashes, i)
			if len(dashes) == 2 {
				break
			}
		}
	}
	if len(dashes) == 2 && dashes[0] < 20 {
		lines = lines[dashes[1]+1:]
	}
	var footer []string
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.HasPrefix(lines[i], "底本：") {
			footer, lines = lines[i:], lines[:i]
			break
		}
	}

	bud := &budget{}
	var paras []library.Paragraph
	for _, l := range lines {
		l = reGaiji.ReplaceAllStringFunc(l, gaiji)
		l = reAnnotation.ReplaceAllString(l, "")
		p, err := rubyRuns(l, bud)
		if err != nil {
			return nil, nil, err
		}
		if p == nil {
			continue
		}
		if err := bud.addParagraph(); err != nil {
			return nil, nil, err
		}
		paras = append(paras, p)
	}
	if len(paras) == 0 {
		return nil, nil, errors.New("aozora: work has no text")
	}
	return []library.Chapter{{Title: title, Paragraphs: paras}}, footer, nil
}

// rubyRuns splits one line at its ｜漢字《かんじ》 notations; a line
// with only whitespace yields nil.
func rubyRuns(line string, bud *budget) (library.Paragraph, error) {
	if strings.TrimSpace(line) == "" {
		return nil, nil
	}
	var p library.Paragraph
	add := func(text, ruby string) error {
		if text == "" {
			return nil
		}
		if err := bud.addRun(len(text) + len(ruby)); err != nil {
			return err
		}
		p = append(p, library.Run{Text: text, Ruby: ruby})
		return nil
	}
	last := 0
	for _, m := range reRuby.FindAllStringSubmatchIndex(line, -1) {
		if err := add(line[last:m[0]], ""); err != nil {
			return nil, err
		}
		base, ruby := "", ""
		if m[2] >= 0 {
			base, ruby = line[m[2]:m[3]], line[m[4]:m[5]]
		} else {
			base, ruby = line[m[6]:m[7]], line[m[8]:m[9]]
		}
		if err := add(base, ruby); err != nil {
			return nil, err
		}
		last = m[1]
	}
	if err := add(line[last:], ""); err != nil {
		return nil, err
	}
	return p, nil
}

// ---- XHTML cards ----

func hasClass(n *html.Node, class string) bool {
	for _, at := range n.Attr {
		if at.Key == "class" {
			for _, c := range strings.Fields(at.Val) {
				if c == class {
					return true
				}
			}
		}
	}
	return false
}

func attr(n *html.Node, key string) string {
	for _, at := range n.Attr {
		if at.Key == key {
			return at.Val
		}
	}
	return ""
}

func findClass(n *html.Node, class string) *html.Node {
	if n.Type == html.ElementNode && hasClass(n, class) {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if f := findClass(c, class); f != nil {
			return f
		}
	}
	return nil
}

var textStrip = strings.NewReplacer("\r", "", "\n", "", "\t", "")

// plainText is the text of n without ruby readings.
func plainText(n *html.Node) string {
	switch {
	case n.Type == html.TextNode:
		return textStrip.Replace(n.Data)
	case n.Type == html.ElementNode && (n.Data == "rt" || n.Data == "rp" || n.Data == "script" || n.Data == "style"):
		return ""
	case n.Type == html.ElementNode && n.Data == "img" && hasClass(n, "gaiji"):
		return gaiji(attr(n, "alt"))
	}
	var sb strings.Builder
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		sb.WriteString(plainText(c))
	}
	return sb.String()
}

// footerLines is the text of n with a line break at each <br>.
func footerLines(n *html.Node, cur *strings.Builder, out *[]string) {
	switch {
	case n.Type == html.TextNode:
		cur.WriteString(textStrip.Replace(n.Data))
		return
	case n.Type == html.ElementNode && (n.Data == "br" || n.Data == "hr"):
		*out = append(*out, cur.String())
		cur.Reset()
		return
	case n.Type == html.ElementNode && (n.Data == "script" || n.Data == "style"):
		return
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		footerLines(c, cur, out)
	}
	if n.Type == html.ElementNode && n.Data == "div" {
		*out = append(*out, cur.String())
		cur.Reset()
	}
}

func headingLevel(n *html.Node) int {
	if n.Type == html.ElementNode && len(n.Data) == 2 && n.Data[0] == 'h' && n.Data[1] >= '3' && n.Data[1] <= '5' {
		return int(n.Data[1] - '0')
	}
	return 0
}

func minHeading(n *html.Node, min int) int {
	if l := headingLevel(n); l != 0 && (min == 0 || l < min) {
		min = l
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		min = minHeading(c, min)
	}
	return min
}

type builder struct {
	bud      *budget
	split    int // heading level that starts a chapter; 0 for none
	chapters []library.Chapter
	title    string
	paras    []library.Paragraph
	cur      library.Paragraph
	err      error
}

func (b *builder) addRun(text, ruby string) {
	if b.err != nil || text == "" {
		return
	}
	if b.err = b.bud.addRun(len(text) + len(ruby)); b.err != nil {
		return
	}
	if n := len(b.cur); ruby == "" && n > 0 && b.cur[n-1].Ruby == "" {
		b.cur[n-1].Text += text
		return
	}
	b.cur = append(b.cur, library.Run{Text: text, Ruby: ruby})
}

func (b *builder) flush() {
	p := b.cur
	b.cur = nil
	if b.err != nil {
		return
	}
	blank := true
	for _, r := range p {
		if r.Ruby != "" || strings.TrimSpace(r.Text) != "" {
			blank = false
		}
	}
	if blank {
		return
	}
	if b.err = b.bud.addParagraph(); b.err == nil {
		b.paras = append(b.paras, p)
	}
}

func (b *builder) endChapter() {
	if b.err == nil && len(b.paras) > 0 {
		if b.err = b.bud.addChapter(); b.err == nil {
			b.chapters = append(b.chapters, library.Chapter{Title: b.title, Paragraphs: b.paras})
		}
	}
	b.paras = nil
}

func (b *builder) walk(n *html.Node) {
	if b.err != nil {
		return
	}
	switch n.Type {
	case html.TextNode:
		b.addRun(textStrip.Replace(n.Data), "")
		return
	case html.ElementNode:
	default:
		return
	}
	switch n.Data {
	case "script", "style", "rt", "rp":
		return
	case "br":
		b.flush()
		return
	case "img":
		if hasClass(n, "gaiji") {
			b.addRun(gaiji(attr(n, "alt")), "")
		}
		return
	case "ruby":
		var rt strings.Builder
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode && c.Data == "rt" {
				for s := c.FirstChild; s != nil; s = s.NextSibling {
					rt.WriteString(plainText(s))
				}
			}
		}
		b.addRun(plainText(n), strings.TrimSpace(rt.String()))
		return
	}
	if hasClass(n, "notes") {
		return
	}
	if l := headingLevel(n); l != 0 && l == b.split {
		b.flush()
		b.endChapter()
		b.title = strings.TrimSpace(plainText(n))
		return
	}
	block := false
	switch n.Data {
	case "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "tr", "blockquote":
		block = true
	}
	if block {
		b.flush()
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		b.walk(c)
	}
	if block {
		b.flush()
	}
}

// parseXHTML reads an Aozora XHTML card (Shift_JIS) into chapters and
// the 底本 footer lines.
func parseXHTML(raw []byte, title string) ([]library.Chapter, []string, error) {
	dec, err := japanese.ShiftJIS.NewDecoder().Bytes(raw)
	if err != nil {
		return nil, nil, fmt.Errorf("aozora: card is not Shift_JIS: %w", err)
	}
	doc, err := html.Parse(bytes.NewReader(dec))
	if err != nil {
		return nil, nil, fmt.Errorf("aozora: card: %w", err)
	}
	main := findClass(doc, "main_text")
	if main == nil {
		return nil, nil, errors.New("aozora: card has no main_text")
	}
	b := &builder{bud: &budget{}, split: minHeading(main, 0), title: title}
	for c := main.FirstChild; c != nil; c = c.NextSibling {
		b.walk(c)
	}
	b.flush()
	b.endChapter()
	if b.err != nil {
		return nil, nil, b.err
	}
	if len(b.chapters) == 0 {
		return nil, nil, errors.New("aozora: work has no text")
	}
	var footer []string
	if bib := findClass(doc, "bibliographical_information"); bib != nil {
		var cur strings.Builder
		footerLines(bib, &cur, &footer)
		footer = append(footer, cur.String())
	}
	return b.chapters, footer, nil
}
