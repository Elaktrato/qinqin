package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"testing"

	"qinqin/internal/conjugation"
	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/pack"
)

// conjugationJMdict: verbs and adjectives of each kind, and two entries the
// drill never asks (a noun, a noun that takes する).
const conjugationJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY v1 "Ichidan verb">
<!ENTITY v5k-s "Godan verb - Iku/Yuku special class">
<!ENTITY v5r "Godan verb with 'ru' ending">
<!ENTITY vi "intransitive verb">
<!ENTITY vt "transitive verb">
<!ENTITY adj-i "adjective (keiyoushi)">
<!ENTITY adj-na "adjectival nouns or quasi-adjectives (keiyodoshi)">
<!ENTITY n "noun (common) (futsuumeishi)">
<!ENTITY vs "noun or participle which takes the aux. verb suru">
]>
<JMdict>
<entry><ent_seq>1358280</ent_seq><k_ele><keb>食べる</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>たべる</reb><re_pri>ichi1</re_pri></r_ele><sense><pos>&v1;</pos><pos>&vt;</pos><gloss>to eat</gloss></sense></entry>
<entry><ent_seq>1578850</ent_seq><k_ele><keb>行く</keb><ke_pri>ichi1</ke_pri></k_ele><k_ele><keb>往く</keb></k_ele><r_ele><reb>いく</reb><re_pri>ichi1</re_pri></r_ele><r_ele><reb>ゆく</reb></r_ele><sense><pos>&v5k-s;</pos><pos>&vi;</pos><gloss>to go</gloss></sense></entry>
<entry><ent_seq>1606560</ent_seq><k_ele><keb>分かる</keb><ke_pri>ichi1</ke_pri></k_ele><k_ele><keb>解る</keb></k_ele><k_ele><keb>判る</keb></k_ele><r_ele><reb>わかる</reb><re_pri>ichi1</re_pri></r_ele><sense><pos>&v5r;</pos><pos>&vi;</pos><gloss>to understand</gloss></sense></entry>
<entry><ent_seq>1379520</ent_seq><k_ele><keb>静か</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>しずか</reb><re_pri>ichi1</re_pri></r_ele><sense><pos>&adj-na;</pos><gloss>quiet</gloss></sense></entry>
<entry><ent_seq>1280050</ent_seq><k_ele><keb>高い</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>たかい</reb><re_pri>ichi1</re_pri></r_ele><sense><pos>&adj-i;</pos><gloss>high; tall</gloss></sense></entry>
<entry><ent_seq>1513870</ent_seq><k_ele><keb>水</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>みず</reb><re_pri>ichi1</re_pri></r_ele><sense><pos>&n;</pos><gloss>water</gloss></sense></entry>
<entry><ent_seq>1238340</ent_seq><k_ele><keb>勉強</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>べんきょう</reb><re_pri>ichi1</re_pri></r_ele><sense><pos>&n;</pos><pos>&vs;</pos><gloss>study</gloss></sense></entry>
</JMdict>
`

const conjugationWordsFixture = "../../../docs/contracts/conjugation/words.json"

func conjugationWords(t *testing.T, tsURL, token string, ids ...int64) (int, []conjugation.DrillWord) {
	t.Helper()
	resp := doJSON(t, http.MethodPost, tsURL, "/api/drills/conjugation/words", token, map[string]any{"ids": ids})
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return resp.StatusCode, nil
	}
	var body struct {
		Words []conjugation.DrillWord `json:"words"`
	}
	decodeJSON(t, resp, &body)
	return resp.StatusCode, body.Words
}

// TestConjugationWords: the drilled words in first-occurrence order with
// their forms (docs/contracts/conjugation/words.json; UPDATE_CONJUGATION_FIXTURE=1
// rewrites it), the caller's own patch only, 401 signed out, 400 on bad ids.
func TestConjugationWords(t *testing.T) {
	lang.Register(lang.Ja{})
	ts, sqlDB := newServer(t)
	lookupImport(t, sqlDB, pack.Manifest{
		ID: "jmdict-conj", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	}, "jmdict.xml", conjugationJMdict)
	store := lexicon.Store{DB: sqlDB}
	ids := map[string]int64{}
	for _, w := range []string{"食べる", "行く", "分かる", "静か", "高い", "水", "勉強"} {
		ids[w] = wordID(t, store, w)
	}
	admin := registerUser(t, ts.URL, "admin", "")
	alice := registerUser(t, ts.URL, "alice", admin)
	bob := registerUser(t, ts.URL, "bob", admin)

	status, got := conjugationWords(t, ts.URL, alice, ids["高い"], ids["水"], ids["食べる"], 999999, ids["勉強"], ids["行く"], ids["分かる"], ids["静か"], ids["食べる"])
	if status != http.StatusOK {
		t.Fatalf("alice: status %d", status)
	}
	type fixtureWord struct {
		Written  string                              `json:"written"`
		Class    string                              `json:"class"`
		Reading  string                              `json:"reading"`
		Readings []conjugation.Reading               `json:"readings"`
		Families []string                            `json:"families"`
		Forms    map[string][]conjugation.FormAnswer `json:"forms"`
	}
	var fx struct {
		Version int           `json:"version"`
		Rule    string        `json:"rule"`
		Asked   []string      `json:"asked"`
		Words   []fixtureWord `json:"words"`
	}
	asked := []string{"高い", "水", "食べる", "(unknown)", "勉強", "行く", "分かる", "静か", "食べる"}
	if os.Getenv("UPDATE_CONJUGATION_FIXTURE") == "1" {
		fx.Version, fx.Rule, fx.Asked = 1, "conjugation/words", asked
		for _, w := range got {
			fx.Words = append(fx.Words, fixtureWord{w.Written, w.Class, w.Reading, w.Readings, w.Families, w.Forms})
		}
		var buf bytes.Buffer
		enc := json.NewEncoder(&buf)
		enc.SetEscapeHTML(false)
		enc.SetIndent("", " ")
		if err := enc.Encode(fx); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(conjugationWordsFixture, buf.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(conjugationWordsFixture)
	if err != nil {
		t.Fatal(err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&fx); err != nil {
		t.Fatal(err)
	}
	if fx.Rule != "conjugation/words" || len(fx.Words) != len(got) {
		t.Fatalf("got %d words, the fixture %d", len(got), len(fx.Words))
	}
	for i, w := range got {
		want := fx.Words[i]
		if w.ID != ids[want.Written] {
			t.Errorf("word %d: id %d, want %s's %d", i, w.ID, want.Written, ids[want.Written])
		}
		gotJSON, _ := json.Marshal(fixtureWord{w.Written, w.Class, w.Reading, w.Readings, w.Families, w.Forms})
		wantJSON, _ := json.Marshal(want)
		if !bytes.Equal(gotJSON, wantJSON) {
			t.Errorf("word %d:\n got %s\nwant %s", i, gotJSON, wantJSON)
		}
	}

	// Alice's own patch of 食べる's written form: hers only.
	resp := doJSON(t, http.MethodPut, ts.URL, "/api/entries/"+strconv.FormatInt(ids["食べる"], 10), alice, map[string]any{"written": "喰べる"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	_, mine := conjugationWords(t, ts.URL, alice, ids["食べる"])
	_, his := conjugationWords(t, ts.URL, bob, ids["食べる"])
	if len(mine) != 1 || mine[0].Forms["past"][0].Written != "喰べた" {
		t.Errorf("alice after her patch: %+v, want 喰べた", mine)
	}
	if len(his) != 1 || his[0].Forms["past"][0].Written != "食べた" {
		t.Errorf("bob: %+v, want 食べた: another user's patch never applies", his)
	}

	if status, _ := conjugationWords(t, ts.URL, "", ids["食べる"]); status != http.StatusUnauthorized {
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
		resp := doJSON(t, http.MethodPost, ts.URL, "/api/drills/conjugation/words", alice, body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, resp.StatusCode)
		}
	}
}
