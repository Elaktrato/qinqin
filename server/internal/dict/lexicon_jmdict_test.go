package dict_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/lexicon"
)

// lexiconJMdict is a tiny JMdict in the real file's shape: a DOCTYPE
// declaring only some of the entities (the rest stay undeclared and
// arrive as "&name;" text), POS that applies to following senses until
// a new one appears, cross references, and priority and rarity tags.
const lexiconJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY rK "rarely used kanji form">
<!ENTITY uk "word usually written using kana alone">
<!ENTITY v1 "Ichidan verb">
]>
<JMdict>
<entry>
<ent_seq>1157170</ent_seq>
<k_ele><keb>為る</keb><ke_inf>&rK;</ke_inf></k_ele>
<k_ele><keb>爲る</keb><ke_inf>&oK;</ke_inf></k_ele>
<r_ele><reb>する</reb><re_pri>ichi1</re_pri><re_pri>nf01</re_pri></r_ele>
<sense><pos>&vs-i;</pos><pos>&vt;</pos><xref>為さる</xref><gloss>to do</gloss><gloss>to carry out</gloss></sense>
<sense><misc>&uk;</misc><gloss>to make</gloss><gloss xml:lang="ger">machen</gloss></sense>
<sense><pos>&n;</pos><misc>&col;</misc><gloss>to cost</gloss></sense>
</entry>
<entry>
<ent_seq>1375610</ent_seq>
<k_ele><keb>為る</keb></k_ele>
<k_ele><keb>成る</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>なる</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v5r;</pos><pos>&vi;</pos><gloss>to become</gloss></sense>
</entry>
<entry>
<ent_seq>1577980</ent_seq>
<k_ele><keb>居る</keb><ke_inf>&rK;</ke_inf></k_ele>
<r_ele><reb>いる</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v1;</pos><pos>&vi;</pos><xref>ある・1</xref><misc>&uk;</misc><gloss>to be</gloss></sense>
<sense><misc>&uk;</misc><gloss>to stay</gloss></sense>
</entry>
<entry>
<ent_seq>1528300</ent_seq>
<r_ele><reb>これ</reb><re_pri>ichi1</re_pri></r_ele>
<r_ele><reb>コレ</reb><re_inf>&ik;</re_inf></r_ele>
<sense><pos>&pn;</pos><gloss>this</gloss></sense>
</entry>
<entry>
<ent_seq>1412300</ent_seq>
<k_ele><keb>學校</keb><ke_pri>ichi1</ke_pri><ke_inf>&oK;</ke_inf></k_ele>
<r_ele><reb>がっこう</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>school</gloss></sense>
</entry>
</JMdict>
`

// lexiconPack writes the pack's jmdict.xml and manifest and loads it.
func lexiconPack(t *testing.T, xml string) *dict.Pack {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(jmdictManifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	mustWriteFile(t, filepath.Join(dir, "jmdict.xml"), xml)
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	return &pack
}

// lexiconEntry loads the active ja word entry with the given ent_seq.
func lexiconEntry(t *testing.T, sqlDB *sql.DB, entSeq string) lexicon.Entry {
	t.Helper()
	var id int64
	if err := sqlDB.QueryRow(`SELECT id FROM lx_entries WHERE language = 'ja' AND kind = 'word' AND ext_key = ?`, "j:"+entSeq).Scan(&id); err != nil {
		t.Fatalf("find entry j:%s: %v", entSeq, err)
	}
	e, err := lexicon.Store{DB: sqlDB}.Get(context.Background(), id)
	if err != nil {
		t.Fatalf("get entry j:%s: %v", entSeq, err)
	}
	return *e
}

func importLexicon(t *testing.T, sqlDB *sql.DB, xml string) dict.Result {
	t.Helper()
	res, err := dict.ImportLexicon(context.Background(), sqlDB, lexiconPack(t, xml))
	if err != nil {
		t.Fatalf("ImportLexicon: %v", err)
	}
	return res
}

func TestLexiconJMdictOneEntryPerWord(t *testing.T) {
	sqlDB := newDB(t)
	res := importLexicon(t, sqlDB, lexiconJMdict)
	if res.Entries != 5 || res.Senses != 8 {
		t.Errorf("result = %+v, want 5 entries and 8 senses", res)
	}
	// Two words share the form 為る: no homograph merging.
	byForm, err := lexicon.Store{DB: sqlDB}.ByForm(context.Background(), "ja", []string{"為る"})
	if err != nil {
		t.Fatalf("ByForm: %v", err)
	}
	var keys []string
	for _, e := range byForm["為る"] {
		keys = append(keys, e.Key)
	}
	if want := []string{"j:1157170", "j:1375610"}; !reflect.DeepEqual(keys, want) {
		t.Errorf("entries with form 為る = %v, want %v", keys, want)
	}

	var name, license string
	if err := sqlDB.QueryRow(`SELECT name, license FROM dictionaries WHERE pack_id = ?`, jmdictManifest.ID).Scan(&name, &license); err != nil {
		t.Fatalf("dictionaries row: %v", err)
	}
	if name != jmdictManifest.Name || license != jmdictManifest.License {
		t.Errorf("dictionary = %q/%q", name, license)
	}
}

func TestLexiconJMdictSensesFormsAndReadings(t *testing.T) {
	sqlDB := newDB(t)
	importLexicon(t, sqlDB, lexiconJMdict)

	suru := lexiconEntry(t, sqlDB, "1157170")
	type sense struct{ POS, Tags, Glosses, Xrefs []string }
	var got []sense
	for _, s := range suru.Senses {
		got = append(got, sense{s.POS, s.Tags, s.Glosses, s.Xrefs})
	}
	want := []sense{
		{[]string{"vs-i", "vt"}, []string{}, []string{"to do", "to carry out"}, []string{"為さる"}},
		// No <pos> of its own: inherits the previous sense's.
		{[]string{"vs-i", "vt"}, []string{"uk"}, []string{"to make"}, []string{}},
		// A new <pos> replaces the inherited one; English glosses only.
		{[]string{"n"}, []string{"col"}, []string{"to cost"}, []string{}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("suru senses = %+v\nwant %+v", got, want)
	}
	if !suru.UK {
		t.Error("suru UK = false, want true (a sense is uk)")
	}
	if suru.Language != "ja" || suru.Kind != "word" || suru.Key != "j:1157170" {
		t.Errorf("suru identity = %s/%s/%s", suru.Language, suru.Kind, suru.Key)
	}
	var forms []string
	for _, f := range suru.Forms {
		forms = append(forms, f.Text+"|"+strings.Join(f.Flags, ","))
	}
	if want := []string{"為る|rK", "爲る|oK"}; !reflect.DeepEqual(forms, want) {
		t.Errorf("suru forms = %v, want %v", forms, want)
	}
	var readings []string
	for _, r := range suru.Readings {
		readings = append(readings, r.Type+"|"+r.Value+"|"+r.Plain)
	}
	if want := []string{"kana|する|する", "romaji|suru|suru"}; !reflect.DeepEqual(readings, want) {
		t.Errorf("suru readings = %v, want %v", readings, want)
	}

	// 居る: senses [v1 vi] then an inheriting one; the xref is kept.
	iru := lexiconEntry(t, sqlDB, "1577980")
	if len(iru.Senses) != 2 ||
		!reflect.DeepEqual(iru.Senses[0].POS, []string{"v1", "vi"}) ||
		!reflect.DeepEqual(iru.Senses[1].POS, []string{"v1", "vi"}) ||
		!reflect.DeepEqual(iru.Senses[0].Xrefs, []string{"ある・1"}) {
		t.Errorf("iru senses = %+v", iru.Senses)
	}
	if !iru.UK {
		t.Error("iru UK = false")
	}
	if nari := lexiconEntry(t, sqlDB, "1375610"); nari.UK {
		t.Error("なる UK = true, want false")
	}
}

func TestLexiconJMdictKanaOnlyWord(t *testing.T) {
	sqlDB := newDB(t)
	importLexicon(t, sqlDB, lexiconJMdict)
	kore := lexiconEntry(t, sqlDB, "1528300")
	if len(kore.Forms) != 0 {
		t.Errorf("kana-only word forms = %+v, want none", kore.Forms)
	}
	var readings []string
	for _, r := range kore.Readings {
		readings = append(readings, r.Type+"|"+r.Value+"|"+r.Plain+"|"+strings.Join(r.Flags, ","))
	}
	want := []string{"kana|これ|これ|", "kana|コレ|これ|ik", "romaji|kore|kore|"}
	if !reflect.DeepEqual(readings, want) {
		t.Errorf("readings = %v, want %v", readings, want)
	}
}

func TestLexiconJMdictPri(t *testing.T) {
	sqlDB := newDB(t)
	importLexicon(t, sqlDB, lexiconJMdict)

	// する: the kana reading is nf01 (100). 為る is rK and 爲る is oK, with no
	// tags of their own; the word is uk, so the kana score carries to the
	// forms: rK is exempt (100), oK still penalized (60).
	suru := lexiconEntry(t, sqlDB, "1157170")
	if got := []int{suru.Forms[0].Pri, suru.Forms[1].Pri, suru.Readings[0].Pri, suru.Pri}; !reflect.DeepEqual(got, []int{100, 60, 100, 100}) {
		t.Errorf("suru form/form/reading/entry pri = %v, want [100 60 100 100]", got)
	}
	// 學校 is not uk: its oK form keeps only its own tags, penalized (60-40).
	gakkou := lexiconEntry(t, sqlDB, "1412300")
	if gakkou.Forms[0].Pri != 20 || gakkou.Pri != 60 {
		t.Errorf("gakkou form pri %d, entry pri %d, want 20 and 60 (reading ichi1)", gakkou.Forms[0].Pri, gakkou.Pri)
	}
	// 成る carries ichi1 itself; 為る has nothing.
	nari := lexiconEntry(t, sqlDB, "1375610")
	if nari.Forms[0].Pri != 0 || nari.Forms[1].Pri != 60 {
		t.Errorf("なる form pris = %d, %d, want 0 and 60", nari.Forms[0].Pri, nari.Forms[1].Pri)
	}
	// 居る: rK on a uk word keeps the unpenalized kana score.
	if iru := lexiconEntry(t, sqlDB, "1577980"); iru.Forms[0].Pri != 60 || iru.Pri != 60 {
		t.Errorf("iru form pri %d, entry pri %d, want 60", iru.Forms[0].Pri, iru.Pri)
	}
}

func TestJmdictImportRollsBackOnError(t *testing.T) {
	sqlDB := newDB(t)
	// Two good entries, then one with no reading: the import fails after
	// writing the first two, and nothing — not even the dictionary row —
	// may persist.
	bad := strings.Replace(lexiconJMdict, "</JMdict>",
		"<entry><ent_seq>9</ent_seq><sense><gloss>broken</gloss></sense></entry>\n</JMdict>", 1)
	if _, err := dict.ImportLexicon(context.Background(), sqlDB, lexiconPack(t, bad)); err == nil {
		t.Fatal("ImportLexicon with a broken entry succeeded")
	} else if !strings.Contains(err.Error(), "9") {
		t.Errorf("error does not name the entry: %v", err)
	}
	for _, table := range []string{"lx_entries", "lx_forms", "lx_readings", "lx_senses", "dictionaries"} {
		if n := totalRows(t, sqlDB, table); n != 0 {
			t.Errorf("%s has %d rows after a failed import, want 0", table, n)
		}
	}
}

func TestLexiconJMdictReimportWritesNothing(t *testing.T) {
	sqlDB := newDB(t)
	importLexicon(t, sqlDB, lexiconJMdict)
	tables := []string{"lx_entries", "lx_forms", "lx_readings", "lx_senses"}
	for _, table := range tables {
		if _, err := sqlDB.Exec(`UPDATE ` + table + ` SET updated_at = '` + longAgo + `'`); err != nil {
			t.Fatalf("backdate %s: %v", table, err)
		}
	}
	before := map[string]int{}
	for _, table := range tables {
		before[table] = totalRows(t, sqlDB, table)
	}
	res := importLexicon(t, sqlDB, lexiconJMdict)
	if res.Entries != 5 {
		t.Errorf("second import entries = %d, want 5", res.Entries)
	}
	for _, table := range tables {
		var n int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM ` + table + ` WHERE updated_at > '2021-01-01T00:00:00Z'`).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		if n != 0 {
			t.Errorf("%s: %d rows written by an identical re-import", table, n)
		}
		if got := totalRows(t, sqlDB, table); got != before[table] {
			t.Errorf("%s rows %d -> %d", table, before[table], got)
		}
	}
}

func TestImportLexiconRejectsOtherFormats(t *testing.T) {
	sqlDB := newDB(t)
	pack := loadFixture(t) // a format "json" pack
	if _, err := dict.ImportLexicon(context.Background(), sqlDB, &pack); err == nil {
		t.Error("ImportLexicon of a json pack succeeded, want an error until its task lands")
	}
}
