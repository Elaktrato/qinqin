package api_test

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// libBook mirrors the book JSON of the library routes.
type libBook struct {
	ID           int64  `json:"id"`
	WorkspaceID  int64  `json:"workspaceId"`
	Language     string `json:"language"`
	Title        string `json:"title"`
	Author       string `json:"author"`
	Source       string `json:"source"`
	SourceID     string `json:"sourceId"`
	ChapterCount int    `json:"chapterCount"`
	Position     string `json:"position"`
}

// newWorkspace creates a workspace through the API and returns its id.
func newWorkspace(t *testing.T, tsURL, token, language, name string) int64 {
	t.Helper()
	resp := doJSON(t, http.MethodPost, tsURL, "/api/workspaces", token, map[string]string{"language": language, "name": name})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create %s workspace %q: status = %d", language, name, resp.StatusCode)
	}
	var ws workspaceBody
	decodeJSON(t, resp, &ws)
	return ws.ID
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

// uploadBook posts an epub; language "" omits the language field and
// workspace 0 the workspace field.
func uploadBook(t *testing.T, tsURL, token string, content []byte, language string, workspace int64) *http.Response {
	t.Helper()
	fields := map[string]string{}
	if language != "" {
		fields["language"] = language
	}
	if workspace != 0 {
		fields["workspace"] = strconv.FormatInt(workspace, 10)
	}
	return uploadForm(t, tsURL, token, content, fields)
}

// uploadForm posts an epub with arbitrary extra form fields.
func uploadForm(t *testing.T, tsURL, token string, content []byte, fields map[string]string) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		mw.WriteField(k, v)
	}
	part, err := mw.CreateFormFile("file", "book.epub")
	if err != nil {
		t.Fatal(err)
	}
	part.Write(content)
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

// listBooks lists the caller's books: of one workspace, or of all with
// workspace 0.
func listBooks(t *testing.T, tsURL, token string, workspace int64) []libBook {
	t.Helper()
	path := "/api/library/books"
	if workspace != 0 {
		path += "?workspace=" + strconv.FormatInt(workspace, 10)
	}
	resp := doJSON(t, http.MethodGet, tsURL, path, token, nil)
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
	zh := newWorkspace(t, ts.URL, alice, "zh", "")
	ja := newWorkspace(t, ts.URL, alice, "ja", "")
	epub := tinyEpub(t, "zh-CN")

	if resp := uploadBook(t, ts.URL, "", epub, "", zh); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no token: status = %d, want 401", resp.StatusCode)
	}

	resp := uploadBook(t, ts.URL, alice, epub, "", zh)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload: status = %d, want 201", resp.StatusCode)
	}
	var b libBook
	decodeJSON(t, resp, &b)
	if b.Title != "Tiny" || b.Author != "Me" || b.Language != "zh" || b.Source != "upload" ||
		b.ChapterCount != 2 || len(b.SourceID) != 64 || b.WorkspaceID != zh {
		t.Errorf("book = %+v", b)
	}

	// The same file again into the same workspace is a duplicate.
	if resp := uploadBook(t, ts.URL, alice, epub, "", zh); resp.StatusCode != http.StatusConflict {
		t.Errorf("re-upload: status = %d, want 409", resp.StatusCode)
	}
	if n := len(listBooks(t, ts.URL, alice, 0)); n != 1 {
		t.Errorf("books after duplicate = %d, want 1", n)
	}

	// Language falls back to the form field; unsupported or absent is 422.
	noLang := tinyEpub(t, "")
	if resp := uploadBook(t, ts.URL, alice, noLang, "", ja); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("no language: status = %d, want 422", resp.StatusCode)
	}
	if resp := uploadBook(t, ts.URL, alice, noLang, "fr", ja); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("fr: status = %d, want 422", resp.StatusCode)
	}
	if resp := uploadBook(t, ts.URL, alice, tinyEpub(t, "en"), "", ja); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("opf en, no form: status = %d, want 422", resp.StatusCode)
	}
	// An unsupported OPF language defers to a valid form field.
	resp = uploadBook(t, ts.URL, alice, tinyEpub(t, "fr"), "ja", ja)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("opf fr + form ja: status = %d, want 201", resp.StatusCode)
	}
	decodeJSON(t, resp, &b)
	if b.Language != "ja" || b.WorkspaceID != ja {
		t.Errorf("opf fr + form ja: book = %+v, want ja in the ja workspace", b)
	}
	// A valid OPF language wins over the form field.
	resp = uploadBook(t, ts.URL, alice, tinyEpub(t, "ja"), "zh", ja)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("opf ja + form zh: status = %d, want 201", resp.StatusCode)
	}
	decodeJSON(t, resp, &b)
	if b.Language != "ja" {
		t.Errorf("opf ja + form zh: language = %q, want ja", b.Language)
	}
	resp = uploadBook(t, ts.URL, alice, noLang, "ja", ja)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("form language: status = %d, want 201", resp.StatusCode)
	}
	decodeJSON(t, resp, &b)
	if b.Language != "ja" {
		t.Errorf("language = %q, want ja", b.Language)
	}
}

func TestLibraryUploadWorkspace(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	zh := newWorkspace(t, ts.URL, alice, "zh", "")
	zh2 := newWorkspace(t, ts.URL, alice, "zh", "graded")
	ja := newWorkspace(t, ts.URL, alice, "ja", "")
	bobZh := newWorkspace(t, ts.URL, bob, "zh", "")
	epub := tinyEpub(t, "zh")

	// The workspace field is required and must be an id.
	for _, fields := range []map[string]string{{}, {"workspace": ""}, {"workspace": "x"}, {"workspace": "-1"}, {"workspace": "0"}} {
		if resp := uploadForm(t, ts.URL, alice, epub, fields); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("workspace field %v: status = %d, want 400", fields, resp.StatusCode)
		}
	}
	// Another user's workspace and an unknown one are not found.
	for _, ws := range []int64{bobZh, 999999} {
		if resp := uploadBook(t, ts.URL, alice, epub, "", ws); resp.StatusCode != http.StatusNotFound {
			t.Errorf("workspace %d: status = %d, want 404", ws, resp.StatusCode)
		}
	}
	// A zh book into the ja workspace says why.
	resp := uploadBook(t, ts.URL, alice, epub, "", ja)
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("zh book into ja workspace: status = %d, want 422", resp.StatusCode)
	}
	if body, _ := io.ReadAll(resp.Body); !strings.Contains(string(body), "workspace language is ja, book is zh") {
		t.Errorf("mismatch message = %q", body)
	}
	// A form language that disagrees with the workspace is rejected too.
	if resp := uploadBook(t, ts.URL, alice, tinyEpub(t, ""), "zh", ja); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("form zh into ja workspace: status = %d, want 422", resp.StatusCode)
	}
	if n := len(listBooks(t, ts.URL, alice, 0)); n != 0 {
		t.Fatalf("rejected uploads stored %d books", n)
	}

	// The same epub into two zh workspaces: each keeps its own copy.
	var b1, b2 libBook
	if resp := uploadBook(t, ts.URL, alice, epub, "", zh); resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload zh: status = %d", resp.StatusCode)
	} else {
		decodeJSON(t, resp, &b1)
	}
	if resp := uploadBook(t, ts.URL, alice, epub, "", zh2); resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload zh2: status = %d", resp.StatusCode)
	} else {
		decodeJSON(t, resp, &b2)
	}

	// The list filters by workspace; without the parameter it has all.
	for ws, want := range map[int64][]int64{0: {b1.ID, b2.ID}, zh: {b1.ID}, zh2: {b2.ID}, ja: {}} {
		got := listBooks(t, ts.URL, alice, ws)
		ids := []int64{}
		for _, b := range got {
			ids = append(ids, b.ID)
		}
		if fmt.Sprint(ids) != fmt.Sprint(want) {
			t.Errorf("list workspace %d = %v, want %v", ws, ids, want)
		}
	}
	// A foreign, unknown or malformed workspace filter.
	for query, want := range map[string]int{
		"?workspace=" + strconv.FormatInt(bobZh, 10): http.StatusNotFound,
		"?workspace=999999":                          http.StatusNotFound,
		"?workspace=x":                               http.StatusBadRequest,
		"?workspace=":                                http.StatusBadRequest,
		"?workspace=0":                               http.StatusBadRequest,
	} {
		if resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/books"+query, alice, nil); resp.StatusCode != want {
			t.Errorf("GET books%s: status = %d, want %d", query, resp.StatusCode, want)
		}
	}
	if got := listBooks(t, ts.URL, bob, 0); len(got) != 0 {
		t.Errorf("bob sees %+v", got)
	}
}

func TestLibraryUploadRejects(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	zh := newWorkspace(t, ts.URL, alice, "zh", "")

	if resp := uploadBook(t, ts.URL, alice, []byte("garbage, not an epub"), "zh", zh); resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("garbage: status = %d, want 422", resp.StatusCode)
	}
	big := bytes.Repeat([]byte("x"), 21<<20)
	if resp := uploadBook(t, ts.URL, alice, big, "zh", zh); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("oversize: status = %d, want 413", resp.StatusCode)
	}
	if n := len(listBooks(t, ts.URL, alice, 0)); n != 0 {
		t.Errorf("books after rejects = %d, want 0", n)
	}
}

func TestLibraryReadRoutes(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	zh := newWorkspace(t, ts.URL, alice, "zh", "")

	var b libBook
	decodeJSON(t, uploadBook(t, ts.URL, alice, tinyEpub(t, "zh"), "", zh), &b)
	id := strconv.FormatInt(b.ID, 10)

	if got := listBooks(t, ts.URL, alice, 0); len(got) != 1 || got[0].ID != b.ID || got[0].WorkspaceID != zh {
		t.Errorf("alice list = %+v", got)
	}
	if got := listBooks(t, ts.URL, bob, 0); len(got) != 0 {
		t.Errorf("bob list = %+v, want none", got)
	}

	resp := doJSON(t, http.MethodGet, ts.URL, "/api/library/books/"+id, alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get book: status = %d", resp.StatusCode)
	}
	var got libBook
	decodeJSON(t, resp, &got)
	if got.Title != "Tiny" || got.WorkspaceID != zh {
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
	// The title heading is not repeated as a paragraph.
	if ch.Title != "One" || len(ch.Paragraphs) != 1 || ch.Paragraphs[0][0].Text != "你好" {
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
	if got := listBooks(t, ts.URL, alice, 0); len(got) != 1 || got[0].ID != b.ID {
		t.Errorf("alice list after bob DELETE = %+v, want her book intact", got)
	}
}

func TestLibraryPositionAndDelete(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	zh := newWorkspace(t, ts.URL, alice, "zh", "")
	var b libBook
	decodeJSON(t, uploadBook(t, ts.URL, alice, tinyEpub(t, "zh"), "", zh), &b)
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
