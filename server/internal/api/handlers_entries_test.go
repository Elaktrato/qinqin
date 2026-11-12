package api_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"qinqin/internal/api"
	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// entryBody mirrors the JSON body of GET /api/entries/{id}.
type entryBody struct {
	model.Entry
	Senses    []senseBody      `json:"senses"`
	Variants  []model.Entry    `json:"variants"`
	Badges    []badgeBody      `json:"badges"`
	Sentences []model.Sentence `json:"sentences"`
}

// senseBody mirrors one sense in an entry response.
type senseBody struct {
	DictionaryID   int64  `json:"dictionaryId"`
	DictionaryName string `json:"dictionaryName"`
	PackID         string `json:"packId"`
	License        string `json:"license"`
	Attribution    string `json:"attribution"`
	Gloss          string `json:"gloss"`
}

// newServer opens a fresh migrated database and serves the API on it.
func newServer(t *testing.T) (*httptest.Server, *sql.DB) {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil))
	t.Cleanup(ts.Close)
	return ts, sqlDB
}

// mustUpsertEntry upserts e on st and returns its id, failing the test on error.
func mustUpsertEntry(t *testing.T, st entries.Store, e *model.Entry) int64 {
	t.Helper()
	id, err := st.Upsert(context.Background(), e)
	if err != nil {
		t.Fatalf("upsert %q (%s/%s): %v", e.Written, e.Kind, e.Language, err)
	}
	return id
}

// getEntry fetches path from ts and returns the undecoded response.
func getEntry(t *testing.T, tsURL, path string) *http.Response {
	t.Helper()
	resp, err := http.Get(tsURL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// writeDictPack writes a json dictionary pack into a fresh temp
// directory and returns its path.
func writeDictPack(t *testing.T, m dict.Manifest, dictionary string) string {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), manifest, 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "dictionary.json"), []byte(dictionary), 0o644); err != nil {
		t.Fatalf("write dictionary.json: %v", err)
	}
	return dir
}

// importDictPack loads and imports the pack in dir.
func importDictPack(t *testing.T, sqlDB *sql.DB, dir string) {
	t.Helper()
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(%s): %v", dir, err)
	}
	if _, err := dict.Import(context.Background(), sqlDB, pack); err != nil {
		t.Fatalf("import pack %s: %v", pack.Manifest.ID, err)
	}
}

// findReading returns e's reading of the given type, or nil.
func findReading(e model.Entry, readType string) *model.Reading {
	for i := range e.Readings {
		if e.Readings[i].Type == readType {
			return &e.Readings[i]
		}
	}
	return nil
}

func TestGetEntryEndpoint(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	ts, sqlDB := newServer(t)
	ctx := context.Background()
	st := entries.Store{DB: sqlDB}

	hao := mustUpsertEntry(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "好",
		Readings: []model.Reading{{Type: "pinyin", Value: "hǎo"}},
	})
	fa := mustUpsertEntry(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "发",
		Readings: []model.Reading{{Type: "pinyin", Value: "fā"}},
	})
	faTrad := mustUpsertEntry(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "發",
		Readings: []model.Reading{{Type: "pinyin", Value: "fā"}},
	})
	if err := st.LinkVariant(ctx, fa, faTrad); err != nil {
		t.Fatalf("link 发↔發: %v", err)
	}

	// An entry with variants carries them along.
	resp := getEntry(t, ts.URL, "/api/entries/"+strconv.FormatInt(fa, 10))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET 发: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var body entryBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode entry response: %v", err)
	}
	if body.ID != fa || body.Language != "zh" || body.Kind != "character" || body.Written != "发" {
		t.Errorf("entry body = %+v, want the 发 entry", body.Entry)
	}
	if py := findReading(body.Entry, "pinyin"); py == nil || py.Value != "fā" || py.Plain != "fa" {
		t.Errorf("entry readings = %+v, want pinyin fā/fa", body.Readings)
	}
	if bm := findReading(body.Entry, "bopomofo"); bm == nil || bm.Value != "ㄈㄚ" {
		t.Errorf("entry readings = %+v, want derived bopomofo ㄈㄚ", body.Readings)
	}
	if body.Attrs == nil {
		t.Errorf("attrs = null, want an empty object")
	}
	if len(body.Variants) != 1 || body.Variants[0].ID != faTrad || body.Variants[0].Written != "發" {
		t.Errorf("variants = %+v, want just 發", body.Variants)
	}
	if py := findReading(body.Variants[0], "pinyin"); py == nil || py.Plain != "fa" {
		t.Errorf("variant readings = %+v, want pinyin plain fa", body.Variants[0].Readings)
	}

	// An entry without variants returns an empty variants array.
	resp = getEntry(t, ts.URL, "/api/entries/"+strconv.FormatInt(hao, 10))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET 好: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	body = entryBody{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode entry response: %v", err)
	}
	if body.Written != "好" {
		t.Errorf("entry body = %+v, want the 好 entry", body.Entry)
	}
	if body.Variants == nil || len(body.Variants) != 0 {
		t.Errorf("variants of unlinked entry = %v, want an empty array", body.Variants)
	}
	if body.Readings == nil || len(body.Readings) != 2 {
		t.Errorf("readings of 好 = %v, want pinyin plus derived bopomofo", body.Readings)
	}

	// Unknown and malformed ids are 404.
	for _, path := range []string{"/api/entries/999999", "/api/entries/NaN"} {
		resp = getEntry(t, ts.URL, path)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s: status = %d, want %d", path, resp.StatusCode, http.StatusNotFound)
		}
	}
}

func TestPutEntryEndpoint(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	ts, sqlDB := newServer(t)
	st := entries.Store{DB: sqlDB}

	fa := mustUpsertEntry(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "发",
		Readings: []model.Reading{{Type: "pinyin", Value: "fā"}},
	})
	path := "/api/entries/" + strconv.FormatInt(fa, 10)

	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)

	// PUT requires authentication.
	if resp := doJSON(t, http.MethodPut, ts.URL, path, "", map[string]any{"written": "發"}); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("PUT without token: status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}

	// PUT stores the caller's patch; the response is the caller's
	// patched view, readings exactly as saved — nothing re-derived.
	put := doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{
		"written":  "發",
		"readings": []map[string]string{{"type": "pinyin", "value": "fa4"}},
	})
	if put.StatusCode != http.StatusOK {
		t.Fatalf("PUT patch: status = %d, want %d", put.StatusCode, http.StatusOK)
	}
	var body entryBody
	decodeJSON(t, put, &body)
	if body.ID != fa || body.Written != "發" {
		t.Errorf("PUT response = id %d, written %q, want 发's id and alice's patched 發", body.ID, body.Written)
	}
	if len(body.Readings) != 1 || body.Readings[0].Type != "pinyin" || body.Readings[0].Value != "fa4" {
		t.Errorf("PUT response readings = %+v, want exactly the saved pinyin fa4", body.Readings)
	}
	if body.Readings[0].Plain != "" {
		t.Errorf("PUT response reading plain = %q, want empty — overlays are never re-derived", body.Readings[0].Plain)
	}

	// GET applies the caller's patch for alice only; bob and anonymous
	// callers see the shared entry.
	get := doJSON(t, http.MethodGet, ts.URL, path, alice, nil)
	if get.StatusCode != http.StatusOK {
		t.Fatalf("GET 发 as alice: status = %d, want %d", get.StatusCode, http.StatusOK)
	}
	body = entryBody{}
	decodeJSON(t, get, &body)
	if body.Written != "發" {
		t.Errorf("GET as alice: written = %q, want her patched 發", body.Written)
	}
	if len(body.Readings) != 1 || body.Readings[0].Value != "fa4" {
		t.Errorf("GET as alice: readings = %+v, want exactly her saved pinyin fa4", body.Readings)
	}

	for name, token := range map[string]string{"bob": bob, "anonymous": ""} {
		resp := doJSON(t, http.MethodGet, ts.URL, path, token, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET 发 as %s: status = %d, want %d", name, resp.StatusCode, http.StatusOK)
		}
		body = entryBody{}
		decodeJSON(t, resp, &body)
		if body.Written != "发" {
			t.Errorf("GET as %s: written = %q, want the shared 发", name, body.Written)
		}
		if py := findReading(body.Entry, "pinyin"); py == nil || py.Value != "fā" || py.Plain != "fa" {
			t.Errorf("GET as %s: readings = %+v, want the shared pinyin fā/fa", name, body.Readings)
		}
		if bm := findReading(body.Entry, "bopomofo"); bm == nil || bm.Value != "ㄈㄚ" {
			t.Errorf("GET as %s: readings = %+v, want the shared derived bopomofo ㄈㄚ", name, body.Readings)
		}
	}

	// A second PUT replaces the patch wholesale: alice patches
	// readings only, and her written form falls back to the shared one.
	put = doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{
		"readings": []map[string]string{{"type": "pinyin", "value": "fa1"}},
	})
	if put.StatusCode != http.StatusOK {
		t.Fatalf("PUT replacement patch: status = %d, want %d", put.StatusCode, http.StatusOK)
	}
	body = entryBody{}
	decodeJSON(t, put, &body)
	if body.Written != "发" {
		t.Errorf("PUT replacement response: written = %q, want the shared 发", body.Written)
	}
	if len(body.Readings) != 1 || body.Readings[0].Value != "fa1" {
		t.Errorf("PUT replacement response: readings = %+v, want exactly her saved pinyin fa1", body.Readings)
	}

	// An all-nil patch is a valid no-op: every field shows its shared
	// value.
	if resp := doJSON(t, http.MethodPut, ts.URL, path, bob, map[string]any{}); resp.StatusCode != http.StatusOK {
		t.Errorf("PUT empty patch: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	resp := doJSON(t, http.MethodGet, ts.URL, path, bob, nil)
	body = entryBody{}
	decodeJSON(t, resp, &body)
	if body.Written != "发" || len(body.Readings) != 2 {
		t.Errorf("GET as bob after empty patch = %q/%+v, want the shared entry", body.Written, body.Readings)
	}

	// Unknown and malformed ids are 404; malformed bodies, an empty
	// written form, and readings without a type or value are 400.
	for _, bad := range []string{"/api/entries/999999", "/api/entries/NaN"} {
		if resp := doJSON(t, http.MethodPut, ts.URL, bad, alice, map[string]any{"written": "發"}); resp.StatusCode != http.StatusNotFound {
			t.Errorf("PUT %s: status = %d, want %d", bad, resp.StatusCode, http.StatusNotFound)
		}
	}
	for name, req := range map[string]any{
		"malformed body":  "not-an-object",
		"empty written":   map[string]any{"written": ""},
		"reading no type": map[string]any{"readings": []map[string]string{{"value": "fa4"}}},
		"reading no val":  map[string]any{"readings": []map[string]string{{"type": "pinyin"}}},
	} {
		if resp := doJSON(t, http.MethodPut, ts.URL, path, alice, req); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("PUT %s: status = %d, want %d", name, resp.StatusCode, http.StatusBadRequest)
		}
	}
}

func TestEntryReturnsSenses(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	ts, sqlDB := newServer(t)
	ctx := context.Background()

	// Two dictionaries gloss 好 — the first with two senses — so the
	// entry's senses come from both, ordered by dictionary then ord.
	importDictPack(t, sqlDB, writeDictPack(t, dict.Manifest{
		ID: "zdic-demo", Name: "Zdic demo", Version: "1.0", Type: "dictionary",
		Language: "zh", License: "CC BY-SA 4.0", Attribution: "Zdic contributors",
		Format: "json",
	}, `{"entries":[{"written":"好","kind":"character",`+
		`"readings":[{"type":"pinyin","value":"hǎo"}],`+
		`"glosses":["good","fine"]}]}`))
	importDictPack(t, sqlDB, writeDictPack(t, dict.Manifest{
		ID: "wl-demo", Name: "Word list demo", Version: "2.0", Type: "dictionary",
		Language: "zh", License: "CC0 1.0", Attribution: "Word list contributors",
		Format: "json",
	}, `{"entries":[{"written":"好","kind":"character",`+
		`"readings":[{"type":"pinyin","value":"hǎo"}],`+
		`"glosses":["well"]}]}`))

	st := entries.Store{DB: sqlDB}
	hao, err := st.GetByWritten(ctx, "好", "character", "zh")
	if err != nil {
		t.Fatalf("GetByWritten(好): %v", err)
	}
	var zdicID, wlID int64
	if err := sqlDB.QueryRow(`SELECT id FROM dictionaries WHERE pack_id = 'zdic-demo'`).Scan(&zdicID); err != nil {
		t.Fatalf("dictionary zdic-demo: %v", err)
	}
	if err := sqlDB.QueryRow(`SELECT id FROM dictionaries WHERE pack_id = 'wl-demo'`).Scan(&wlID); err != nil {
		t.Fatalf("dictionary wl-demo: %v", err)
	}

	want := []senseBody{
		{DictionaryID: zdicID, DictionaryName: "Zdic demo", PackID: "zdic-demo",
			License: "CC BY-SA 4.0", Attribution: "Zdic contributors", Gloss: "good"},
		{DictionaryID: zdicID, DictionaryName: "Zdic demo", PackID: "zdic-demo",
			License: "CC BY-SA 4.0", Attribution: "Zdic contributors", Gloss: "fine"},
		{DictionaryID: wlID, DictionaryName: "Word list demo", PackID: "wl-demo",
			License: "CC0 1.0", Attribution: "Word list contributors", Gloss: "well"},
	}

	// The order is stable across reads: dictionary id, then ord.
	for read := range 2 {
		resp := getEntry(t, ts.URL, "/api/entries/"+strconv.FormatInt(hao.ID, 10))
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET 好: status = %d, want %d", resp.StatusCode, http.StatusOK)
		}
		var body entryBody
		decodeJSON(t, resp, &body)
		if len(body.Senses) != len(want) {
			t.Fatalf("read %d: senses = %+v, want %+v", read, body.Senses, want)
		}
		for i := range want {
			if body.Senses[i] != want[i] {
				t.Errorf("read %d: sense %d = %+v, want %+v", read, i, body.Senses[i], want[i])
			}
		}
	}
}

func TestEntriesNeverNull(t *testing.T) {
	lang.Register(lang.Zh{})

	ts, sqlDB := newServer(t)
	st := entries.Store{DB: sqlDB}
	hao := mustUpsertEntry(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "好",
		Readings: []model.Reading{{Type: "pinyin", Value: "hǎo"}},
	})

	// An entry without senses, variants, badges, or sentences answers
	// empty arrays — a client never has to special-case null.
	resp := getEntry(t, ts.URL, "/api/entries/"+strconv.FormatInt(hao, 10))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET 好: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var body entryBody
	decodeJSON(t, resp, &body)
	if body.Senses == nil || len(body.Senses) != 0 {
		t.Errorf("senses = %v, want an empty array", body.Senses)
	}
	if body.Variants == nil || len(body.Variants) != 0 {
		t.Errorf("variants = %v, want an empty array", body.Variants)
	}
	if body.Badges == nil || len(body.Badges) != 0 {
		t.Errorf("badges = %v, want an empty array", body.Badges)
	}
	if body.Sentences == nil || len(body.Sentences) != 0 {
		t.Errorf("sentences = %v, want an empty array", body.Sentences)
	}
}

func TestCharsUnderRadical(t *testing.T) {
	lang.Register(lang.Zh{})

	ts, sqlDB := newServer(t)
	ctx := context.Background()

	// The committed Unihan fixture classifies 好 under radical 38 (女).
	data, err := os.ReadFile("../dict/testdata/unihan-sample.txt")
	if err != nil {
		t.Fatalf("read unihan fixture: %v", err)
	}
	dir := t.TempDir()
	manifest, err := json.Marshal(dict.Manifest{
		ID: "unihan", Name: "Unihan database", Version: "1.0", Type: "dictionary",
		Language: "zh", License: "Unicode License v3 (fixture)",
		Attribution: "Unicode Consortium (fixture attribution)", Format: "unihan",
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), manifest, 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "dictionary.txt"), data, 0o644); err != nil {
		t.Fatalf("write dictionary.txt: %v", err)
	}
	importDictPack(t, sqlDB, dir)

	st := entries.Store{DB: sqlDB}
	nu, err := st.GetByWritten(ctx, "女", "character", "zh")
	if err != nil {
		t.Fatalf("GetByWritten(女): %v", err)
	}

	resp := getEntry(t, ts.URL, "/api/entries/"+strconv.FormatInt(nu.ID, 10)+"/chars")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET 女/chars: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var chars []model.Entry
	decodeJSON(t, resp, &chars)
	if len(chars) != 1 || chars[0].Written != "好" {
		t.Errorf("chars under 女 = %+v, want just 好", chars)
	}

	// A radical without characters answers an empty array, never null.
	zi := mustUpsertEntry(t, st, &model.Entry{Language: "zh", Kind: "character", Written: "子"})
	resp = getEntry(t, ts.URL, "/api/entries/"+strconv.FormatInt(zi, 10)+"/chars")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET 子/chars: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	chars = nil
	decodeJSON(t, resp, &chars)
	if chars == nil || len(chars) != 0 {
		t.Errorf("chars under 子 = %v, want an empty array", chars)
	}

	// Unknown and malformed ids are 404.
	for _, path := range []string{"/api/entries/999999/chars", "/api/entries/NaN/chars"} {
		if resp := getEntry(t, ts.URL, path); resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s: status = %d, want %d", path, resp.StatusCode, http.StatusNotFound)
		}
	}
}
