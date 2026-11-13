package api_test

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/db"
	"qinqin/internal/library"
	"qinqin/internal/library/epub"
	"qinqin/internal/library/sources"
)

// fakeSource is a controllable sources.Source.
type fakeSource struct {
	id      string
	results []sources.Result

	mu        sync.Mutex
	gotQuery  string
	gotLimit  int
	fetches   int
	deadline  time.Time
	fetchHook func(ctx context.Context, id string) (sources.Imported, error)
}

func (f *fakeSource) ID() string { return f.id }

func (f *fakeSource) Search(_ context.Context, q string, limit int) ([]sources.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.gotQuery, f.gotLimit = q, limit
	return f.results, nil
}

func (f *fakeSource) Fetch(ctx context.Context, id string) (sources.Imported, error) {
	f.mu.Lock()
	f.fetches++
	f.deadline, _ = ctx.Deadline()
	hook := f.fetchHook
	f.mu.Unlock()
	if hook != nil {
		return hook(ctx, id)
	}
	return sources.Imported{
		Meta: library.Book{
			Language: "ja", Title: "Work " + id, Author: "Someone", Source: f.id, SourceID: id,
			SourceURL: "https://example.test/" + id, Attribution: "attr", LicenseNote: "PD",
		},
		Chapters: []library.Chapter{
			{Title: "One", Paragraphs: []library.Paragraph{{{Text: "hello"}}}},
			{Title: "Two", Paragraphs: []library.Paragraph{{{Text: "world"}}}},
		},
	}, nil
}

func (f *fakeSource) fetchCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.fetches
}

// newSourcesServer starts the API with the given sources.
func newSourcesServer(t *testing.T, srcs ...sources.Source) (ts *httptest.Server, sqlDB *sql.DB, dataDir string) {
	t.Helper()
	dataDir = t.TempDir()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	ts = httptest.NewServer(api.New(sqlDB, dataDir, srcs))
	t.Cleanup(ts.Close)
	return ts, sqlDB, dataDir
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func importBody(id string, workspace int64) map[string]any {
	return map[string]any{"sourceId": id, "workspaceId": workspace}
}

func bodyOf(t *testing.T, resp *http.Response) string {
	t.Helper()
	b, _ := io.ReadAll(resp.Body)
	return string(b)
}

func TestSourcesList(t *testing.T) {
	ts, _, _ := newSourcesServer(t, &fakeSource{id: "fake"}, &fakeSource{id: "aozora"}, &fakeSource{id: "gutenberg"})
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources", "", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no token: status = %d, want 401", resp.StatusCode)
	}
	alice := registerUser(t, ts.URL, "alice", "")
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources", alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var out []struct {
		ID        string   `json:"id"`
		Name      string   `json:"name"`
		Languages []string `json:"languages"`
	}
	decodeJSON(t, resp, &out)
	if len(out) != 3 || out[0].ID != "fake" || out[0].Name != "fake" || out[0].Languages == nil ||
		out[1].ID != "aozora" || out[1].Name != "Aozora Bunko" || strings.Join(out[1].Languages, ",") != "ja" ||
		out[2].ID != "gutenberg" || out[2].Name != "Project Gutenberg" || strings.Join(out[2].Languages, ",") != "zh,ja" {
		t.Errorf("sources = %+v", out)
	}
}

func TestSourcesListEmpty(t *testing.T) {
	ts, _, _ := newSourcesServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources", alice, nil)
	if got := strings.TrimSpace(bodyOf(t, resp)); got != "[]" {
		t.Errorf("body = %s, want []", got)
	}
}

func TestSourcesSearch(t *testing.T) {
	fake := &fakeSource{id: "fake", results: []sources.Result{
		{SourceID: "7", Title: "T", Author: "A", Language: "zh", Note: "N"},
	}}
	ts, _, _ := newSourcesServer(t, fake)
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/fake/search?q=x", "", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no token: status = %d, want 401", resp.StatusCode)
	}
	alice := registerUser(t, ts.URL, "alice", "")

	resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/fake/search?q=%E7%BE%85", alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var out []struct {
		SourceID string `json:"sourceId"`
		Title    string `json:"title"`
		Author   string `json:"author"`
		Language string `json:"language"`
		Note     string `json:"note"`
	}
	decodeJSON(t, resp, &out)
	if len(out) != 1 || out[0].SourceID != "7" || out[0].Title != "T" || out[0].Author != "A" ||
		out[0].Language != "zh" || out[0].Note != "N" {
		t.Errorf("results = %+v", out)
	}
	if fake.gotQuery != "羅" || fake.gotLimit != 25 {
		t.Errorf("source saw q=%q limit=%d, want 羅 and 25", fake.gotQuery, fake.gotLimit)
	}

	for query, want := range map[string]int{"limit=10": 10, "limit=100": 100, "limit=500": 100, "limit=0": 25} {
		resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/fake/search?q=x&"+query, alice, nil)
		if resp.StatusCode != http.StatusOK || fake.gotLimit != want {
			t.Errorf("%s: status %d, limit %d, want %d", query, resp.StatusCode, fake.gotLimit, want)
		}
	}
	for _, query := range []string{"limit=abc", "limit=-1", "limit=1.5", "limit="} {
		resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/fake/search?q=x&"+query, alice, nil)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", query, resp.StatusCode)
		}
	}
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/nope/search?q=x", alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown source: status = %d, want 404", resp.StatusCode)
	}
}

func TestSourcesSearchEmptyIsArray(t *testing.T) {
	ts, _, _ := newSourcesServer(t, &fakeSource{id: "fake"})
	alice := registerUser(t, ts.URL, "alice", "")
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/sources/fake/search?q=x", alice, nil)
	if got := strings.TrimSpace(bodyOf(t, resp)); got != "[]" {
		t.Errorf("body = %s, want []", got)
	}
}

func TestSourcesImport(t *testing.T) {
	fake := &fakeSource{id: "fake"}
	ts, sqlDB, dataDir := newSourcesServer(t, fake)
	path := "/api/library/sources/fake/import"
	if resp := doJSON(t, http.MethodPost, ts.URL, path, "", importBody("42", 1)); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no token: status = %d, want 401", resp.StatusCode)
	}
	alice := registerUser(t, ts.URL, "alice", "")
	ja := newWorkspace(t, ts.URL, alice, "ja", "")

	resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody("42", ja))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d: %s", resp.StatusCode, bodyOf(t, resp))
	}
	var b struct {
		libBook
		SourceURL   string `json:"sourceUrl"`
		Attribution string `json:"attribution"`
		LicenseNote string `json:"licenseNote"`
	}
	decodeJSON(t, resp, &b)
	if b.ID == 0 || b.Title != "Work 42" || b.Language != "ja" || b.Source != "fake" || b.SourceID != "42" ||
		b.SourceURL != "https://example.test/42" || b.Attribution != "attr" || b.LicenseNote != "PD" || b.ChapterCount != 2 ||
		b.WorkspaceID != ja {
		t.Errorf("book = %+v", b)
	}
	if !fake.deadline.After(time.Now().Add(50*time.Second)) || fake.deadline.After(time.Now().Add(61*time.Second)) {
		t.Errorf("fetch deadline = %v, want about 60 s from now", time.Until(fake.deadline))
	}

	books := listBooks(t, ts.URL, alice, ja)
	if len(books) != 1 || books[0].ID != b.ID {
		t.Errorf("library = %+v", books)
	}
	var userID int64
	if err := sqlDB.QueryRow(`SELECT user_id FROM library_books WHERE id = ?`, b.ID).Scan(&userID); err != nil || userID == 0 {
		t.Errorf("stored user_id = %d, %v", userID, err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "books", fmt.Sprint(userID), fmt.Sprint(b.ID)+".json")); err != nil {
		t.Errorf("content file: %v", err)
	}
	ch := doJSON(t, http.MethodGet, ts.URL, fmt.Sprintf("/api/library/books/%d/chapters/1", b.ID), alice, nil)
	if ch.StatusCode != http.StatusOK {
		t.Errorf("chapter: status = %d", ch.StatusCode)
	}
}

func TestSourcesImportDuplicate(t *testing.T) {
	fake := &fakeSource{id: "fake"}
	ts, _, _ := newSourcesServer(t, fake)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	ja := newWorkspace(t, ts.URL, alice, "ja", "")
	ja2 := newWorkspace(t, ts.URL, alice, "ja", "second")
	bobJa := newWorkspace(t, ts.URL, bob, "ja", "")
	path := "/api/library/sources/fake/import"
	if resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody("42", ja)); resp.StatusCode != http.StatusCreated {
		t.Fatalf("first: status = %d", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody("42", ja)); resp.StatusCode != http.StatusConflict {
		t.Errorf("second: status = %d, want 409", resp.StatusCode)
	}
	if n := len(listBooks(t, ts.URL, alice, 0)); n != 1 {
		t.Errorf("books = %d, want exactly 1", n)
	}
	if n := fake.fetchCount(); n != 1 {
		t.Errorf("source fetched %d times, want 1 (duplicate is caught before downloading)", n)
	}
	// The dedupe scope is the workspace: a second ja workspace of the
	// same user takes the same work, once.
	if resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody("42", ja2)); resp.StatusCode != http.StatusCreated {
		t.Errorf("second workspace: status = %d, want 201", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody("42", ja2)); resp.StatusCode != http.StatusConflict {
		t.Errorf("second workspace again: status = %d, want 409", resp.StatusCode)
	}
	if n := len(listBooks(t, ts.URL, alice, ja2)); n != 1 {
		t.Errorf("second workspace books = %d, want 1", n)
	}
	if n := fake.fetchCount(); n != 2 {
		t.Errorf("source fetched %d times, want 2", n)
	}
	// Another user can import the same work.
	if resp := doJSON(t, http.MethodPost, ts.URL, path, bob, importBody("42", bobJa)); resp.StatusCode != http.StatusCreated {
		t.Errorf("other user: status = %d, want 201", resp.StatusCode)
	}
}

// describingSource is a fakeSource that also reports catalog metadata
// (sources.Describer): language per source id, "" for unknown.
type describingSource struct {
	*fakeSource
	languages map[string]string
	describes int
}

func (d *describingSource) Describe(_ context.Context, id string) (sources.Result, error) {
	d.mu.Lock()
	d.describes++
	d.mu.Unlock()
	l, ok := d.languages[id]
	if !ok {
		return sources.Result{}, sources.ErrNotFound
	}
	return sources.Result{SourceID: id, Language: l}, nil
}

// TestSourcesImportChecksCatalogLanguageFirst: a source that can
// describe a work without downloading it has a language mismatch
// refused before Fetch; a matching or unknown catalog language still
// downloads (the post-fetch check stays the fallback), and a work the
// catalog does not know is a 404 without a download.
func TestSourcesImportChecksCatalogLanguageFirst(t *testing.T) {
	src := &describingSource{
		fakeSource: &fakeSource{id: "fake"}, // Fetch serves ja books
		languages:  map[string]string{"zh-work": "zh", "ja-work": "ja", "blank": ""},
	}
	ts, _, _ := newSourcesServer(t, src)
	alice := registerUser(t, ts.URL, "alice", "")
	ja := newWorkspace(t, ts.URL, alice, "ja", "")
	path := "/api/library/sources/fake/import"

	resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody("zh-work", ja))
	body := bodyOf(t, resp)
	if resp.StatusCode != http.StatusUnprocessableEntity || !strings.Contains(body, "workspace language is ja, book is zh") {
		t.Errorf("zh work into ja: status = %d, body %q, want 422 with the reason", resp.StatusCode, body)
	}
	if n := src.fetchCount(); n != 0 {
		t.Errorf("mismatched work downloaded %d times, want 0", n)
	}

	if resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody("missing", ja)); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown work: status = %d, want 404", resp.StatusCode)
	}
	if n := src.fetchCount(); n != 0 {
		t.Errorf("unknown work downloaded %d times, want 0", n)
	}

	if resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody("ja-work", ja)); resp.StatusCode != http.StatusCreated {
		t.Errorf("ja work into ja: status = %d, want 201", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody("blank", ja)); resp.StatusCode != http.StatusCreated {
		t.Errorf("work without catalog language: status = %d, want 201", resp.StatusCode)
	}
	if n := src.fetchCount(); n != 2 {
		t.Errorf("source fetched %d times, want 2 (matching and unknown language)", n)
	}
}

func TestSourcesImportWorkspace(t *testing.T) {
	fake := &fakeSource{id: "fake"} // serves ja books
	aozora := &fakeSource{id: "aozora"}
	ts, sqlDB, dataDir := newSourcesServer(t, fake, aozora)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	zh := newWorkspace(t, ts.URL, alice, "zh", "")
	bobJa := newWorkspace(t, ts.URL, bob, "ja", "")
	path := "/api/library/sources/fake/import"

	// The workspace is required, must be the caller's and exist.
	for _, body := range []any{
		map[string]any{"sourceId": "1"},
		map[string]any{"sourceId": "1", "workspaceId": 0},
		map[string]any{"sourceId": "1", "workspaceId": -3},
		map[string]any{"sourceId": "1", "workspaceId": "7"},
	} {
		if resp := doJSON(t, http.MethodPost, ts.URL, path, alice, body); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("body %v: status = %d, want 400", body, resp.StatusCode)
		}
	}
	for _, ws := range []int64{bobJa, 999999} {
		if resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody("1", ws)); resp.StatusCode != http.StatusNotFound {
			t.Errorf("workspace %d: status = %d, want 404", ws, resp.StatusCode)
		}
	}
	if n := fake.fetchCount(); n != 0 {
		t.Errorf("rejected imports reached the source %d times", n)
	}

	// A source that serves no book in the workspace's language is refused
	// before downloading (Aozora is ja only).
	resp := doJSON(t, http.MethodPost, ts.URL, "/api/library/sources/aozora/import", alice, importBody("1", zh))
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("aozora into zh: status = %d, want 422", resp.StatusCode)
	}
	if n := aozora.fetchCount(); n != 0 {
		t.Errorf("aozora fetched %d times, want 0", n)
	}

	// A fetched book of another language is refused with the reason.
	resp = doJSON(t, http.MethodPost, ts.URL, path, alice, importBody("1", zh))
	body := bodyOf(t, resp)
	if resp.StatusCode != http.StatusUnprocessableEntity || !strings.Contains(body, "workspace language is zh, book is ja") {
		t.Errorf("ja book into zh: status = %d, body %q, want 422 with the reason", resp.StatusCode, body)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM library_books`).Scan(&n)
	if n != 0 {
		t.Errorf("rows = %d, want 0", n)
	}
	if files := filesUnder(t, filepath.Join(dataDir, "books")); len(files) != 0 {
		t.Errorf("files left behind: %v", files)
	}
}

func TestSourcesImportDuplicateRaceMapsTo409(t *testing.T) {
	// The pre-check passes for both requests when they overlap; the
	// store's unique constraint decides and the loser is a 409 too.
	fake := &fakeSource{id: "fake"}
	var once sync.Once
	var ts *httptest.Server
	var alice string
	var zh int64
	fake.fetchHook = func(ctx context.Context, id string) (sources.Imported, error) {
		once.Do(func() { // the same book appears in the workspace while this fetch runs
			uploadBook(t, ts.URL, alice, tinyEpub(t, "zh"), "", zh)
		})
		return sources.Imported{
			Meta:     library.Book{Language: "zh", Title: "T", Source: "upload", SourceID: sha256Hex(tinyEpub(t, "zh"))},
			Chapters: []library.Chapter{{Title: "c", Paragraphs: []library.Paragraph{{{Text: "x"}}}}},
		}, nil
	}
	ts, _, _ = newSourcesServer(t, fake)
	alice = registerUser(t, ts.URL, "alice", "")
	zh = newWorkspace(t, ts.URL, alice, "zh", "")
	resp := doJSON(t, http.MethodPost, ts.URL, "/api/library/sources/fake/import", alice, importBody("1", zh))
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("status = %d, want 409", resp.StatusCode)
	}
	if n := len(listBooks(t, ts.URL, alice, 0)); n != 1 {
		t.Errorf("books = %d, want 1", n)
	}
}

func TestSourcesImportErrors(t *testing.T) {
	secret := "https://internal.example.test:8443/secret/path 10.1.2.3"
	cases := []struct {
		name   string
		err    error
		status int
	}{
		{"upstream failure", fmt.Errorf("sources: GET %s: request failed", secret), http.StatusBadGateway},
		{"blocked", fmt.Errorf("%w: host %s", sources.ErrBlocked, secret), http.StatusBadGateway},
		{"too large", fmt.Errorf("%w %s", sources.ErrTooLarge, secret), http.StatusBadGateway},
		{"redirects", fmt.Errorf("%w %s", sources.ErrTooManyRedirects, secret), http.StatusBadGateway},
		{"timeout", fmt.Errorf("GET %s: %w", secret, context.DeadlineExceeded), http.StatusBadGateway},
		{"not found", fmt.Errorf("%w: %s", sources.ErrNotFound, "#9"), http.StatusNotFound},
		{"invalid epub", fmt.Errorf("%s: %w", secret, epub.ErrInvalid), http.StatusUnprocessableEntity},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake := &fakeSource{id: "fake", fetchHook: func(context.Context, string) (sources.Imported, error) {
				return sources.Imported{}, tc.err
			}}
			ts, sqlDB, dataDir := newSourcesServer(t, fake)
			alice := registerUser(t, ts.URL, "alice", "")
			ja := newWorkspace(t, ts.URL, alice, "ja", "")
			resp := doJSON(t, http.MethodPost, ts.URL, "/api/library/sources/fake/import", alice, importBody("9", ja))
			body := bodyOf(t, resp)
			if resp.StatusCode != tc.status {
				t.Errorf("status = %d, want %d (%s)", resp.StatusCode, tc.status, body)
			}
			for _, leak := range []string{"internal.example", "10.1.2.3", "secret", "8443"} {
				if strings.Contains(body, leak) {
					t.Errorf("response leaks %q: %s", leak, body)
				}
			}
			var n int
			sqlDB.QueryRow(`SELECT COUNT(*) FROM library_books`).Scan(&n)
			if n != 0 {
				t.Errorf("rows = %d, want 0", n)
			}
			if files := filesUnder(t, filepath.Join(dataDir, "books")); len(files) != 0 {
				t.Errorf("files left behind: %v", files)
			}
			// The slot is released after a failure.
			fake.fetchHook = nil
			if resp := doJSON(t, http.MethodPost, ts.URL, "/api/library/sources/fake/import", alice, importBody("9", ja)); resp.StatusCode != http.StatusCreated {
				t.Errorf("retry: status = %d, want 201", resp.StatusCode)
			}
		})
	}
}

func filesUnder(t *testing.T, dir string) []string {
	t.Helper()
	var out []string
	filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			out = append(out, p)
		}
		return nil
	})
	return out
}

func TestSourcesImportRequestValidation(t *testing.T) {
	fake := &fakeSource{id: "fake"}
	ts, _, _ := newSourcesServer(t, fake)
	alice := registerUser(t, ts.URL, "alice", "")
	ja := newWorkspace(t, ts.URL, alice, "ja", "")
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/library/sources/nope/import", alice, importBody("1", ja)); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown source: status = %d, want 404", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/library/sources/fake/import", alice, importBody("", ja)); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("empty sourceId: status = %d, want 400", resp.StatusCode)
	}
	post := func(body string) int {
		req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/library/sources/fake/import", strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+alice)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		return resp.StatusCode
	}
	if got := post("{not json"); got != http.StatusBadRequest {
		t.Errorf("malformed: status = %d, want 400", got)
	}
	if got := post(`{"sourceId":"` + strings.Repeat("1", 2000) + `"}`); got != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized: status = %d, want 413", got)
	}
	if n := fake.fetchCount(); n != 0 {
		t.Errorf("invalid requests reached the source %d times", n)
	}
}

func TestSourcesImportOneAtATimePerUser(t *testing.T) {
	started := make(chan struct{}, 4)
	release := make(chan struct{})
	fake := &fakeSource{id: "fake"}
	fake.fetchHook = func(ctx context.Context, id string) (sources.Imported, error) {
		started <- struct{}{}
		select {
		case <-release:
		case <-ctx.Done():
			return sources.Imported{}, ctx.Err()
		}
		return sources.Imported{
			Meta:     library.Book{Language: "ja", Title: "T" + id, Source: "fake", SourceID: id},
			Chapters: []library.Chapter{{Title: "c", Paragraphs: []library.Paragraph{{{Text: "x"}}}}},
		}, nil
	}
	ts, _, _ := newSourcesServer(t, fake)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	ja := newWorkspace(t, ts.URL, alice, "ja", "")
	bobJa := newWorkspace(t, ts.URL, bob, "ja", "")
	path := "/api/library/sources/fake/import"

	first := make(chan int, 1)
	go func() {
		req, _ := http.NewRequest(http.MethodPost, ts.URL+path, strings.NewReader(fmt.Sprintf(`{"sourceId":"1","workspaceId":%d}`, ja)))
		req.Header.Set("Authorization", "Bearer "+alice)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			first <- -1
			return
		}
		resp.Body.Close()
		first <- resp.StatusCode
	}()
	<-started

	if resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody("2", ja)); resp.StatusCode != http.StatusTooManyRequests {
		t.Errorf("second concurrent import: status = %d, want 429", resp.StatusCode)
	}
	// Other users are not affected.
	bobDone := make(chan int, 1)
	go func() {
		req, _ := http.NewRequest(http.MethodPost, ts.URL+path, strings.NewReader(fmt.Sprintf(`{"sourceId":"3","workspaceId":%d}`, bobJa)))
		req.Header.Set("Authorization", "Bearer "+bob)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			bobDone <- -1
			return
		}
		resp.Body.Close()
		bobDone <- resp.StatusCode
	}()
	<-started // bob's fetch began while alice's is still running
	close(release)
	if got := <-first; got != http.StatusCreated {
		t.Errorf("first import: status = %d, want 201", got)
	}
	if got := <-bobDone; got != http.StatusCreated {
		t.Errorf("bob's import: status = %d, want 201", got)
	}
	// The slot is free again.
	if resp := doJSON(t, http.MethodPost, ts.URL, path, alice, importBody("2", ja)); resp.StatusCode != http.StatusCreated {
		t.Errorf("after release: status = %d, want 201", resp.StatusCode)
	}
	if fake.fetchCount() != 3 {
		t.Errorf("fetches = %d, want 3 (the rejected import never reached the source)", fake.fetchCount())
	}
}
