package api_test

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/pack"
)

// eligibilityJMdict: 食べる (a verb the segmenter deinflects), 水 and 私, and
// ケーキ for the sentence around 食べた.
const eligibilityJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY v1 "Ichidan verb">
<!ENTITY vt "transitive verb">
<!ENTITY n "noun (common) (futsuumeishi)">
<!ENTITY prt "particle">
]>
<JMdict>
<entry><ent_seq>1358280</ent_seq><k_ele><keb>食べる</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>たべる</reb><re_pri>ichi1</re_pri></r_ele><sense><pos>&v1;</pos><pos>&vt;</pos><gloss>to eat</gloss></sense></entry>
<entry><ent_seq>1513870</ent_seq><k_ele><keb>水</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>みず</reb><re_pri>ichi1</re_pri></r_ele><sense><pos>&n;</pos><gloss>water</gloss></sense></entry>
<entry><ent_seq>1311110</ent_seq><k_ele><keb>私</keb><ke_pri>ichi1</ke_pri></k_ele><r_ele><reb>わたし</reb><re_pri>ichi1</re_pri></r_ele><sense><pos>&n;</pos><gloss>I; me</gloss></sense></entry>
<entry><ent_seq>1052590</ent_seq><r_ele><reb>ケーキ</reb><re_pri>gai1</re_pri></r_ele><sense><pos>&n;</pos><gloss>cake</gloss></sense></entry>
<entry><ent_seq>2029010</ent_seq><r_ele><reb>を</reb><re_pri>spec1</re_pri></r_ele><sense><pos>&prt;</pos><gloss>object marker</gloss></sense></entry>
</JMdict>
`

func wordID(t *testing.T, store lexicon.Store, written string) int64 {
	t.Helper()
	words, err := store.ByForm(context.Background(), "ja", []string{written})
	if err != nil || len(words[written]) == 0 {
		t.Fatalf("ByForm(%s) = %v, %v", written, words, err)
	}
	return words[written][0].ID
}

func eligibilityOf(t *testing.T, tsURL, token string, ids ...int64) (int, map[string][]string) {
	t.Helper()
	resp := doJSON(t, http.MethodPost, tsURL, "/api/study/eligibility", token, map[string]any{"ids": ids})
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return resp.StatusCode, nil
	}
	var body struct {
		Entries map[string][]string `json:"entries"`
	}
	decodeJSON(t, resp, &body)
	return resp.StatusCode, body.Entries
}

func TestStudyEligibility(t *testing.T) {
	lang.Register(lang.Ja{})
	ts, sqlDB := newServer(t)
	lookupImport(t, sqlDB, pack.Manifest{
		ID: "jmdict-elig", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	}, "jmdict.xml", eligibilityJMdict)
	store := lexicon.Store{DB: sqlDB}
	taberu, mizu, watashi := wordID(t, store, "食べる"), wordID(t, store, "水"), wordID(t, store, "私")
	admin := registerUser(t, ts.URL, "admin", "")
	alice := registerUser(t, ts.URL, "alice", admin)
	bob := registerUser(t, ts.URL, "bob", admin)

	// A pack sentence with the inflected form only: 食べた counts for 食べる
	// (the segmenter deinflects it, the cloze card blanks 食べた).
	if _, err := sqlDB.Exec(`INSERT INTO sentences (entry_id, source_pack, hanzi, pinyin, translation, updated_at)
		VALUES (?, 'pack-a', 'ケーキを食べた。', '', 'I ate cake.', '2026-11-27T00:00:00Z')`, taberu); err != nil {
		t.Fatal(err)
	}
	// Stroke data for 食 in a live pack; 水 only in an uninstalled one.
	for _, q := range []string{
		`INSERT INTO stroke_packs (pack_id, name, version, languages, license, attribution, ord, updated_at) VALUES ('live', 'L', '1', '["ja"]', 'x', 'x', 1, 't')`,
		`INSERT INTO stroke_packs (pack_id, name, version, languages, license, attribution, ord, updated_at, deleted_at) VALUES ('gone', 'G', '1', '["ja"]', 'x', 'x', 2, 't', 't')`,
		`INSERT INTO strokes (pack_id, char, data) VALUES ('live', '食', '{}'), ('gone', '水', '{}')`,
	} {
		if _, err := sqlDB.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	// Alice's own sentence on 水: hers, never Bob's.
	resp := doJSON(t, http.MethodPost, ts.URL, "/api/entries/"+strconv.FormatInt(mizu, 10)+"/sentences", alice,
		map[string]string{"hanzi": "水を飲む。", "translation": "I drink water."})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("add sentence: %d", resp.StatusCode)
	}
	resp.Body.Close()

	key := func(id int64) string { return strconv.FormatInt(id, 10) }
	status, got := eligibilityOf(t, ts.URL, alice, taberu, mizu, watashi, 999999, taberu)
	if status != http.StatusOK {
		t.Fatalf("alice: status %d", status)
	}
	want := map[string]string{
		key(taberu):  "sentence,writing,reverse,cloze",
		key(mizu):    "sentence,reverse,cloze",
		key(watashi): "reverse",
		"999999":     "",
	}
	if len(got) != len(want) {
		t.Errorf("alice: entries %v, want %v", got, want)
	}
	for id, kinds := range want {
		list, ok := got[id]
		if !ok || list == nil || strings.Join(list, ",") != kinds {
			t.Errorf("alice: entry %s = %v (present %v), want [%s]", id, list, ok, kinds)
		}
	}

	_, got = eligibilityOf(t, ts.URL, bob, mizu)
	if strings.Join(got[key(mizu)], ",") != "reverse" {
		t.Errorf("bob: 水 = %v, want [reverse]: another user's sentence never counts", got[key(mizu)])
	}

	if status, _ := eligibilityOf(t, ts.URL, "", mizu); status != http.StatusUnauthorized {
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
		resp := doJSON(t, http.MethodPost, ts.URL, "/api/study/eligibility", alice, body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400", name, resp.StatusCode)
		}
	}
}
