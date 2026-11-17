package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// fontsAPI is docs/contracts/fonts/fonts-api.json.
type fontsAPI struct {
	Members      []string        `json:"members"`
	FaceMembers  []string        `json:"faceMembers"`
	SliceMembers []string        `json:"sliceMembers"`
	PackMembers  []string        `json:"packMembers"`
	URLPattern   string          `json:"urlPattern"`
	Empty        json.RawMessage `json:"empty"`
	Order        []struct {
		Face, Script, Weight string
	} `json:"order"`
}

func loadFontsAPI(t *testing.T) fontsAPI {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/fonts/fonts-api.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx fontsAPI
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	return fx
}

func fontGet(t *testing.T, url, path, token string, header map[string]string) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url+path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp, body
}

// keysOf lists the member names of a JSON object in written order.
func jsonKeys(t *testing.T, raw json.RawMessage) []string {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(raw))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		t.Fatalf("not an object: %s", raw)
	}
	var keys []string
	for dec.More() {
		tok, _ := dec.Token()
		keys = append(keys, tok.(string))
		var skip json.RawMessage
		dec.Decode(&skip)
	}
	return keys
}

// GET /api/fonts needs a session; every signed-in user gets the same
// answer (fonts are instance-wide), shaped as fonts-api.json says.
func TestListFonts(t *testing.T) {
	fx := loadFontsAPI(t)
	e := newPackEnv(t)
	alice := registerUser(t, e.ts.URL, "alice", e.admin)

	if resp, _ := fontGet(t, e.ts.URL, "/api/fonts", "", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous: %d, want 401", resp.StatusCode)
	}
	resp, body := fontGet(t, e.ts.URL, "/api/fonts", alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("empty list: %d %s", resp.StatusCode, body)
	}
	var got, want any
	json.Unmarshal(body, &got)
	json.Unmarshal(fx.Empty, &want)
	if gb, _ := json.Marshal(got); string(gb) != string(mustJSON(want)) {
		t.Errorf("empty answer = %s, want %s", body, fx.Empty)
	}

	installFontPack(t, e)
	resp, body = fontGet(t, e.ts.URL, "/api/fonts", alice, nil)
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "application/json" ||
		resp.Header.Get("Cache-Control") != "no-cache" || resp.Header.Get("ETag") == "" {
		t.Fatalf("alice: %d %v", resp.StatusCode, resp.Header)
	}
	_, adminBody := fontGet(t, e.ts.URL, "/api/fonts", e.admin, nil)
	if string(adminBody) != string(body) {
		t.Errorf("two users, two answers:\n%s\n%s", body, adminBody)
	}
	if !slices.Equal(jsonKeys(t, body), fx.Members) {
		t.Errorf("members = %v, want %v", jsonKeys(t, body), fx.Members)
	}
	var doc struct {
		Faces []json.RawMessage `json:"faces"`
		Packs []json.RawMessage `json:"packs"`
	}
	json.Unmarshal(body, &doc)
	if len(doc.Faces) != len(fx.Order) || len(doc.Packs) != 1 {
		t.Fatalf("faces %d packs %d: %s", len(doc.Faces), len(doc.Packs), body)
	}
	url := regexp.MustCompile(fx.URLPattern)
	for i, raw := range doc.Faces {
		if k := jsonKeys(t, raw); !slices.Equal(k, fx.FaceMembers) {
			t.Errorf("face %d members = %v", i, k)
		}
		var f struct {
			PackID, Face, Script, Weight, Style, License string
			Slices                                       []json.RawMessage
		}
		json.Unmarshal(raw, &f)
		if o := fx.Order[i]; f.Face != o.Face || f.Script != o.Script || f.Weight != o.Weight || f.PackID != "test-font" ||
			f.License != "OFL-1.1" || f.Style != "normal" {
			t.Errorf("face %d = %+v, want %+v", i, f, o)
		}
		for _, s := range f.Slices {
			if k := jsonKeys(t, s); !slices.Equal(k, fx.SliceMembers) {
				t.Errorf("slice members = %v", k)
			}
			var sl struct{ URL, UnicodeRange string }
			json.Unmarshal(s, &sl)
			if !url.MatchString(sl.URL) || sl.UnicodeRange == "" {
				t.Errorf("slice = %+v", sl)
			}
		}
	}
	if k := jsonKeys(t, doc.Packs[0]); !slices.Equal(k, fx.PackMembers) {
		t.Errorf("pack members = %v", k)
	}
	if !strings.Contains(string(doc.Packs[0]), `"notice":"Modified (subset, renamed)."`) {
		t.Errorf("pack = %s", doc.Packs[0])
	}
	// The second sans face (700) lists its slices in faces.json order.
	_, b1 := testSlice("b1")
	_, b2 := testSlice("b2")
	if i, j := strings.Index(string(doc.Faces[1]), b1), strings.Index(string(doc.Faces[1]), b2); i < 0 || j < i {
		t.Errorf("slice order of %s", doc.Faces[1])
	}

	etag := resp.Header.Get("ETag")
	if resp, _ := fontGet(t, e.ts.URL, "/api/fonts", alice, map[string]string{"If-None-Match": etag}); resp.StatusCode != http.StatusNotModified {
		t.Errorf("If-None-Match: %d, want 304", resp.StatusCode)
	}
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

// GET /fonts/{file} is public: the slice byte for byte, immutable, nosniff,
// Range honoured; anything but an installed slice's name is 404.
func TestServeFontSlice(t *testing.T) {
	e := newPackEnv(t)
	installFontPack(t, e)
	data, sha := testSlice("k")
	resp, body := fontGet(t, e.ts.URL, "/fonts/"+sha+".woff2", "", nil)
	if resp.StatusCode != http.StatusOK || string(body) != string(data) {
		t.Fatalf("slice: %d %q", resp.StatusCode, body)
	}
	for k, v := range map[string]string{"Content-Type": "font/woff2", "Cache-Control": "public, max-age=31536000, immutable",
		"X-Content-Type-Options": "nosniff"} {
		if got := resp.Header.Get(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
	resp, body = fontGet(t, e.ts.URL, "/fonts/"+sha+".woff2", "", map[string]string{"Range": "bytes=0-3"})
	if resp.StatusCode != http.StatusPartialContent || string(body) != "wOF2" {
		t.Errorf("range: %d %q", resp.StatusCode, body)
	}
	_, other := testSlice("not installed")
	for _, path := range []string{"/fonts/" + other + ".woff2", "/fonts/" + strings.ToUpper(sha) + ".woff2", "/fonts/" + sha,
		"/fonts/" + sha + ".ttf", "/fonts/x.woff2", "/fonts/..%2f" + sha + ".woff2"} {
		if resp, _ := fontGet(t, e.ts.URL, path, "", nil); resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s: %d, want 404", path, resp.StatusCode)
		}
	}
	// A slice file left on disk without a row is not served.
	doJSON(t, http.MethodDelete, e.ts.URL, "/api/admin/packs/font/test-font", e.admin, nil)
	if resp, _ := fontGet(t, e.ts.URL, "/fonts/"+sha+".woff2", "", nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("after the uninstall: %d, want 404", resp.StatusCode)
	}
}
