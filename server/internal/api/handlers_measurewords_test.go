package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"testing"

	"qinqin/internal/counters"
	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/pack"
)

// measureCedict: nouns with CL notes (in a line and in a note), one
// without, and a verb.
const measureCedict = "書 书 [Shu1] /abbr. for 書經|书经[Shu1 jing1]/\n" +
	"書 书 [shu1] /book/letter/document/CL:本[ben3],冊|册[ce4],部[bu4]/to write/\n" +
	"貓 猫 [mao1] /cat (CL:隻|只[zhi1])/(dialect) to hide oneself/\n" +
	"人 人 [ren2] /person; people/CL:個|个[ge4],位[wei4],名[ming2]/\n" +
	"水 水 [shui3] /water/river/\n" +
	"吃 吃 [chi1] /to eat/\n"

// measureJMdict: nouns of the counters table and a word that is not.
const measureJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY n "noun (common) (futsuumeishi)">
<!ENTITY v1 "Ichidan verb">
]>
<JMdict>
<entry><ent_seq>1362810</ent_seq><k_ele><keb>紙</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>かみ</reb><re_pri>ichi1</re_pri></r_ele><sense><pos>&n;</pos><gloss>paper</gloss></sense></entry>
<entry><ent_seq>1522150</ent_seq><k_ele><keb>本</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>ほん</reb><re_pri>ichi1</re_pri></r_ele><sense><pos>&n;</pos><gloss>book</gloss></sense></entry>
<entry><ent_seq>1513870</ent_seq><k_ele><keb>水</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>みず</reb><re_pri>ichi1</re_pri></r_ele><sense><pos>&n;</pos><gloss>water</gloss></sense></entry>
<entry><ent_seq>1358280</ent_seq><k_ele><keb>食べる</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>たべる</reb><re_pri>ichi1</re_pri></r_ele><sense><pos>&v1;</pos><gloss>to eat</gloss></sense></entry>
</JMdict>
`

const measureWordsFixture = "../../../docs/contracts/counters/words.json"

func measureWords(t *testing.T, tsURL, token string, ids ...int64) (int, counters.WordsAnswer) {
	t.Helper()
	resp := doJSON(t, http.MethodPost, tsURL, "/api/drills/measure-words/words", token, map[string]any{"ids": ids})
	defer resp.Body.Close()
	var body counters.WordsAnswer
	if resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
	}
	return resp.StatusCode, body
}

// TestMeasureWordsWords: the nouns with data in first-occurrence order
// (docs/contracts/counters/words.json; UPDATE_COUNTERS_FIXTURE=1 rewrites
// it), the pools of their languages, the caller's own patch only, 401
// signed out, 400 on bad ids.
func TestMeasureWordsWords(t *testing.T) {
	lang.Register(lang.Ja{})
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	lookupImport(t, sqlDB, pack.Manifest{
		ID: "cedict-measures", Name: "CC-CEDICT test", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "test", Format: "cedict",
	}, "dictionary.txt", measureCedict)
	lookupImport(t, sqlDB, pack.Manifest{
		ID: "jmdict-measures", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	}, "jmdict.xml", measureJMdict)
	store := lexicon.Store{DB: sqlDB}
	ids := map[string]int64{}
	for _, w := range []string{"书", "猫", "人", "水", "吃"} {
		ids["zh:"+w] = lexID(t, sqlDB, "zh", "character", w) // one hanzi: a character entry
	}
	for _, w := range []string{"紙", "本", "水", "食べる"} {
		ids["ja:"+w] = wordID(t, store, w)
	}
	admin := registerUser(t, ts.URL, "admin", "")
	alice := registerUser(t, ts.URL, "alice", admin)
	bob := registerUser(t, ts.URL, "bob", admin)

	asked := []string{"zh:书", "zh:水", "ja:紙", "(unknown)", "zh:猫", "zh:吃", "ja:食べる", "ja:本", "zh:人", "ja:水", "zh:书"}
	var askIDs []int64
	for _, a := range asked {
		askIDs = append(askIDs, ids[a])
	}
	askIDs[3] = 999999
	status, got := measureWords(t, ts.URL, alice, askIDs...)
	if status != http.StatusOK {
		t.Fatalf("alice: status %d", status)
	}
	type fixtureNoun struct {
		Key         string             `json:"key"`
		Language    string             `json:"language"`
		Written     string             `json:"written"`
		Readings    []counters.Reading `json:"readings"`
		Gloss       string             `json:"gloss"`
		Measures    []counters.Measure `json:"measures"`
		Fallback    *counters.Measure  `json:"fallback"`
		Traditional bool               `json:"traditional"`
	}
	var fx struct {
		Version int                           `json:"version"`
		Rule    string                        `json:"rule"`
		Doc     string                        `json:"doc"`
		Asked   []string                      `json:"asked"`
		Words   []fixtureNoun                 `json:"words"`
		Pools   map[string][]counters.Measure `json:"pools"`
	}
	keyOf := map[int64]string{}
	for k, id := range ids {
		keyOf[id] = k
	}
	asFixture := func(n counters.DrillNoun) fixtureNoun {
		return fixtureNoun{keyOf[n.ID], n.Language, n.Written, n.Readings, n.Gloss, n.Measures, n.Fallback, n.Traditional}
	}
	if os.Getenv("UPDATE_COUNTERS_FIXTURE") == "1" {
		fx.Version, fx.Rule, fx.Asked = 1, "counters/words", asked
		fx.Doc = "The answer of POST /api/drills/measure-words/words for the asked entries (key: language:written; the answer carries the entry id instead), in first-occurrence order, and the pools of the answered languages. Go: server/internal/api/handlers_measurewords_test.go (UPDATE_COUNTERS_FIXTURE=1 writes it); web: apps/web/src/lib/features/practice/counters/words.test.ts."
		for _, w := range got.Words {
			fx.Words = append(fx.Words, asFixture(w))
		}
		fx.Pools = got.Pools
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		enc.SetEscapeHTML(false)
		enc.SetIndent("", " ")
		if err := enc.Encode(fx); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(measureWordsFixture, buf.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(measureWordsFixture)
	if err != nil {
		t.Fatal(err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&fx); err != nil {
		t.Fatal(err)
	}
	if fx.Rule != "counters/words" || len(fx.Words) != len(got.Words) {
		t.Fatalf("got %d words, the fixture %d", len(got.Words), len(fx.Words))
	}
	var keys []string
	for i, w := range got.Words {
		keys = append(keys, keyOf[w.ID])
		gotJSON, _ := json.Marshal(asFixture(w))
		wantJSON, _ := json.Marshal(fx.Words[i])
		if !bytes.Equal(gotJSON, wantJSON) {
			t.Errorf("word %d:\n got %s\nwant %s", i, gotJSON, wantJSON)
		}
	}
	if want := []string{"zh:书", "ja:紙", "zh:猫", "ja:本", "zh:人", "ja:水"}; !equalStrings(keys, want) {
		t.Errorf("words %v, want %v", keys, want)
	}
	gotPools, _ := json.Marshal(got.Pools)
	wantPools, _ := json.Marshal(fx.Pools)
	if !bytes.Equal(gotPools, wantPools) || len(got.Pools) != 2 {
		t.Errorf("pools differ from the fixture (or not zh and ja): %s", gotPools)
	}

	// Alice writes 书 in traditional characters: her measure words follow, Bob's do not.
	resp := doJSON(t, http.MethodPut, ts.URL, "/api/entries/"+strconv.FormatInt(ids["zh:书"], 10), alice, map[string]any{"written": "書"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	_, mine := measureWords(t, ts.URL, alice, ids["zh:书"])
	_, his := measureWords(t, ts.URL, bob, ids["zh:书"])
	if len(mine.Words) != 1 || mine.Words[0].Written != "書" || !mine.Words[0].Traditional || mine.Words[0].Measures[1].Written != "冊" {
		t.Errorf("alice after her patch: %+v, want 書 with 冊", mine.Words)
	}
	if len(his.Words) != 1 || his.Words[0].Written != "书" || his.Words[0].Traditional || his.Words[0].Measures[1].Written != "册" {
		t.Errorf("bob: %+v, want 书 with 册: another user's patch never applies", his.Words)
	}

	if status, _ := measureWords(t, ts.URL, "", ids["zh:书"]); status != http.StatusUnauthorized {
		t.Errorf("anonymous: status %d, want 401", status)
	}
	many := make([]int64, 501)
	for i := range many {
		many[i] = int64(i + 1)
	}
	for name, body := range map[string]any{
		"no ids":       map[string]any{"ids": []int64{}},
		"a bad id":     map[string]any{"ids": []int64{0}},
		"too many ids": map[string]any{"ids": many},
		"not a list":   map[string]any{"ids": "1"},
	} {
		resp := doJSON(t, http.MethodPost, ts.URL, "/api/drills/measure-words/words", alice, body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, resp.StatusCode)
		}
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// TestCounterReadingsRoute: GET /api/drills/counters is readings.json's
// counters, signed in only.
func TestCounterReadingsRoute(t *testing.T) {
	ts, _ := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/drills/counters", admin, nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d", resp.StatusCode)
	}
	var body struct {
		Counters json.RawMessage `json:"counters"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../../docs/contracts/counters/readings.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Counters json.RawMessage `json:"counters"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	var a, b any
	_ = json.Unmarshal(body.Counters, &a)
	_ = json.Unmarshal(fx.Counters, &b)
	ga, _ := json.Marshal(a)
	gb, _ := json.Marshal(b)
	if !bytes.Equal(ga, gb) {
		t.Errorf("GET /api/drills/counters differs from readings.json")
	}
	anon := doJSON(t, http.MethodGet, ts.URL, "/api/drills/counters", "", nil)
	anon.Body.Close()
	if anon.StatusCode != http.StatusUnauthorized {
		t.Errorf("anonymous: status %d, want 401", anon.StatusCode)
	}
}
