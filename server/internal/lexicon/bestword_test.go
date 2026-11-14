package lexicon_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/lexicon"
)

// bestWordJMdict is a JMdict excerpt in the real element and entity
// shape covering every BestWord rule:
//   - 刷る (no uk, priority news1) and 為る (uk, ichi1) both read する;
//   - これ is kana-only; テレビ is katakana-only;
//   - ここ is a (made-up) written form of one word and the kana-only
//     reading of a higher-priority other;
//   - それ has two kana-only entries, the later one with priority;
//   - 居る (uk) reads いる first; the kana-only おる lists いる second
//     and carries a higher priority.
const bestWordJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY rK "rarely used kanji form">
<!ENTITY uk "word usually written using kana alone">
<!ENTITY vs-i "suru verb - included">
<!ENTITY v5r "Godan verb with 'ru' ending">
<!ENTITY v1 "Ichidan verb">
<!ENTITY n "noun (common) (futsuumeishi)">
<!ENTITY pn "pronoun">
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
<sense><pos>&vs-i;</pos><misc>&uk;</misc><gloss>to do</gloss></sense>
</entry>
<entry>
<ent_seq>1288810</ent_seq>
<r_ele><reb>これ</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&pn;</pos><gloss>this</gloss></sense>
</entry>
<entry>
<ent_seq>1081610</ent_seq>
<r_ele><reb>テレビ</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>television</gloss></sense>
</entry>
<entry>
<ent_seq>9000001</ent_seq>
<k_ele><keb>ここ</keb></k_ele>
<r_ele><reb>ここ</reb></r_ele>
<sense><pos>&n;</pos><gloss>here (written form)</gloss></sense>
</entry>
<entry>
<ent_seq>9000002</ent_seq>
<r_ele><reb>ここ</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&pn;</pos><gloss>here (kana only)</gloss></sense>
</entry>
<entry>
<ent_seq>9000003</ent_seq>
<r_ele><reb>それ</reb></r_ele>
<sense><pos>&pn;</pos><gloss>that (plain)</gloss></sense>
</entry>
<entry>
<ent_seq>9000004</ent_seq>
<r_ele><reb>それ</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&pn;</pos><gloss>that (priority)</gloss></sense>
</entry>
<entry>
<ent_seq>9000005</ent_seq>
<r_ele><reb>おる</reb><re_pri>ichi1</re_pri></r_ele>
<r_ele><reb>いる</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v5r;</pos><gloss>to be (second reading)</gloss></sense>
</entry>
<entry>
<ent_seq>1577980</ent_seq>
<k_ele><keb>居る</keb></k_ele>
<r_ele><reb>いる</reb></r_ele>
<sense><pos>&v1;</pos><misc>&uk;</misc><gloss>to be</gloss></sense>
</entry>
</JMdict>
`

// importJMdict imports xml as a ja JMdict pack with the real importer.
func importJMdict(t *testing.T, st lexicon.Store, xml string) {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(dict.Manifest{
		ID: "jmdict-test", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	})
	if err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{"manifest.json": string(manifest), "jmdict.xml": xml} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dict.ImportLexicon(context.Background(), st.DB, &p); err != nil {
		t.Fatalf("import JMdict: %v", err)
	}
}

// scriptJMdict has katakana homographs FIRST (lowest ids): モノ ("mono")
// at the same priority as 物 (uk) and the kana-only もの; ダレ
// ("undercut") beside 誰, which, as in the real JMdict, is not marked uk
// and so is never a reading fallback candidate.
const scriptJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY uk "word usually written using kana alone">
<!ENTITY n "noun (common) (futsuumeishi)">
<!ENTITY pn "pronoun">
]>
<JMdict>
<entry>
<ent_seq>2860001</ent_seq>
<r_ele><reb>モノ</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>mono</gloss></sense>
</entry>
<entry>
<ent_seq>2860002</ent_seq>
<r_ele><reb>ダレ</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>undercut of a machined edge</gloss></sense>
</entry>
<entry>
<ent_seq>1502390</ent_seq>
<k_ele><keb>物</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>もの</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><misc>&uk;</misc><gloss>thing</gloss></sense>
</entry>
<entry>
<ent_seq>2860003</ent_seq>
<r_ele><reb>もの</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>thing (kana only)</gloss></sense>
</entry>
<entry>
<ent_seq>1420710</ent_seq>
<k_ele><keb>誰</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>だれ</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&pn;</pos><gloss>who</gloss></sense>
</entry>
<entry>
<ent_seq>1081610</ent_seq>
<r_ele><reb>テレビ</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>television</gloss></sense>
</entry>
</JMdict>
`

// TestBestWordPrefersTheQueryScript: the reading written exactly as the
// word wins over a priority tie (もの: 物, never モノ), and a hiragana
// word never falls back to a katakana-only reading: だれ stays
// unresolved rather than resolving to ダレ. A katakana word still
// matches a hiragana reading when nothing else does.
func TestBestWordPrefersTheQueryScript(t *testing.T) {
	st := newStore(t)
	importJMdict(t, st, scriptJMdict)
	ctx := context.Background()
	for _, tc := range []struct{ word, wantKey string }{
		{"もの", "j:1502390"}, // 物 (uk) and もの tie; never モノ
		{"モノ", "j:2860001"},
		{"ダレ", "j:2860002"},
		{"テレビ", "j:1081610"},
	} {
		e, err := st.BestWord(ctx, "ja", tc.word)
		if err != nil || e.Key != tc.wantKey {
			t.Errorf("BestWord(%s) = %v, %v; want %s", tc.word, e, err, tc.wantKey)
		}
	}
	for _, word := range []string{"だれ", "てれび"} {
		if e, err := st.BestWord(ctx, "ja", word); !errors.Is(err, lexicon.ErrNotFound) {
			t.Errorf("BestWord(%s) = %v, %v; want ErrNotFound (only a katakana-only reading)", word, e, err)
		}
	}
}

func TestBestWordFallsBackToFirstKanaReading(t *testing.T) {
	st := newStore(t)
	importJMdict(t, st, bestWordJMdict)
	ctx := context.Background()
	for _, tc := range []struct {
		word, wantKey, why string
	}{
		{"する", "j:1157170", "uk 為る; the non-uk 刷る is not a fallback candidate despite its priority"},
		{"これ", "j:1288810", "kana-only word"},
		{"テレビ", "j:1081610", "katakana-only word"},
		{"ここ", "j:9000001", "a form match beats a reading match"},
		{"それ", "j:9000004", "priority orders the fallback"},
		{"いる", "j:1577980", "only the FIRST reading counts: おる/いる is not picked"},
	} {
		e, err := st.BestWord(ctx, "ja", tc.word)
		if err != nil {
			t.Errorf("BestWord(%s): %v (%s)", tc.word, err, tc.why)
			continue
		}
		if e.Key != tc.wantKey {
			t.Errorf("BestWord(%s) = %s %v, want %s (%s)", tc.word, e.Key, e.Forms, tc.wantKey, tc.why)
		}
	}
	for _, word := range []string{"すり", "刷", "おる"} {
		// おる is the first reading of a kana-only word, so it does resolve.
		e, err := st.BestWord(ctx, "ja", word)
		switch word {
		case "おる":
			if err != nil || e.Key != "j:9000005" {
				t.Errorf("BestWord(おる) = %v, %v; want the kana-only おる", e, err)
			}
		default:
			if !errors.Is(err, lexicon.ErrNotFound) {
				t.Errorf("BestWord(%s) err = %v, want ErrNotFound", word, err)
			}
		}
	}
	// Best itself still matches forms only.
	if _, err := st.Best(ctx, "ja", "word", "これ"); !errors.Is(err, lexicon.ErrNotFound) {
		t.Errorf("Best(これ) err = %v, want ErrNotFound (form match only)", err)
	}
}
