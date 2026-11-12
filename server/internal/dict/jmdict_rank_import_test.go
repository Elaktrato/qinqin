package dict_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/entries"
)

// rankingJMdict is a tiny JMdict in the real file's shape: a DOCTYPE
// declaring (some of) the entities, priority tags on kanji and kana
// elements, rarity flags as entity references, and misc tags per sense.
const rankingJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY rK "rarely used kanji form">
<!ENTITY uk "word usually written using kana alone">
<!ENTITY v1 "Ichidan verb">
]>
<JMdict>
<entry>
<ent_seq>1577980</ent_seq>
<k_ele><keb>居る</keb><ke_inf>&rK;</ke_inf></k_ele>
<r_ele><reb>いる</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v1;</pos><misc>&uk;</misc><gloss>to be</gloss></sense>
<sense><misc>&uk;</misc><gloss>to stay</gloss></sense>
</entry>
<entry>
<ent_seq>1577985</ent_seq>
<k_ele><keb>居る</keb><ke_pri>ichi1</ke_pri><ke_pri>news1</ke_pri><ke_pri>nf19</ke_pri></k_ele>
<r_ele><reb>おる</reb><re_pri>ichi1</re_pri><re_pri>news1</re_pri><re_pri>nf19</re_pri></r_ele>
<sense><misc>&uk;</misc><misc>&hum;</misc><gloss>to be (humble)</gloss></sense>
</entry>
<entry>
<ent_seq>1412300</ent_seq>
<k_ele><keb>学校</keb><ke_pri>news1</ke_pri><ke_pri>ichi1</ke_pri><ke_pri>nf02</ke_pri></k_ele>
<k_ele><keb>學校</keb><ke_inf>&oK;</ke_inf></k_ele>
<r_ele><reb>がっこう</reb><re_pri>news1</re_pri><re_pri>ichi1</re_pri><re_pri>nf02</re_pri></r_ele>
<sense><gloss>school</gloss></sense>
</entry>
<entry>
<ent_seq>1528300</ent_seq>
<r_ele><reb>これ</reb><re_pri>ichi1</re_pri></r_ele>
<r_ele><reb>コレ</reb><re_inf>&ik;</re_inf></r_ele>
<sense><gloss>this</gloss></sense>
</entry>
<entry>
<ent_seq>1000010</ent_seq>
<k_ele><keb>擦る</keb></k_ele>
<r_ele><reb>する</reb></r_ele>
<sense><gloss>to rub</gloss></sense>
<sense><misc>&uk;</misc><gloss>to lose (money)</gloss></sense>
</entry>
<entry>
<ent_seq>1000020</ent_seq>
<k_ele><keb>擦る</keb><ke_pri>spec2</ke_pri></k_ele>
<r_ele><reb>こする</reb></r_ele>
<sense><gloss>to scrub</gloss></sense>
</entry>
<entry>
<ent_seq>1000030</ent_seq>
<k_ele><keb>鋳る</keb></k_ele>
<r_ele><reb>いる</reb></r_ele>
<sense><gloss>to cast</gloss></sense>
</entry>
</JMdict>
`

// importJMdictXML imports xml as a jmdict pack into sqlDB.
func importJMdictXML(t *testing.T, sqlDB *sql.DB, xml string) {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(jmdictManifest)
	if err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	mustWriteFile(t, filepath.Join(dir, "jmdict.xml"), xml)
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dict.Import(context.Background(), sqlDB, pack); err != nil {
		t.Fatalf("Import: %v", err)
	}
}

func TestJmdictParseKeepsRankingData(t *testing.T) {
	es, err := dict.ParseJMdict(strings.NewReader(rankingJMdict))
	if err != nil {
		t.Fatalf("ParseJMdict: %v", err)
	}
	want := []map[string]map[string]string{
		// 居る/いる: uk, and its kana's ichi1 counts for a uk word — less
		// the rK penalty of its only kanji form.
		{"居る": {"jmdict.pri": "20", "jmdict.uk": "1"}},
		// 居る/おる: nf19 is the best tag.
		{"居る": {"jmdict.pri": "82", "jmdict.uk": "1"}},
		// 学校 nf02; 學校 an outdated form without tags of its own.
		{"学校": {"jmdict.pri": "99"}, "學校": {}},
		// A kana-only word scores by its readings (コレ is irregular).
		{"これ": {"jmdict.pri": "60"}},
		// uk on any sense makes the word uk.
		{"擦る": {"jmdict.uk": "1"}},
		{"擦る": {"jmdict.pri": "30"}},
		{"鋳る": {}},
	}
	if len(es) != len(want) {
		t.Fatalf("parsed %d entries, want %d", len(es), len(want))
	}
	for i, e := range es {
		if !maps.EqualFunc(e.FormAttrs, want[i], func(a, b map[string]string) bool { return maps.Equal(a, b) }) {
			t.Errorf("entry %d (%s) form attrs = %v, want %v", i, e.Written, e.FormAttrs, want[i])
		}
	}
}

func TestJmdictImportStoresRankingAttrs(t *testing.T) {
	sqlDB := newDB(t)
	importJMdictXML(t, sqlDB, rankingJMdict)
	st := entries.Store{DB: sqlDB}
	for written, want := range map[string]map[string]string{
		// A form shared by several words takes the max score and is uk
		// when any of them is.
		"居る": {"jmdict.pri": "82", "jmdict.uk": "1"},
		"擦る": {"jmdict.pri": "30", "jmdict.uk": "1"},
		"学校": {"jmdict.pri": "99"},
		"學校": {},
		"これ": {"jmdict.pri": "60"},
		"鋳る": {},
	} {
		if got := mustGet(t, st, written, "word", "ja").Attrs; !maps.Equal(got, want) {
			t.Errorf("attrs of %s = %v, want %v", written, got, want)
		}
	}
}

func TestJmdictReimportUpdatesRankingAttrs(t *testing.T) {
	sqlDB := newDB(t)
	importJMdictXML(t, sqlDB, rankingJMdict)

	// An identical re-import writes nothing.
	backdate(t, sqlDB)
	importJMdictXML(t, sqlDB, rankingJMdict)
	if w := writesSince(t, sqlDB); len(w) != 0 {
		t.Errorf("identical re-import wrote rows: %v", w)
	}

	// A newer file where 学校 lost its tags, これ dropped to news2 and 鋳る
	// became uk: stale attrs go, changed ones update, and only the
	// changed entries are stamped.
	changed := strings.NewReplacer(
		"<ke_pri>news1</ke_pri><ke_pri>ichi1</ke_pri><ke_pri>nf02</ke_pri>", "",
		"<reb>これ</reb><re_pri>ichi1</re_pri>", "<reb>これ</reb><re_pri>news2</re_pri>",
		"<gloss>to cast</gloss>", "<misc>&uk;</misc><gloss>to cast</gloss>",
	).Replace(rankingJMdict)
	backdate(t, sqlDB)
	importJMdictXML(t, sqlDB, changed)
	st := entries.Store{DB: sqlDB}
	for written, want := range map[string]map[string]string{
		"学校": {}, // its kana's tags do not score a kanji form of a non-uk word
		"これ": {"jmdict.pri": "30"},
		"鋳る": {"jmdict.uk": "1"},
		"居る": {"jmdict.pri": "82", "jmdict.uk": "1"},
	} {
		if got := mustGet(t, st, written, "word", "ja").Attrs; !maps.Equal(got, want) {
			t.Errorf("attrs of %s after re-import = %v, want %v", written, got, want)
		}
	}
	if w := writesSince(t, sqlDB); w["entries"] != 3 {
		t.Errorf("entries stamped by the re-import = %d, want the 3 changed (%v)", w["entries"], w)
	}
}
