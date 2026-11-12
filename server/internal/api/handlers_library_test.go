package api_test

import (
	"archive/zip"
	"bytes"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// libBook mirrors the book JSON of the library routes.
type libBook struct {
	ID           int64  `json:"id"`
	Language     string `json:"language"`
	Title        string `json:"title"`
	Author       string `json:"author"`
	Source       string `json:"source"`
	SourceID     string `json:"sourceId"`
	ChapterCount int    `json:"chapterCount"`
	Position     string `json:"position"`
}

// tinyEpub builds a minimal two-chapter epub in memory. lang "" omits
// dc:language.
func tinyEpub(t *testing.T, lang string) []byte {
	t.Helper()
	langEl := ""
	if lang != "" {
		langEl = `<dc:language>` + lang + `</dc:language>`
	}
	files := []struct{ name, body string }{
		{"META-INF/container.xml", `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`},
		{"content.opf", `<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Tiny</dc:title><dc:creator>Me</dc:creator>` + langEl + `</metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>`},
		{"a.xhtml", `<html><body><h1>One</h1><p>你好</p></body></html>`},
		{"b.xhtml", `<html><body><p>世界</p></body></html>`},
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, f := range files {
		w, err := zw.Create(f.name)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(f.body))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func uploadBook(t *testing.T, tsURL, token string, content []byte, language string) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, err := mw.CreateFormFile("file", "book.epub")
	if err != nil {
		t.Fatal(err)
	}
	part.Write(content)
	if language != "" {
		mw.WriteField("language", language)
	}
	mw.Close()
	req, err := http.NewRequest(http.MethodPost, tsURL+"/api/library/upload", &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func listBooks(t *testing.T, tsURL, token string) []libBook {
	t.Helper()
	resp := doJSON(t, http.MethodGet, tsURL, "/api/library/books", token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list books: status = %d", resp.StatusCode)
	}
	var out []libBook
	decodeJSON(t, resp, &out)
	return out
}

func TestLibraryUpload(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	epub := tinyEpub(t, "zh-CN")

	if resp := uploadBook(t, ts.URL, "", epub, ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no token: status = %d, want 401", resp.StatusCode)
	}

	resp := uploadBook(t, ts.URL, alice, epub, "")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload: status = %d, want 201", resp.StatusCode)
	}
	var b libBook
	decodeJSON(t, resp, &b)
	if b.Title != "Tiny" || b.Author != "Me" || b.Language != "zh" || b.Source != "upload" ||
		b.ChapterCount != 2 || len(b.SourceID) != 64 {
		t.Errorf("book = %+v", b)
	}

	// The same file again is a duplicate.
	if resp := uploadBook(t, ts.URL, alice, epub, ""); resp.StatusCode != http.StatusConflict {
		t.Errorf("re-upload: status = %d, want 409", resp.StatusCode)
	}
	if n := len(listBooks(t, ts.URL, alice)); n != 1 {
		t.Errorf("books after duplicate = %d, want 1", n)
	}

	// Language falls back to the form field; unsupported or absent is 422.
	noLang := tinyEpub(t, "")
	if resp := uploadBook(t, ts.URL, alice, noLang, ""); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("no language: status = %d, want 422", resp.StatusCode)
	}
	if resp := uploadBook(t, ts.URL, alice, noLang, "fr"); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("fr: status = %d, want 422", resp.StatusCode)
	}
	if resp := uploadBook(t, ts.URL, alice, tinyEpub(t, "en"), ""); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("opf en, no form: status = %d, want 422", resp.StatusCode)
	}
	// An unsupported OPF language defers to a valid form field.
	resp = uploadBook(t, ts.URL, alice, tinyEpub(t, "fr"), "ja")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("opf fr + form ja: status = %d, want 201", resp.StatusCode)
	}
	decodeJSON(t, resp, &b)
	if b.Language != "ja" {
		t.Errorf("opf fr + form ja: language = %q, want ja", b.Language)
	}
	// A valid OPF language wins over the form field.
	resp = uploadBook(t, ts.URL, alice, tinyEpub(t, "ja"), "zh")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("opf ja + form zh: status = %d, want 201", resp.StatusCode)
	}
	decodeJSON(t, resp, &b)
	if b.Language != "ja" {
		t.Errorf("opf ja + form zh: language = %q, want ja", b.Language)
	}
	resp = uploadBook(t, ts.URL, alice, noLang, "ja")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("form language: status = %d, want 201", resp.StatusCode)
	}
	decodeJSON(t, resp, &b)
	if b.Language != "ja" {
		t.Errorf("language = %q, want ja", b.Language)
	}
}

func TestLibraryUploadRejects(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")

	if resp := uploadBook(t, ts.URL, alice, []byte("garbage, not an epub"), "zh"); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("garbage: status = %d, want 422", resp.StatusCode)
	}
	big := bytes.Repeat([]byte("x"), 21<<20)
	if resp := uploadBook(t, ts.URL, alice, big, "zh"); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("oversize: status = %d, want 413", resp.StatusCode)
	}
	if n := len(listBooks(t, ts.URL, alice)); n != 0 {
		t.Errorf("books after rejects = %d, want 0", n)
	}
}

func TestLibraryReadRoutes(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)

	var b libBook
	decodeJSON(t, uploadBook(t, ts.URL, alice, tinyEpub(t, "zh"), ""), &b)
	id := strconv.FormatInt(b.ID, 10)

	if got := listBooks(t, ts.URL, alice); len(got) != 1 || got[0].ID != b.ID {
		t.Errorf("alice list = %+v", got)
	}
	if got := listBooks(t, ts.URL, bob); len(got) != 0 {
		t.Errorf("bob list = %+v, want none", got)
	}

	resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/books/"+id, alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get book: status = %d", resp.StatusCode)
	}
	var got libBook
	decodeJSON(t, resp, &got)
	if got.Title != "Tiny" {
		t.Errorf("book = %+v", got)
	}

	resp = doJSON(t, http.MethodGet, ts.URL, "/api/library/books/"+id+"/chapters/0", alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("chapter 0: status = %d", resp.StatusCode)
	}
	var ch struct {
		Title      string `json:"title"`
		Paragraphs [][]struct {
			Text string `json:"text"`
		} `json:"paragraphs"`
	}
	decodeJSON(t, resp, &ch)
	if ch.Title != "One" || len(ch.Paragraphs) != 2 || ch.Paragraphs[1][0].Text != "你好" {
		t.Errorf("chapter = %+v", ch)
	}

	for path, want := range map[string]int{
		"/api/library/books/" + id + "/chapters/2":  http.StatusNotFound,
		"/api/library/books/" + id + "/chapters/-1": http.StatusNotFound,
		"/api/library/books/" + id + "/chapters/x":  http.StatusNotFound,
		"/api/library/books/999":                    http.StatusNotFound,
		"/api/library/books/x":                      http.StatusNotFound,
	} {
		if resp := doJSON(t, http.MethodGet, ts.URL, path, alice, nil); resp.StatusCode != want {
			t.Errorf("GET %s: status = %d, want %d", path, resp.StatusCode, want)
		}
	}
	// Another user's book is a 404 on every route.
	for _, path := range []string{"/api/library/books/" + id, "/api/library/books/" + id + "/chapters/0"} {
		if resp := doJSON(t, http.MethodGet, ts.URL, path, bob, nil); resp.StatusCode != http.StatusNotFound {
			t.Errorf("bob GET %s: status = %d, want 404", path, resp.StatusCode)
		}
	}
	if resp := doJSON(t, http.MethodPut, ts.URL, "/api/library/books/"+id+"/position", bob, map[string]string{"position": "1"}); resp.StatusCode != http.StatusNotFound {
		t.Errorf("bob PUT position: status = %d, want 404", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodDelete, ts.URL, "/api/library/books/"+id, bob, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("bob DELETE: status = %d, want 404", resp.StatusCode)
	}
	if got := listBooks(t, ts.URL, alice); len(got) != 1 || got[0].ID != b.ID {
		t.Errorf("alice list after bob DELETE = %+v, want her book intact", got)
	}
}

func TestLibraryPositionAndDelete(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	var b libBook
	decodeJSON(t, uploadBook(t, ts.URL, alice, tinyEpub(t, "zh"), ""), &b)
	id := strconv.FormatInt(b.ID, 10)

	resp := doJSON(t, http.MethodPut, ts.URL, "/api/library/books/"+id+"/position", alice, map[string]string{"position": "1:3"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("set position: status = %d, want 204", resp.StatusCode)
	}
	resp = doJSON(t, http.MethodGet, ts.URL, "/api/library/books/"+id, alice, nil)
	var got libBook
	decodeJSON(t, resp, &got)
	if got.Position != "1:3" {
		t.Errorf("position = %q, want 1:3", got.Position)
	}

	// Positions over 1 KB are refused.
	long := strings.Repeat("a", 1025)
	if resp := doJSON(t, http.MethodPut, ts.URL, "/api/library/books/"+id+"/position", alice, map[string]string{"position": long}); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("long position: status = %d, want 413", resp.StatusCode)
	}
	if resp := doRaw(t, http.MethodPut, ts.URL, "/api/library/books/"+id+"/position", alice, `{`); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("bad body: status = %d, want 400", resp.StatusCode)
	}

	if resp := doJSON(t, http.MethodDelete, ts.URL, "/api/library/books/"+id, alice, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete: status = %d, want 204", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/books/"+id, alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("get after delete: status = %d, want 404", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodDelete, ts.URL, "/api/library/books/"+id, alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("second delete: status = %d, want 404", resp.StatusCode)
	}
}
