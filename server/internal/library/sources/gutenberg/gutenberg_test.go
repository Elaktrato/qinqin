package gutenberg

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"qinqin/internal/library/epub"
	"qinqin/internal/library/sources"
)

var header = []string{"Text#", "Type", "Issued", "Title", "Language", "Authors", "Subjects", "LoCC", "Bookshelves"}

func tinyEpub(t *testing.T) []byte {
	t.Helper()
	files := []struct{ name, body string }{
		{"META-INF/container.xml", `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`},
		{"content.opf", `<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Epub Title</dc:title><dc:creator>Epub Author</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>`},
		{"a.xhtml", `<html><body><h1>One</h1><p>你好</p></body></html>`},
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, f := range files {
		w, _ := zw.Create(f.name)
		w.Write([]byte(f.body))
	}
	zw.Close()
	return buf.Bytes()
}

type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *testClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *testClock) advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
}

const (
	catOK = iota
	catGarbage
	catFail
)

type fixture struct {
	srv      *httptest.Server
	mux      *http.ServeMux
	ad       *adapter
	clock    *testClock
	cacheDir string
	catHits  atomic.Int32
	epubHits atomic.Int32
	catMode  atomic.Int32
	epubBody atomic.Value // []byte
	gate     chan struct{}
}

func newFixture(t *testing.T, head []string) *fixture {
	t.Helper()
	f := &fixture{mux: http.NewServeMux()}
	f.epubBody.Store(tinyEpub(t))
	f.srv = httptest.NewServer(f.mux)
	t.Cleanup(f.srv.Close)
	rows := [][]string{
		{"1", "Text", "1971-12-01", "The Declaration", "en", "Jefferson, Thomas", "", "", ""},
		{"1982", "Text", "1999-11-01", "羅生門", "ja", "芥川, 龍之介, 1892-1927", "", "", ""},
		{"4572", "Text", "2003-10-01", "粉妝樓1-10回", "zh", "羅, 貫中", "", "", ""},
		{"5000", "Text", "2003-10-01", "Bilingual Reader", "en;zh", "Someone, Else", "", "", ""},
		{"5001", "Sound", "2003-10-01", "Audio 羅生門", "ja", "Reader", "", "", ""},
		{"5002", "Text", "2003-10-01", "Not Chinese", "zhx;en", "Nobody", "", "", ""},
		{"5003", "Text", "2003-10-01", "Cantonese", "yue", "Nobody", "", "", ""},
		{"abc", "Text", "2003-10-01", "Bad id", "zh", "Nobody", "", "", ""},
		{"5004", "Text", "2003-10-01", "Mixed Case", " JA ; en", "Nobody", "", "", ""},
	}
	var cat bytes.Buffer
	cat.WriteString("\xef\xbb\xbf")
	w := csv.NewWriter(&cat)
	w.Write(head)
	for _, r := range rows {
		w.Write(r)
	}
	w.Flush()
	f.mux.HandleFunc("/cache/epub/feeds/pg_catalog.csv", func(w http.ResponseWriter, r *http.Request) {
		f.catHits.Add(1)
		if f.gate != nil {
			select {
			case <-f.gate:
			case <-r.Context().Done():
				return
			}
		}
		switch f.catMode.Load() {
		case catGarbage:
			w.Write([]byte("Text#,Type\n\"unterminated"))
		case catFail:
			http.Error(w, "down", http.StatusInternalServerError)
		default:
			w.Write(cat.Bytes())
		}
	})
	// Like gutenberg.org: the ebooks URL redirects to the cache file.
	f.mux.HandleFunc("/ebooks/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/ebooks/"), ".epub.noimages")
		http.Redirect(w, r, "/cache/epub/"+id+"/pg"+id+".epub", http.StatusFound)
	})
	for _, id := range []string{"1982", "4572"} {
		f.mux.HandleFunc("/cache/epub/"+id+"/pg"+id+".epub", func(w http.ResponseWriter, r *http.Request) {
			f.epubHits.Add(1)
			w.Write(f.epubBody.Load().([]byte))
		})
	}
	u, _ := url.Parse(f.srv.URL)
	f.cacheDir = t.TempDir()
	c := sources.NewHTTPClient(f.cacheDir, "ua")
	c.AllowPrivate = true // httptest listens on 127.0.0.1
	f.clock = &testClock{t: time.Now()}
	c.SetClock(f.clock.now, func(context.Context, time.Duration) error { return nil })
	f.ad = newAdapter(c, f.srv.URL, map[string]bool{u.Host: true}, "", true)
	return f
}

func ids(rs []sources.Result) []string {
	out := []string{}
	for _, r := range rs {
		out = append(out, r.SourceID)
	}
	return out
}

func TestGutenbergSearchFiltersLanguageAndType(t *testing.T) {
	f := newFixture(t, header)
	ctx := context.Background()
	rs, err := f.ad.Search(ctx, "", 50)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := ids(rs), []string{"1982", "4572", "5000", "5004"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("ids = %v, want %v", got, want)
	}
	if rs[0].Title != "羅生門" || rs[0].Author != "芥川, 龍之介, 1892-1927" || rs[0].Language != "ja" {
		t.Errorf("result = %+v", rs[0])
	}
	if rs[2].Language != "zh" || rs[3].Language != "ja" {
		t.Errorf("languages = %q %q", rs[2].Language, rs[3].Language)
	}
	if rs, _ := f.ad.Search(ctx, "", 2); len(rs) != 2 {
		t.Errorf("limit 2 returned %d", len(rs))
	}
	if rs, _ := f.ad.Search(ctx, "", 0); len(rs) != 4 {
		t.Errorf("default limit returned %d", len(rs))
	}
}

func TestGutenbergSearchMatchesTitleAndAuthor(t *testing.T) {
	f := newFixture(t, header)
	ctx := context.Background()
	if rs, _ := f.ad.Search(ctx, "羅生", 10); !reflect.DeepEqual(ids(rs), []string{"1982"}) {
		t.Errorf("title: %v", ids(rs))
	}
	if rs, _ := f.ad.Search(ctx, "貫中", 10); !reflect.DeepEqual(ids(rs), []string{"4572"}) {
		t.Errorf("author: %v", ids(rs))
	}
	if rs, _ := f.ad.Search(ctx, "bilingual READER", 10); !reflect.DeepEqual(ids(rs), []string{"5000"}) {
		t.Errorf("case: %v", ids(rs))
	}
	if rs, _ := f.ad.Search(ctx, "zzz", 10); rs == nil || len(rs) != 0 {
		t.Errorf("no match: %#v", rs)
	}
}

func TestGutenbergCatalogMissingColumnFailsLoudly(t *testing.T) {
	f := newFixture(t, []string{"Text#", "Type", "Title", "Authors"}) // no Language
	_, err := f.ad.Search(context.Background(), "", 5)
	if err == nil || !strings.Contains(err.Error(), "Language") {
		t.Fatalf("err = %v", err)
	}
}

func TestGutenbergColumnsByNameNotPosition(t *testing.T) {
	// Rows keep the usual order while the header is shuffled: values
	// land in other columns, so nothing may match (and nothing panic).
	f := newFixture(t, []string{"Authors", "Language", "Title", "Type", "Text#", "Issued", "Subjects", "LoCC", "Bookshelves"})
	rs, err := f.ad.Search(context.Background(), "", 5)
	if err != nil || len(rs) != 0 {
		t.Fatalf("got %v, %v", ids(rs), err)
	}
}

func TestGutenbergFetch(t *testing.T) {
	f := newFixture(t, header)
	got, err := f.ad.Fetch(context.Background(), "1982")
	if err != nil {
		t.Fatal(err)
	}
	m := got.Meta
	// Language, title and author come from the catalog, not the epub (which says "en").
	if m.Language != "ja" || m.Title != "羅生門" || m.Author != "芥川, 龍之介, 1892-1927" ||
		m.Source != "gutenberg" || m.SourceID != "1982" ||
		m.SourceURL != f.srv.URL+"/ebooks/1982" ||
		m.LicenseNote != "Public domain in the USA (Project Gutenberg)" ||
		!strings.HasPrefix(m.Attribution, "Project Gutenberg #1982") ||
		!strings.Contains(m.Attribution, "羅生門") || !strings.Contains(m.Attribution, "芥川") {
		t.Errorf("meta = %+v", m)
	}
	if len(got.Chapters) != 1 || got.Chapters[0].Title != "One" {
		t.Errorf("chapters = %+v", got.Chapters)
	}
	if f.epubHits.Load() != 1 {
		t.Errorf("epub hits = %d, want 1", f.epubHits.Load())
	}
	if m, _ := f.ad.Fetch(context.Background(), "4572"); m.Meta.Language != "zh" {
		t.Errorf("zh book language = %q", m.Meta.Language)
	}
}

func TestGutenbergFetchRejects(t *testing.T) {
	f := newFixture(t, header)
	ctx := context.Background()
	for _, id := range []string{"", "abc", "1982/../x", "19 82", "../1982", "1982.epub"} {
		if _, err := f.ad.Fetch(ctx, id); err == nil || errors.Is(err, sources.ErrNotFound) {
			t.Errorf("id %q: err = %v, want a validation error", id, err)
		}
	}
	// Valid digits but not a zh/ja text of the catalog.
	for _, id := range []string{"1", "5001", "5002", "999999"} {
		if _, err := f.ad.Fetch(ctx, id); !errors.Is(err, sources.ErrNotFound) {
			t.Errorf("id %s: err = %v, want ErrNotFound", id, err)
		}
	}
	if f.epubHits.Load() != 0 {
		t.Error("rejected ids caused downloads")
	}
}

func TestGutenbergInvalidEpub(t *testing.T) {
	f := newFixture(t, header)
	f.epubBody.Store([]byte("not an epub"))
	if _, err := f.ad.Fetch(context.Background(), "1982"); !errors.Is(err, epub.ErrInvalid) {
		t.Fatalf("err = %v, want epub.ErrInvalid", err)
	}
	// The bad body must not stick in the cache.
	f.epubBody.Store(tinyEpub(t))
	if _, err := f.ad.Fetch(context.Background(), "1982"); err != nil {
		t.Fatalf("refetch: %v", err)
	}
}

func TestGutenbergOversizedEpub(t *testing.T) {
	f := newFixture(t, header)
	f.ad.maxEpub = 100
	if _, err := f.ad.Fetch(context.Background(), "1982"); !errors.Is(err, sources.ErrTooLarge) {
		t.Fatalf("err = %v, want ErrTooLarge", err)
	}
}

func TestGutenbergRedirectOffHostIsBlocked(t *testing.T) {
	f := newFixture(t, header)
	evil := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("request reached the disallowed host")
	}))
	defer evil.Close()
	f.mux.HandleFunc("/ebooks/4572.epub.noimages", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, evil.URL+"/x.epub", http.StatusFound)
	})
	// The fixture's allowlist holds the test server only; 127.0.0.1 with
	// another port is a different host.
	if _, err := f.ad.Fetch(context.Background(), "4572"); !errors.Is(err, sources.ErrBlocked) {
		t.Fatalf("err = %v, want ErrBlocked", err)
	}
}

func TestGutenbergCatalogSingleFlight(t *testing.T) {
	f := newFixture(t, header)
	f.gate = make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if rs, err := f.ad.Search(context.Background(), "", 10); err != nil || len(rs) != 4 {
				t.Errorf("search: %d %v", len(rs), err)
			}
		}()
	}
	time.Sleep(100 * time.Millisecond)
	close(f.gate)
	wg.Wait()
	if n := f.catHits.Load(); n != 1 {
		t.Fatalf("catalog hits = %d, want 1", n)
	}
}

func TestGutenbergCatalogWaiterHonorsContext(t *testing.T) {
	f := newFixture(t, header)
	f.gate = make(chan struct{})
	defer close(f.gate)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := f.ad.Search(ctx, "", 5); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v", err)
	}
}

func TestGutenbergStaleCatalogServedWhenRefreshFails(t *testing.T) {
	f := newFixture(t, header)
	ctx := context.Background()
	if _, err := f.ad.Search(ctx, "", 5); err != nil {
		t.Fatal(err)
	}
	f.catMode.Store(catFail)
	f.clock.advance(catalogTTL + time.Hour)
	if rs, err := f.ad.Search(ctx, "", 5); err != nil || len(rs) != 4 {
		t.Fatalf("stale: %d %v", len(rs), err)
	}
}

func TestGutenbergFailureIsNegativelyCached(t *testing.T) {
	f := newFixture(t, header)
	ctx := context.Background()
	f.catMode.Store(catFail)
	for i := 0; i < 2; i++ {
		if _, err := f.ad.Search(ctx, "", 5); err == nil {
			t.Fatal("expected error")
		}
	}
	if f.catHits.Load() != 1 {
		t.Fatalf("hits = %d, want 1", f.catHits.Load())
	}
	f.catMode.Store(catOK)
	f.clock.advance(negativeTTL + time.Second)
	if rs, err := f.ad.Search(ctx, "", 5); err != nil || len(rs) != 4 {
		t.Fatalf("after window: %d %v", len(rs), err)
	}
}

func TestGutenbergBadCatalogBodyIsNotCached(t *testing.T) {
	f := newFixture(t, header)
	f.catMode.Store(catGarbage)
	if _, err := f.ad.Search(context.Background(), "", 5); err == nil {
		t.Fatal("expected error")
	}
	if entries, _ := os.ReadDir(f.cacheDir); len(entries) != 0 {
		t.Fatalf("bad body stayed in the cache: %v", entries)
	}
}

func TestGutenbergCatalogIsCachedForSevenDays(t *testing.T) {
	if catalogTTL != 7*24*time.Hour {
		t.Fatalf("catalogTTL = %v", catalogTTL)
	}
}

func TestGutenbergProductionPolicy(t *testing.T) {
	a := New(sources.NewHTTPClient(t.TempDir(), "ua")).(*adapter)
	for u, want := range map[string]bool{
		"https://www.gutenberg.org/ebooks/1.epub.noimages": true,
		"https://gutenberg.org/x":                          true,
		"https://aleph.gutenberg.org/x":                    true,
		"http://www.gutenberg.org/x":                       false,
		"https://evilgutenberg.org/x":                      false,
		"https://www.gutenberg.org.evil.example/x":         false,
		"https://www.gutenberg.org:8443/x":                 false,
		"https://example.com/www.gutenberg.org":            false,
	} {
		pu, _ := url.Parse(u)
		if got := a.urlAllowed(pu); got != want {
			t.Errorf("%s: allowed = %v, want %v", u, got, want)
		}
	}
}
