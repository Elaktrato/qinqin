package api_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/freq"
	"qinqin/internal/lang"
	"qinqin/internal/levels"
)

const lookupJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY rK "rarely used kanji form">
<!ENTITY uk "word usually written using kana alone">
<!ENTITY vs-i "suru verb - included">
<!ENTITY vt "transitive verb">
<!ENTITY n "noun (common) (futsuumeishi)">
]>
<JMdict>
<entry>
<ent_seq>1157170</ent_seq>
<k_ele><keb>為る</keb><ke_inf>&rK;</ke_inf></k_ele>
<r_ele><reb>する</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&vs-i;</pos><pos>&vt;</pos><misc>&uk;</misc><gloss>to do</gloss></sense>
</entry>
<entry>
<ent_seq>1009850</ent_seq>
<k_ele><keb>下</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>した</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>below</gloss></sense>
</entry>
</JMdict>
`

const lookupCedict = "學習 学习 [xue2 xi2] /to learn/to study/\n學 学 [xue2] /to learn/\n"

// lookupImport writes a pack into a temp directory and imports it with the
// real importer of its type.
func lookupImport(t *testing.T, sqlDB *sql.DB, m dict.Manifest, file, content string) {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{"manifest.json": string(manifest), file: content} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(%s): %v", m.ID, err)
	}
	if m.Type == dict.TypeFrequency {
		_, err = freq.Import(context.Background(), sqlDB, &p)
	} else {
		_, err = dict.ImportLexicon(context.Background(), sqlDB, &p)
	}
	if err != nil {
		t.Fatalf("import %s: %v", m.ID, err)
	}
}

// seedLookup serves an API with JMdict 為る/下, a frequency pack for them
// and a small CC-CEDICT.
func seedLookup(t *testing.T) string {
	t.Helper()
	lang.Register(lang.Ja{})
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "jmdict-test", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	}, "jmdict.xml", lookupJMdict)
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "cedict-test", Name: "CC-CEDICT test", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "CC-CEDICT", Format: "cedict",
	}, "dictionary.txt", lookupCedict)
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "freq-test", Name: "Freq test", Version: "1", Type: "frequency", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "test", Format: "freq-csv",
	}, "freq.csv", "term,reading,rank\n為る,する,15\n下,した,600\n")
	return ts.URL
}

func lookupPath(language, text, offset string, kinds ...string) string {
	q := url.Values{"lang": {language}, "text": {text}, "offset": {offset}, "kind": kinds}
	return "/api/lookup?" + q.Encode()
}

func lookupRaw(t *testing.T, tsURL, path string) (int, string) {
	t.Helper()
	resp := doJSON(t, http.MethodGet, tsURL, path, "", nil)
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, string(b)
}

func TestLookupHappyPath(t *testing.T) {
	tsURL := seedLookup(t)
	status, raw := lookupRaw(t, tsURL, lookupPath("ja", "宿題をした", "3"))
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", status, raw)
	}
	var body struct {
		Results []map[string]json.RawMessage `json:"results"`
	}
	if err := json.Unmarshal([]byte(raw), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Results) < 2 {
		t.Fatalf("results = %s, want at least 2", raw)
	}
	first := body.Results[0]
	for _, k := range []string{"entryId", "kind", "term", "reading", "forms", "readings", "matched", "start", "end",
		"reasons", "tags", "frequencies", "senses", "pri", "levels"} {
		if _, ok := first[k]; !ok {
			t.Errorf("result lacks field %q: %s", k, raw)
		}
	}
	if len(first) != 15 {
		t.Errorf("result has %d fields, want exactly 15: %s", len(first), raw)
	}
	var got struct {
		Term, Reading, Kind, Matched string
		Start, End                   int
		Reasons, Tags                []string
		Forms                        []struct {
			Text  string   `json:"text"`
			Flags []string `json:"flags"`
		}
		Readings []struct {
			Type, Value, Plain string
			Flags              []string `json:"flags"`
		}
		Freqs []struct {
			PackID   int64   `json:"packId"`
			PackName string  `json:"packName"`
			Rank     int     `json:"rank"`
			Display  *string `json:"display"`
		} `json:"frequencies"`
		Senses []struct {
			DictionaryID   int64    `json:"dictionaryId"`
			DictionaryName string   `json:"dictionaryName"`
			POS            []string `json:"pos"`
			Tags           []string `json:"tags"`
			Glosses        []string `json:"glosses"`
			Xrefs          []string `json:"xrefs"`
		} `json:"senses"`
	}
	b, _ := json.Marshal(first)
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	// A kana match of the usually-kana 為る shows its display form する.
	if got.Term != "する" || got.Kind != "word" || got.Matched != "した" || got.Start != 3 || got.End != 5 ||
		got.Reading != "する" || len(got.Reasons) != 1 || got.Reasons[0] != "past" {
		t.Errorf("first = %+v, want する (為る) matched した [3,5) past", got)
	}
	// Readings carry their flags (never null) for a client's display form rule.
	if len(got.Forms) == 0 || got.Forms[0].Text != "為る" || len(got.Readings) == 0 || got.Readings[0].Value != "する" ||
		got.Readings[0].Type != "kana" || got.Readings[0].Flags == nil {
		t.Errorf("forms/readings = %+v / %+v", got.Forms, got.Readings)
	}
	if len(got.Freqs) != 1 || got.Freqs[0].Rank != 15 || got.Freqs[0].PackName != "Freq test" || got.Freqs[0].PackID == 0 {
		t.Fatalf("frequencies = %+v", got.Freqs)
	}
	if got.Freqs[0].Display != nil {
		t.Errorf("display = %q, want omitted", *got.Freqs[0].Display)
	}
	if len(got.Senses) != 1 || got.Senses[0].DictionaryName != "JMdict test" || got.Senses[0].DictionaryID == 0 ||
		len(got.Senses[0].Glosses) != 1 || got.Senses[0].Glosses[0] != "to do" || got.Senses[0].Xrefs == nil ||
		got.Senses[0].Tags == nil || len(got.Senses[0].POS) != 2 {
		t.Errorf("senses = %+v", got.Senses)
	}
	var second struct{ Term string }
	b, _ = json.Marshal(body.Results[1])
	json.Unmarshal(b, &second)
	if second.Term != "下" {
		t.Errorf("second = %q, want 下", second.Term)
	}
}

func TestLookupArraysNeverNull(t *testing.T) {
	tsURL := seedLookup(t)
	// Chinese entries have no frequency pack, no reasons and no xrefs.
	status, raw := lookupRaw(t, tsURL, lookupPath("zh", "学习", "0"))
	if status != http.StatusOK {
		t.Fatalf("status = %d (%s)", status, raw)
	}
	if strings.Contains(raw, "null") {
		t.Errorf("body contains null: %s", raw)
	}
	if !strings.Contains(raw, `"frequencies":[]`) || !strings.Contains(raw, `"reasons":[]`) {
		t.Errorf("want empty arrays for frequencies and reasons: %s", raw)
	}
}

// TestLookupLevels: a result carries the lowest level of each installed
// scheme it belongs to, and an entry in no scheme has "levels":[].
func TestLookupLevels(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "cedict-test", Name: "CC-CEDICT test", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "CC-CEDICT", Format: "cedict",
	}, "dictionary.txt", lookupCedict+"行 行 [xing2] /to walk/\n")
	dir := t.TempDir()
	m, _ := json.Marshal(dict.Manifest{ID: "hsk-test", Name: "HSK", Version: "1", Type: dict.TypeLevels,
		Language: "zh", License: "CC BY-SA 4.0", Attribution: "test", Format: "json"})
	for name, body := range map[string]string{"manifest.json": string(m),
		"levels.json": `{"unit": "word", "levels": [{"name": "3", "entries": ["学习"]}]}`} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := levels.Import(context.Background(), sqlDB, p); err != nil {
		t.Fatal(err)
	}
	status, raw := lookupRaw(t, ts.URL, lookupPath("zh", "学习", "0", "word"))
	if status != http.StatusOK {
		t.Fatalf("status = %d (%s)", status, raw)
	}
	if !strings.Contains(raw, `"levels":[{"scheme":"HSK","level":"3"}]`) {
		t.Errorf("want 学习 at HSK 3: %s", raw)
	}
	_, raw = lookupRaw(t, ts.URL, lookupPath("zh", "行", "0"))
	if !strings.Contains(raw, `"levels":[]`) || strings.Contains(raw, "null") {
		t.Errorf("want an empty levels array for 行: %s", raw)
	}
}

func TestLookupKindFilter(t *testing.T) {
	tsURL := seedLookup(t)
	_, raw := lookupRaw(t, tsURL, lookupPath("zh", "学", "0", "character"))
	var body struct {
		Results []struct{ Kind string } `json:"results"`
	}
	if err := json.Unmarshal([]byte(raw), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Results) != 1 || body.Results[0].Kind != "character" {
		t.Errorf("kind=character results = %s, want one character", raw)
	}
	_, raw = lookupRaw(t, tsURL, lookupPath("zh", "学习", "0", "word"))
	if err := json.Unmarshal([]byte(raw), &body); err != nil {
		t.Fatal(err)
	}
	for _, r := range body.Results {
		if r.Kind != "word" {
			t.Errorf("kind=word returned %q: %s", r.Kind, raw)
		}
	}
	if len(body.Results) == 0 {
		t.Errorf("kind=word returned nothing: %s", raw)
	}
	if status, _ := lookupRaw(t, tsURL, lookupPath("zh", "学习", "0", "word", "character")); status != http.StatusOK {
		t.Errorf("repeated kind status = %d, want 200", status)
	}
}

func TestLookupErrors(t *testing.T) {
	tsURL := seedLookup(t)
	cases := []struct {
		name, path string
		want       int
	}{
		{"invalid kind", lookupPath("ja", "した", "0", "sentence"), http.StatusBadRequest},
		{"one invalid kind among valid", lookupPath("ja", "した", "0", "word", "x"), http.StatusBadRequest},
		{"unsupported language", lookupPath("xx", "した", "0"), http.StatusBadRequest},
		{"missing language", lookupPath("", "した", "0"), http.StatusBadRequest},
		{"empty text", lookupPath("ja", "", "0"), http.StatusBadRequest},
		{"missing offset", "/api/lookup?lang=ja&text=%E3%81%97%E3%81%9F", http.StatusBadRequest},
		{"non-integer offset", lookupPath("ja", "した", "x"), http.StatusBadRequest},
		{"text too long", lookupPath("ja", strings.Repeat("あ", 65), "0"), http.StatusRequestEntityTooLarge},
	}
	for _, c := range cases {
		if status, body := lookupRaw(t, tsURL, c.path); status != c.want {
			t.Errorf("%s: status = %d, want %d (%s)", c.name, status, c.want, body)
		}
	}
	if status, _ := lookupRaw(t, tsURL, lookupPath("ja", strings.Repeat("あ", 64), "0")); status != http.StatusOK {
		t.Errorf("64 code points: status = %d, want 200", status)
	}
}

func TestLookupEmptyResults(t *testing.T) {
	tsURL := seedLookup(t)
	for _, c := range []struct{ name, path string }{
		{"no match", lookupPath("ja", "ぬ", "0")},
		{"offset beyond text", lookupPath("ja", "した", "9")},
		{"negative offset", lookupPath("ja", "した", "-1")},
	} {
		status, body := lookupRaw(t, tsURL, c.path)
		if status != http.StatusOK || strings.TrimSpace(body) != `{"results":[]}` {
			t.Errorf("%s: %d %s, want 200 {\"results\":[]}", c.name, status, body)
		}
	}
}

func TestLookupIsPublicAndUncached(t *testing.T) {
	tsURL := seedLookup(t)
	resp, err := http.Get(tsURL + lookupPath("ja", "した", "0"))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("anonymous status = %d, want 200", resp.StatusCode)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "" {
		t.Errorf("Cache-Control = %q, want none", cc)
	}
}
