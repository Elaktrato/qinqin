package api_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"qinqin/internal/lang"
	"qinqin/internal/levels"
	"qinqin/internal/pack"
)

// schemeCharsBody mirrors GET /api/schemes/{id}/characters.
type schemeCharsBody struct {
	Levels []struct {
		ID    int64  `json:"id"`
		Name  string `json:"name"`
		Chars string `json:"chars"`
	} `json:"levels"`
}

// getSchemeChars requests GET path with the request headers through a
// client that does not negotiate compression.
func getSchemeChars(t *testing.T, tsURL, path string, header map[string]string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, tsURL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	client := &http.Client{Transport: &http.Transport{DisableCompression: true}}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp, body
}

func schemeCharsPath(id int64) string {
	return "/api/schemes/" + strconv.FormatInt(id, 10) + "/characters"
}

func TestSchemeCharactersRoute(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	ctx := context.Background()
	importSchemeCedict(t, sqlDB)
	pk, err := pack.LoadPack(levelsFixture)
	if err != nil {
		t.Fatalf("load fixture pack: %v", err)
	}
	if _, err := levels.Import(ctx, sqlDB, pk); err != nil {
		t.Fatalf("import fixture scheme: %v", err)
	}
	s := listSchemes(t, ts.URL)[0]
	path := schemeCharsPath(s.ID)

	// Public; levels in order with their characters as one string.
	resp, plain := getSchemeChars(t, ts.URL, path, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: status %d", path, resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}
	want := fmt.Sprintf(`{"levels":[{"id":%d,"name":"1","chars":"你好谢"},{"id":%d,"name":"2","chars":"银行"}]}`,
		s.Levels[0].ID, s.Levels[1].ID)
	if string(plain) != want {
		t.Errorf("body = %s, want %s", plain, want)
	}

	// Weak ETag; a matching validator is a bodyless 304.
	etag := resp.Header.Get("ETag")
	if !strings.HasPrefix(etag, `W/"`) {
		t.Fatalf("ETag = %q, want a weak validator", etag)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "private, max-age=0, must-revalidate" {
		t.Errorf("Cache-Control = %q", cc)
	}
	if v := resp.Header.Get("Vary"); v != "Accept-Encoding" {
		t.Errorf("Vary = %q", v)
	}
	for _, inm := range []string{etag, strings.TrimPrefix(etag, "W/"), "*"} {
		r, b := getSchemeChars(t, ts.URL, path, map[string]string{"If-None-Match": inm})
		if r.StatusCode != http.StatusNotModified || len(b) != 0 || r.Header.Get("ETag") != etag {
			t.Errorf("If-None-Match %q: status %d, body %q, ETag %q", inm, r.StatusCode, b, r.Header.Get("ETag"))
		}
	}

	// gzip when accepted, the same body underneath.
	r, gz := getSchemeChars(t, ts.URL, path, map[string]string{"Accept-Encoding": "gzip"})
	if r.Header.Get("Content-Encoding") != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", r.Header.Get("Content-Encoding"))
	}
	zr, err := gzip.NewReader(bytes.NewReader(gz))
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := io.ReadAll(zr); !bytes.Equal(got, plain) {
		t.Errorf("gunzipped body = %s, want %s", got, plain)
	}

	// A change to the memberships moves the ETag: dropping 银行 empties
	// level 2.
	smaller, err := pack.LoadPack(writeLevelsPack(t, "hsk-mini",
		`{"unit":"word","levels":[{"name":"1","entries":["你好","谢谢"]},{"name":"2","entries":[]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := levels.Import(ctx, sqlDB, smaller); err != nil {
		t.Fatalf("re-import: %v", err)
	}
	r, b := getSchemeChars(t, ts.URL, path, map[string]string{"If-None-Match": etag})
	if r.StatusCode != http.StatusOK || r.Header.Get("ETag") == etag {
		t.Fatalf("after a change: status %d, ETag %q (was %q)", r.StatusCode, r.Header.Get("ETag"), etag)
	}
	var body schemeCharsBody
	if err := json.Unmarshal(b, &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Levels) != 2 || body.Levels[0].Chars != "你好谢" || body.Levels[1].Chars != "" {
		t.Errorf("after a change: body %s, want level 2 empty", b)
	}

	// Unknown, malformed and uninstalled schemes are 404.
	if err := levels.Uninstall(ctx, sqlDB, s.ID); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{path, "/api/schemes/999999/characters", "/api/schemes/NaN/characters"} {
		if r, _ := getSchemeChars(t, ts.URL, p, nil); r.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s: status %d, want 404", p, r.StatusCode)
		}
	}
}

// TestSchemeCharactersLargeWordScheme imports a word scheme the size of
// HSK 3.0 (about 11k words over 3000 characters, six levels) and checks
// the route against a direct computation from the pack, logging the
// payload size and latency.
func TestSchemeCharactersLargeWordScheme(t *testing.T) {
	if testing.Short() {
		t.Skip("large fixture")
	}
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	ctx := context.Background()

	const nChars, nWords, nLevels = 3000, 11000, 6
	chars := make([]rune, nChars)
	var cedict strings.Builder
	for i := range chars {
		chars[i] = rune(0x4E00 + i)
		fmt.Fprintf(&cedict, "%c %c [ma1] /c%d/\n", chars[i], chars[i], i)
	}
	words := make([]string, nWords)
	for i := range words {
		// A deterministic spread so later levels reuse earlier characters.
		a := chars[(i*7)%nChars]
		b := chars[(i*13+i/nChars)%nChars]
		if a == b {
			b = chars[(i*13+1)%nChars]
		}
		words[i] = string([]rune{a, b})
		fmt.Fprintf(&cedict, "%s %s [ma1 ma1] /w%d/\n", words[i], words[i], i)
	}
	lookupImport(t, sqlDB, pack.Manifest{
		ID: "cedict-big", Name: "big", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "test", Format: "cedict",
	}, "dictionary.txt", cedict.String())

	type lv struct {
		Name    string   `json:"name"`
		Entries []string `json:"entries"`
	}
	pk := struct {
		Unit   string `json:"unit"`
		Levels []lv   `json:"levels"`
	}{Unit: "word"}
	per := nWords / nLevels
	for l := 0; l < nLevels; l++ {
		end := (l + 1) * per
		if l == nLevels-1 {
			end = nWords
		}
		pk.Levels = append(pk.Levels, lv{Name: strconv.Itoa(l + 1), Entries: words[l*per : end]})
	}
	levelsJSON, err := json.Marshal(pk)
	if err != nil {
		t.Fatal(err)
	}
	p, err := pack.LoadPack(writeLevelsPack(t, "big-words", string(levelsJSON)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := levels.Import(ctx, sqlDB, p); err != nil {
		t.Fatalf("import: %v", err)
	}
	s := listSchemes(t, ts.URL)[0]

	// The expected levels: each word's characters in order, lowest level
	// first, each character once.
	seen := map[rune]bool{}
	want := make([]string, nLevels)
	for l, level := range pk.Levels {
		var sb strings.Builder
		for _, w := range level.Entries {
			for _, r := range w {
				if !seen[r] {
					seen[r] = true
					sb.WriteRune(r)
				}
			}
		}
		want[l] = sb.String()
	}

	start := time.Now()
	resp, plain := getSchemeChars(t, ts.URL, schemeCharsPath(s.ID), nil)
	cold := time.Since(start)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	var body schemeCharsBody
	if err := json.Unmarshal(plain, &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Levels) != nLevels {
		t.Fatalf("%d levels, want %d", len(body.Levels), nLevels)
	}
	total := 0
	for l, level := range body.Levels {
		total += len([]rune(level.Chars))
		if level.Chars != want[l] {
			t.Errorf("level %s: %d chars, want %d (first difference matters)", level.Name,
				len([]rune(level.Chars)), len([]rune(want[l])))
		}
	}
	start = time.Now()
	gzResp, gz := getSchemeChars(t, ts.URL, schemeCharsPath(s.ID), map[string]string{"Accept-Encoding": "gzip"})
	warm := time.Since(start)
	start = time.Now()
	nm, _ := getSchemeChars(t, ts.URL, schemeCharsPath(s.ID), map[string]string{"If-None-Match": gzResp.Header.Get("ETag")})
	revalidate := time.Since(start)
	if nm.StatusCode != http.StatusNotModified {
		t.Errorf("revalidation status %d, want 304", nm.StatusCode)
	}
	t.Logf("%d words, %d distinct chars: %d B raw, %d B gzip; cold %v, gzip %v, 304 %v",
		nWords, total, len(plain), len(gz), cold, warm, revalidate)
}
