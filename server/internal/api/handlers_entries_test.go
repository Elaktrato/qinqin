package api_test

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strconv"
	"testing"

	"qinqin/internal/api"
	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// entryBody mirrors the JSON body of GET /api/entries/{id}.
type entryBody struct {
	model.EntryBase
	Forms       []formBody        `json:"forms"`
	Senses      []senseBody       `json:"senses"`
	SenseGroups []senseGroupBody  `json:"senseGroups"`
	Variants    []model.EntryBase `json:"variants"`
	Badges      []badgeBody       `json:"badges"`
	Sentences   []model.Sentence  `json:"sentences"`
	Characters  []characterBody   `json:"characters"`
}

// characterBody mirrors one character of a word entry response.
type characterBody struct {
	ID      int64  `json:"id"`
	Written string `json:"written"`
	Reading *struct {
		Type  string `json:"type"`
		Value string `json:"value"`
	} `json:"reading"`
	Gloss   string `json:"gloss"`
	Radical *struct {
		ID      int64  `json:"id"`
		Written string `json:"written"`
	} `json:"radical"`
	Strokes int `json:"strokes"`
	Levels  []struct {
		Scheme string `json:"scheme"`
		Level  string `json:"level"`
	} `json:"levels"`
}

// formBody mirrors one written form in an entry response.
type formBody struct {
	Text  string   `json:"text"`
	Flags []string `json:"flags"`
	Pri   int      `json:"pri"`
}

// senseBody mirrors one gloss in an entry response's flat senses.
type senseBody struct {
	DictionaryID   int64  `json:"dictionaryId"`
	DictionaryName string `json:"dictionaryName"`
	PackID         string `json:"packId"`
	License        string `json:"license"`
	Attribution    string `json:"attribution"`
	Gloss          string `json:"gloss"`
}

// senseGroupBody mirrors one sense in an entry response's senseGroups.
type senseGroupBody struct {
	DictionaryID   int64    `json:"dictionaryId"`
	DictionaryName string   `json:"dictionaryName"`
	PackID         string   `json:"packId"`
	License        string   `json:"license"`
	Attribution    string   `json:"attribution"`
	POS            []string `json:"pos"`
	Tags           []string `json:"tags"`
	Glosses        []string `json:"glosses"`
	Xrefs          []string `json:"xrefs"`
}

// newServer opens a fresh migrated database and serves the API on it.
func newServer(t *testing.T) (*httptest.Server, *sql.DB) {
	t.Helper()
	sqlDB := dbtest.Open(t)
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil))
	t.Cleanup(ts.Close)
	return ts, sqlDB
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

// lexID returns the id of the active lexicon entry (language, kind, key),
// failing the test when there is none.
func lexID(t *testing.T, sqlDB *sql.DB, language, kind, key string) int64 {
	t.Helper()
	var id int64
	if err := sqlDB.QueryRow(`SELECT id FROM entries
		WHERE language = ? AND kind = ? AND ext_key = ? AND deleted_at IS NULL`,
		language, kind, key).Scan(&id); err != nil {
		t.Fatalf("lexicon entry %s/%s/%s: %v", language, kind, key, err)
	}
	return id
}

// dictID returns the id of the dictionaries row of packID.
func dictID(t *testing.T, sqlDB *sql.DB, packID string) int64 {
	t.Helper()
	var id int64
	if err := sqlDB.QueryRow(`SELECT id FROM dictionaries WHERE pack_id = ?`, packID).Scan(&id); err != nil {
		t.Fatalf("dictionary %s: %v", packID, err)
	}
	return id
}

// findReading returns e's reading of the given type, or nil.
func findReading(e model.EntryBase, readType string) *model.Reading {
	for i := range e.Readings {
		if e.Readings[i].Type == readType {
			return &e.Readings[i]
		}
	}
	return nil
}

// entriesJMdict is a JMdict excerpt in the real element and entity shape:
// 刷る (imported first, no uk) and 為る (uk, with priority) both read
// する; 為る has two senses (the second inherits the first's part of
// speech) and a cross-reference.
const entriesJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY rK "rarely used kanji form">
<!ENTITY uk "word usually written using kana alone">
<!ENTITY vs-i "suru verb - included">
<!ENTITY vt "transitive verb">
<!ENTITY v5r "Godan verb with 'ru' ending">
]>
<JMdict>
<entry>
<ent_seq>1397500</ent_seq>
<k_ele><keb>刷る</keb><ke_pri>news1</ke_pri></k_ele>
<r_ele><reb>する</reb><re_pri>news1</re_pri></r_ele>
<sense><pos>&v5r;</pos><gloss>to print</gloss></sense>
</entry>
<entry>
<ent_seq>1157170</ent_seq>
<k_ele><keb>為る</keb><ke_inf>&rK;</ke_inf></k_ele>
<r_ele><reb>する</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&vs-i;</pos><pos>&vt;</pos><misc>&uk;</misc><gloss>to do</gloss><gloss>to carry out</gloss></sense>
<sense><xref>為さる</xref><gloss>to make</gloss></sense>
</entry>
</JMdict>
`

// entriesCedict is a CC-CEDICT excerpt: 行 has two readings (one merged
// entry), 复 and 複 feed the Unihan variant links.
const entriesCedict = "發 发 [fa1] /to send out/to issue/\n" +
	"好 好 [hao3] /good/\n" +
	"行 行 [xing2] /to walk/\n" +
	"行 行 [hang2] /row/\n" +
	"複 複 [fu4] /complex/\n"

// seedEntries imports the JMdict and CC-CEDICT excerpts and the committed
// Unihan fixture (好 under radical 38 女; 复 with variants 復 and 複) with
// the real lexicon importers.
func seedEntries(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	lang.Register(lang.Ja{})
	lang.Register(lang.Zh{})
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "jmdict-test", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	}, "jmdict.xml", entriesJMdict)
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "cedict-test", Name: "CC-CEDICT test", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "MDBG", Format: "cedict",
	}, "dictionary.txt", entriesCedict)
	unihan, err := os.ReadFile("../dict/testdata/unihan-sample.txt")
	if err != nil {
		t.Fatalf("read unihan fixture: %v", err)
	}
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "unihan", Name: "Unihan database", Version: "1.0", Type: "dictionary", Language: "zh",
		License: "Unicode License v3 (fixture)", Attribution: "Unicode Consortium (fixture attribution)",
		Format: "unihan",
	}, "dictionary.txt", string(unihan))
}

// getEntryBody fetches GET /api/entries/{id} and decodes its body.
func getEntryBody(t *testing.T, tsURL string, id int64) entryBody {
	t.Helper()
	resp := getEntry(t, tsURL, "/api/entries/"+strconv.FormatInt(id, 10))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/entries/%d: status = %d, want %d", id, resp.StatusCode, http.StatusOK)
	}
	var body entryBody
	decodeJSON(t, resp, &body)
	return body
}

func TestGetEntryJapaneseWord(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	suru := lexID(t, sqlDB, "ja", "word", "j:1157170")
	jm := dictID(t, sqlDB, "jmdict-test")

	// The raw JSON keeps every earlier field name and adds forms and
	// senseGroups.
	resp := getEntry(t, ts.URL, "/api/entries/"+strconv.FormatInt(suru, 10))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET 為る: status = %d", resp.StatusCode)
	}
	var raw map[string]json.RawMessage
	decodeJSON(t, resp, &raw)
	for _, k := range []string{"id", "language", "kind", "written", "readings", "attrs", "radicalId",
		"updatedAt", "deletedAt", "senses", "variants", "badges", "sentences", "forms", "senseGroups", "characters"} {
		if _, ok := raw[k]; !ok {
			t.Errorf("entry JSON lacks %q: %s", k, raw)
		}
	}

	body := getEntryBody(t, ts.URL, suru)
	if body.ID != suru || body.Language != "ja" || body.Kind != "word" || body.Written != "する" {
		// 為る is usually written in kana: its display form is する.
		t.Errorf("entry = %+v, want the 為る word shown as する", body.EntryBase)
	}
	wantReadings := []model.Reading{
		{Type: "kana", Value: "する", Plain: "する", Ord: 0},
		{Type: "romaji", Value: "suru", Plain: "suru", Ord: 1},
	}
	if !reflect.DeepEqual(body.Readings, wantReadings) {
		t.Errorf("readings = %+v, want %+v", body.Readings, wantReadings)
	}
	if body.Attrs == nil || len(body.Attrs) != 0 || body.RadicalID != nil || body.UpdatedAt.IsZero() {
		t.Errorf("attrs/radicalId/updatedAt = %v/%v/%v, want {}/null/set", body.Attrs, body.RadicalID, body.UpdatedAt)
	}
	if len(body.Forms) != 1 || body.Forms[0].Text != "為る" || !reflect.DeepEqual(body.Forms[0].Flags, []string{"rK"}) {
		t.Errorf("forms = %+v, want 為る flagged rK", body.Forms)
	}
	sense := func(g string) senseBody {
		return senseBody{DictionaryID: jm, DictionaryName: "JMdict test", PackID: "jmdict-test",
			License: "CC BY-SA 4.0", Attribution: "EDRDG", Gloss: g}
	}
	if want := []senseBody{sense("to do"), sense("to carry out"), sense("to make")}; !reflect.DeepEqual(body.Senses, want) {
		t.Errorf("senses = %+v, want %+v", body.Senses, want)
	}
	group := func(pos, tags, glosses, xrefs []string) senseGroupBody {
		return senseGroupBody{DictionaryID: jm, DictionaryName: "JMdict test", PackID: "jmdict-test",
			License: "CC BY-SA 4.0", Attribution: "EDRDG", POS: pos, Tags: tags, Glosses: glosses, Xrefs: xrefs}
	}
	wantGroups := []senseGroupBody{
		group([]string{"vs-i", "vt"}, []string{"uk"}, []string{"to do", "to carry out"}, []string{}),
		group([]string{"vs-i", "vt"}, []string{}, []string{"to make"}, []string{"為さる"}),
	}
	if !reflect.DeepEqual(body.SenseGroups, wantGroups) {
		t.Errorf("senseGroups = %+v, want %+v", body.SenseGroups, wantGroups)
	}
	for name, l := range map[string]int{"variants": len(body.Variants), "badges": len(body.Badges), "sentences": len(body.Sentences)} {
		if l != 0 {
			t.Errorf("%s has %d items, want none", name, l)
		}
	}
	if body.Variants == nil || body.Badges == nil || body.Sentences == nil {
		t.Errorf("variants/badges/sentences = %v/%v/%v, want empty arrays, never null", body.Variants, body.Badges, body.Sentences)
	}
}

func TestGetEntryChineseCharacter(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)

	// 行: one CEDICT entry for both readings, each with its bopomofo.
	xing := getEntryBody(t, ts.URL, lexID(t, sqlDB, "zh", "character", "行"))
	wantReadings := []model.Reading{
		{Type: "pinyin", Value: "xíng", Plain: "xing", Ord: 0},
		{Type: "pinyin", Value: "háng", Plain: "hang", Ord: 1},
		{Type: "bopomofo", Value: "ㄒㄧㄥˊ", Plain: "ㄒㄧㄥˊ", Ord: 2},
		{Type: "bopomofo", Value: "ㄏㄤˊ", Plain: "ㄏㄤˊ", Ord: 3},
	}
	if xing.Written != "行" || !reflect.DeepEqual(xing.Readings, wantReadings) {
		t.Errorf("行 = %q %+v, want readings %+v", xing.Written, xing.Readings, wantReadings)
	}
	if len(xing.SenseGroups) != 2 || xing.SenseGroups[1].Glosses[0] != "row" || xing.SenseGroups[0].POS == nil {
		t.Errorf("行 senseGroups = %+v, want one per CEDICT line", xing.SenseGroups)
	}

	// 发 carries its traditional form; senses expand one row per gloss.
	fa := getEntryBody(t, ts.URL, lexID(t, sqlDB, "zh", "character", "发"))
	if len(fa.Forms) != 2 || fa.Forms[1].Text != "發" || !reflect.DeepEqual(fa.Forms[1].Flags, []string{"trad"}) {
		t.Errorf("发 forms = %+v, want 发 then 發 (trad)", fa.Forms)
	}
	if len(fa.Senses) != 2 || fa.Senses[0].Gloss != "to send out" || fa.Senses[1].Gloss != "to issue" {
		t.Errorf("发 senses = %+v, want one row per gloss", fa.Senses)
	}

	// 好: radical from the Unihan radical link; senses from CEDICT then
	// Unihan, in dictionary order.
	hao := getEntryBody(t, ts.URL, lexID(t, sqlDB, "zh", "character", "好"))
	nu := lexID(t, sqlDB, "zh", "character", "女")
	if hao.RadicalID == nil || *hao.RadicalID != nu {
		t.Errorf("好 radicalId = %v, want 女 (%d)", hao.RadicalID, nu)
	}
	if len(hao.Senses) != 2 || hao.Senses[0].PackID != "cedict-test" || hao.Senses[1].PackID != "unihan" ||
		hao.Senses[1].Gloss != "good, excellent, fine; well" {
		t.Errorf("好 senses = %+v, want CEDICT's then Unihan's", hao.Senses)
	}

	// 复 lists its Unihan variants by id, with their readings.
	fu := getEntryBody(t, ts.URL, lexID(t, sqlDB, "zh", "character", "复"))
	if len(fu.Variants) != 2 {
		t.Fatalf("复 variants = %+v, want 復 and 複", fu.Variants)
	}
	got := map[string]model.EntryBase{}
	for _, v := range fu.Variants {
		got[v.Written] = v
	}
	if py := findReading(got["複"], "pinyin"); py == nil || py.Plain != "fu" {
		t.Errorf("variant 複 = %+v, want its pinyin fù", got["複"])
	}
	if _, ok := got["復"]; !ok || got["複"].Attrs == nil {
		t.Errorf("variants = %+v, want 復 and 複 with attrs", fu.Variants)
	}

	// Unknown and malformed ids are 404.
	for _, path := range []string{"/api/entries/999999", "/api/entries/NaN"} {
		if resp := getEntry(t, ts.URL, path); resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s: status = %d, want %d", path, resp.StatusCode, http.StatusNotFound)
		}
	}
}

func TestPutEntryEndpoint(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	fa := lexID(t, sqlDB, "zh", "character", "发")
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
	if want := []model.Reading{{Type: "pinyin", Value: "fa4"}}; !reflect.DeepEqual(body.Readings, want) {
		t.Errorf("PUT response readings = %+v, want exactly the saved %+v (no plain, nothing derived)", body.Readings, want)
	}
	if len(body.Senses) != 2 || len(body.Forms) != 2 {
		t.Errorf("PUT response = %+v, want the full entry body", body)
	}
	if body.Characters == nil || len(body.Characters) != 0 {
		t.Errorf("PUT response characters = %#v, want [] (a character has none)", body.Characters)
	}

	// GET applies the caller's patch for alice only; bob and anonymous
	// callers see the shared entry.
	get := doJSON(t, http.MethodGet, ts.URL, path, alice, nil)
	body = entryBody{}
	decodeJSON(t, get, &body)
	if body.Written != "發" || len(body.Readings) != 1 || body.Readings[0].Value != "fa4" {
		t.Errorf("GET as alice = %q/%+v, want her patch", body.Written, body.Readings)
	}
	for name, token := range map[string]string{"bob": bob, "anonymous": ""} {
		resp := doJSON(t, http.MethodGet, ts.URL, path, token, nil)
		body = entryBody{}
		decodeJSON(t, resp, &body)
		if body.Written != "发" {
			t.Errorf("GET as %s: written = %q, want the shared 发", name, body.Written)
		}
		if py := findReading(body.EntryBase, "pinyin"); py == nil || py.Value != "fā" || py.Plain != "fa" {
			t.Errorf("GET as %s: readings = %+v, want the shared pinyin fā/fa", name, body.Readings)
		}
		if bm := findReading(body.EntryBase, "bopomofo"); bm == nil || bm.Value != "ㄈㄚ" {
			t.Errorf("GET as %s: readings = %+v, want the shared bopomofo ㄈㄚ", name, body.Readings)
		}
	}

	// A second PUT replaces the patch wholesale: alice patches
	// readings only, and her written form falls back to the shared one.
	put = doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{
		"readings": []map[string]string{{"type": "pinyin", "value": "fa1"}},
	})
	body = entryBody{}
	decodeJSON(t, put, &body)
	if body.Written != "发" || len(body.Readings) != 1 || body.Readings[0].Value != "fa1" {
		t.Errorf("PUT replacement response = %q/%+v, want shared 发 and her fa1", body.Written, body.Readings)
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

func TestCharsUnderRadical(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	nu := lexID(t, sqlDB, "zh", "character", "女")

	resp := getEntry(t, ts.URL, "/api/entries/"+strconv.FormatInt(nu, 10)+"/chars")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET 女/chars: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var chars []model.EntryBase
	decodeJSON(t, resp, &chars)
	if len(chars) != 1 || chars[0].Written != "好" || chars[0].RadicalID == nil || *chars[0].RadicalID != nu {
		t.Errorf("chars under 女 = %+v, want just 好 with its radicalId", chars)
	}

	// A character no other is classified under answers [], never null.
	resp = getEntry(t, ts.URL, "/api/entries/"+strconv.FormatInt(lexID(t, sqlDB, "zh", "character", "行"), 10)+"/chars")
	chars = nil
	decodeJSON(t, resp, &chars)
	if chars == nil || len(chars) != 0 {
		t.Errorf("chars under 行 = %v, want an empty array", chars)
	}

	// Unknown and malformed ids are 404.
	for _, path := range []string{"/api/entries/999999/chars", "/api/entries/NaN/chars"} {
		if resp := getEntry(t, ts.URL, path); resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s: status = %d, want %d", path, resp.StatusCode, http.StatusNotFound)
		}
	}
}

// TestPutEntryUnknownIDBeatsBadBody pins the precedence: a missing entry is
// 404 even when the body would also be rejected (404 before 400).
func TestPutEntryUnknownIDBeatsBadBody(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")

	for name, body := range map[string]map[string]any{
		"empty written": {"written": ""},
		"bad reading":   {"readings": []map[string]string{{"type": "", "value": ""}}},
	} {
		resp := doJSON(t, http.MethodPut, ts.URL, "/api/entries/999999", alice, body)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("PUT unknown entry with %s: status = %d, want %d", name, resp.StatusCode, http.StatusNotFound)
		}
	}
}
