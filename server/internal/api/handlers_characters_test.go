package api_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"

	"qinqin/internal/lexicon"
)

// charIDs are the entry ids of the characters fixture.
type charIDs struct {
	nichi, bare, ai int64
}

// seedCharacters writes a small ja and zh character universe through the
// lexicon store: 日 with every ja field, a bare KANJIDIC2 character, a
// radical outside the universe, 爱 with its traditional partner 愛, and a
// zh character with neither the standard list nor pinyin.
func seedCharacters(t *testing.T, sqlDB *sql.DB) charIDs {
	t.Helper()
	ctx := context.Background()
	st := lexicon.Store{DB: sqlDB}
	var dict int64
	if err := sqlDB.QueryRow(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES ('d', 'd', '1', 'x', 'x', '2026-01-01T00:00:00Z') RETURNING id`).Scan(&dict); err != nil {
		t.Fatal(err)
	}
	put := func(language, char string, attrs map[string]string, readings []lexicon.Reading, glosses []string) int64 {
		t.Helper()
		e := &lexicon.Entry{Language: language, Kind: "character", Key: char,
			Forms: []lexicon.Form{{Text: char}}, Readings: readings, Attrs: attrs}
		if glosses != nil {
			e.Senses = []lexicon.Sense{{Glosses: glosses}}
		}
		id, err := st.Put(ctx, e, dict)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	var ids charIDs
	// "jlpt" is the pre-2010 scale an older seed stored: never served.
	ids.nichi = put("ja", "日", map[string]string{"src": "kd2", "strokes": "4", "grade": "1", "jlpt": "4", "freq": "1"},
		[]lexicon.Reading{{Type: "kun", Value: "ひ", Plain: "ひ"}, {Type: "on", Value: "ニチ", Plain: "にち"}},
		[]string{"day", "sun"})
	ids.bare = put("ja", "丂", map[string]string{"src": "kd2"}, nil, nil)
	put("ja", "戶", map[string]string{"strokes": "4"}, nil, nil)
	ids.ai = put("zh", "爱", map[string]string{"tghz": "1", "gb": "1", "strokes": "10"},
		[]lexicon.Reading{{Type: "pinyin", Value: "ài", Plain: "ai4"}}, []string{"to love"})
	trad := put("zh", "愛", map[string]string{"hkgrade": "1"}, nil, []string{"love"})
	if err := st.Link(ctx, ids.ai, trad, lexicon.LinkVariant); err != nil {
		t.Fatal(err)
	}
	put("zh", "㐀", map[string]string{"strokes": "5"}, nil, nil)
	return ids
}

// getCharacters requests GET /api/characters with the given query and
// request headers through a client that does not negotiate compression.
func getCharacters(t *testing.T, tsURL, query string, header map[string]string) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, tsURL+"/api/characters"+query, nil)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	client := &http.Client{Transport: &http.Transport{DisableCompression: true}}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("GET /api/characters%s: %v", query, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp, body
}

func TestCharactersRejectsBadLanguage(t *testing.T) {
	ts, _ := newServer(t)
	for _, q := range []string{"", "?language=", "?language=JA", "?language=ja%20", "?language=" + strings.Repeat("a", 17)} {
		if resp, _ := getCharacters(t, ts.URL, q, nil); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("query %q: status %d, want 400", q, resp.StatusCode)
		}
	}
}

func TestCharactersBody(t *testing.T) {
	ts, sqlDB := newServer(t)
	ids := seedCharacters(t, sqlDB)

	resp, body := getCharacters(t, ts.URL, "?language=ja", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("ja status %d: %s", resp.StatusCode, body)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}
	// The exact wire form: numbers as JSON numbers, absent fields omitted.
	want := `{"language":"ja","count":2,"chars":[` +
		`{"i":` + itoa(ids.bare) + `,"c":"丂"},` +
		`{"i":` + itoa(ids.nichi) + `,"c":"日","s":4,"g":1,"f":1,"r":"ニチ","m":"day"}]}`
	if string(body) != want {
		t.Errorf("ja body =\n%s\nwant\n%s", body, want)
	}

	_, body = getCharacters(t, ts.URL, "?language=zh", nil)
	want = `{"language":"zh","count":1,"chars":[` +
		`{"i":` + itoa(ids.ai) + `,"c":"爱","s":10,"t":1,"b":1,"h":1,"r":"ài","m":"to love","v":["愛"]}]}`
	if string(body) != want {
		t.Errorf("zh body =\n%s\nwant\n%s", body, want)
	}

	// A well-formed language without a character universe is empty.
	resp, body = getCharacters(t, ts.URL, "?language=es", nil)
	if resp.StatusCode != http.StatusOK || string(body) != `{"language":"es","count":0,"chars":[]}` {
		t.Errorf("es: status %d body %s", resp.StatusCode, body)
	}
}

func itoa(id int64) string {
	b, _ := json.Marshal(id)
	return string(b)
}

func TestCharactersCaching(t *testing.T) {
	ts, sqlDB := newServer(t)
	ids := seedCharacters(t, sqlDB)

	resp, body := getCharacters(t, ts.URL, "?language=ja", nil)
	etag := resp.Header.Get("ETag")
	if !strings.HasPrefix(etag, `W/"`) || !strings.HasSuffix(etag, `"`) {
		t.Fatalf("ETag = %q, want a weak validator", etag)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "private, max-age=0, must-revalidate" {
		t.Errorf("Cache-Control = %q", cc)
	}
	if v := resp.Header.Get("Vary"); v != "Accept-Encoding" {
		t.Errorf("Vary = %q, want Accept-Encoding", v)
	}
	if zh, _ := getCharacters(t, ts.URL, "?language=zh", nil); zh.Header.Get("ETag") == etag {
		t.Errorf("ja and zh share the ETag %q", etag)
	}

	// Matching validators answer 304 without a body; the strong form of
	// the tag, a list and * match too (weak comparison).
	strong := strings.TrimPrefix(etag, "W/")
	for _, inm := range []string{etag, strong, `"nope", ` + etag, "*"} {
		resp, b := getCharacters(t, ts.URL, "?language=ja", map[string]string{"If-None-Match": inm, "Accept-Encoding": "gzip"})
		if resp.StatusCode != http.StatusNotModified {
			t.Errorf("If-None-Match %q: status %d, want 304", inm, resp.StatusCode)
			continue
		}
		if len(b) != 0 || resp.Header.Get("Content-Encoding") != "" {
			t.Errorf("If-None-Match %q: 304 has body %q, encoding %q", inm, b, resp.Header.Get("Content-Encoding"))
		}
		if resp.Header.Get("ETag") != etag || resp.Header.Get("Vary") != "Accept-Encoding" ||
			resp.Header.Get("Cache-Control") != "private, max-age=0, must-revalidate" {
			t.Errorf("If-None-Match %q: 304 headers %v", inm, resp.Header)
		}
	}
	if resp, b := getCharacters(t, ts.URL, "?language=ja", map[string]string{"If-None-Match": `W/"other"`}); resp.StatusCode != http.StatusOK || !bytes.Equal(b, body) {
		t.Errorf("stale validator: status %d", resp.StatusCode)
	}

	// A change to the universe moves the ETag.
	if _, err := sqlDB.Exec(`UPDATE entries SET attrs = '{"src":"kd2","grade":"2"}', updated_at = '2099-01-01T00:00:00Z' WHERE id = ?`, ids.nichi); err != nil {
		t.Fatal(err)
	}
	resp, _ = getCharacters(t, ts.URL, "?language=ja", map[string]string{"If-None-Match": etag})
	if resp.StatusCode != http.StatusOK || resp.Header.Get("ETag") == etag {
		t.Errorf("after a change: status %d, ETag %q (was %q)", resp.StatusCode, resp.Header.Get("ETag"), etag)
	}
}

func TestCharactersGzip(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedCharacters(t, sqlDB)
	_, plain := getCharacters(t, ts.URL, "?language=zh", nil)

	for _, ae := range []string{"gzip", "br, gzip;q=0.8", "GZIP", "*"} {
		resp, body := getCharacters(t, ts.URL, "?language=zh", map[string]string{"Accept-Encoding": ae})
		if resp.Header.Get("Content-Encoding") != "gzip" {
			t.Errorf("Accept-Encoding %q: Content-Encoding %q, want gzip", ae, resp.Header.Get("Content-Encoding"))
			continue
		}
		if resp.Header.Get("Content-Length") != "" && resp.Header.Get("Content-Length") != itoa(int64(len(body))) {
			t.Errorf("Accept-Encoding %q: Content-Length %s for %d bytes", ae, resp.Header.Get("Content-Length"), len(body))
		}
		zr, err := gzip.NewReader(bytes.NewReader(body))
		if err != nil {
			t.Fatalf("Accept-Encoding %q: %v", ae, err)
		}
		got, err := io.ReadAll(zr)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, plain) {
			t.Errorf("Accept-Encoding %q: decompressed %s, want %s", ae, got, plain)
		}
		if resp.Header.Get("Vary") != "Accept-Encoding" {
			t.Errorf("Accept-Encoding %q: Vary %q", ae, resp.Header.Get("Vary"))
		}
	}
	for _, ae := range []string{"", "identity", "gzip;q=0", "br", "x-gzip-not"} {
		resp, body := getCharacters(t, ts.URL, "?language=zh", map[string]string{"Accept-Encoding": ae})
		if resp.Header.Get("Content-Encoding") != "" || !bytes.Equal(body, plain) {
			t.Errorf("Accept-Encoding %q: Content-Encoding %q, body %s", ae, resp.Header.Get("Content-Encoding"), body)
		}
	}
}

// A database seeded before the level attrs: the fallback lists marked
// stale; a current one carries no stale key (exact bodies above).
func TestCharactersStale(t *testing.T) {
	ts, sqlDB := newServer(t)
	st := lexicon.Store{DB: sqlDB}
	var dict int64
	if err := sqlDB.QueryRow(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES ('d', 'd', '1', 'x', 'x', '2026-01-01T00:00:00Z') RETURNING id`).Scan(&dict); err != nil {
		t.Fatal(err)
	}
	id, err := st.Put(context.Background(), &lexicon.Entry{Language: "ja", Kind: "character", Key: "日",
		Forms: []lexicon.Form{{Text: "日"}}, Attrs: map[string]string{"strokes": "4"}}, dict)
	if err != nil {
		t.Fatal(err)
	}
	_, body := getCharacters(t, ts.URL, "?language=ja", nil)
	if want := `{"language":"ja","count":1,"stale":true,"chars":[{"i":` + itoa(id) + `,"c":"日","s":4}]}`; string(body) != want {
		t.Errorf("stale ja body =\n%s\nwant\n%s", body, want)
	}
	_, body = getCharacters(t, ts.URL, "?language=zh", nil)
	if want := `{"language":"zh","count":0,"stale":true,"chars":[]}`; string(body) != want {
		t.Errorf("empty zh body = %s, want %s", body, want)
	}
}

// Concurrent first loads of both languages share the cache safely and
// all get the same body.
func TestCharactersConcurrentLoads(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedCharacters(t, sqlDB)
	_, wantJA := getCharacters(t, ts.URL, "?language=ja", nil)
	_, wantZH := getCharacters(t, ts.URL, "?language=zh", nil)
	// A write moves the version so the loads below rebuild concurrently.
	if _, err := sqlDB.Exec(`UPDATE dictionaries SET updated_at = '2099-01-01T00:00:00Z'`); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			query, want := "?language=ja", wantJA
			if i%2 == 1 {
				query, want = "?language=zh", wantZH
			}
			req, _ := http.NewRequest(http.MethodGet, ts.URL+"/api/characters"+query, nil)
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Error(err)
				return
			}
			defer resp.Body.Close()
			got, _ := io.ReadAll(resp.Body)
			if !bytes.Equal(got, want) {
				t.Errorf("%s: body %s, want %s", query, got, want)
			}
		}()
	}
	wg.Wait()
}

// The response decodes into the shape the web client declares.
func TestCharactersDecodesAsClientRows(t *testing.T) {
	ts, sqlDB := newServer(t)
	ids := seedCharacters(t, sqlDB)
	_, body := getCharacters(t, ts.URL, "?language=zh", nil)
	type charRow struct {
		I                   int64
		C                   string
		S, G, J, F, T, B, H *int
		R, M                *string
		V                   []string
	}
	var got struct {
		Language string
		Count    int
		Chars    []charRow
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Count != 1 || len(got.Chars) != 1 || got.Chars[0].I != ids.ai || !reflect.DeepEqual(got.Chars[0].V, []string{"愛"}) {
		t.Errorf("decoded %+v", got)
	}
}

// k is the Kangxi number of a character's radical link (format 3): the
// served 語 row has the shape of the contract example, and a character
// without a radical link omits k.
func TestCharactersRadicalNumber(t *testing.T) {
	ts, sqlDB := newServer(t)
	ctx := context.Background()
	st := lexicon.Store{DB: sqlDB}
	var dict int64
	if err := sqlDB.QueryRow(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES ('d', 'd', '1', 'x', 'x', '2026-01-01T00:00:00Z') RETURNING id`).Scan(&dict); err != nil {
		t.Fatal(err)
	}
	put := func(char string, attrs map[string]string) int64 {
		t.Helper()
		id, err := st.Put(ctx, &lexicon.Entry{Language: "ja", Kind: "character", Key: char,
			Forms: []lexicon.Form{{Text: char}}, Attrs: attrs}, dict)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	gen := put("言", map[string]string{"src": "kd2", "strokes": "7"})
	gid := put("語", map[string]string{"src": "kd2", "strokes": "14"})
	if err := st.Link(ctx, gid, gen, lexicon.LinkRadical); err != nil {
		t.Fatal(err)
	}

	resp, body := getCharacters(t, ts.URL, "?language=ja", nil)
	if !strings.Contains(resp.Header.Get("ETag"), `"chars3-`) {
		t.Errorf("ETag = %q, want format 3", resp.Header.Get("ETag"))
	}
	var got struct {
		Chars []map[string]any `json:"chars"`
	}
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../../docs/contracts/radicals/components-response.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Row     map[string]any `json:"charactersRow"`
		Without map[string]any `json:"charactersRowWithoutRadical"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(got.Chars) != 2 {
		t.Fatalf("chars = %v", got.Chars)
	}
	gotGo := got.Chars[1] // 言 U+8A00 < 語 U+8A9E
	gotGo["i"] = fx.Row["i"]
	if !reflect.DeepEqual(gotGo, fx.Row) {
		t.Errorf("語 row = %v, want %v", gotGo, fx.Row)
	}
	if _, ok := got.Chars[0]["k"]; ok {
		t.Errorf("言 row has k: %v", got.Chars[0])
	}
	if _, ok := fx.Without["k"]; ok {
		t.Errorf("fixture row without radical has k")
	}
}
