package levels_test

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/lang"
	"qinqin/internal/levels"
)

// kazeJMdict: 風 is a written form of the usually-kana 振り (ふり, with a
// priority, so it wins a form-only lookup) and of 風 (かぜ).
const kazeJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY uk "word usually written using kana alone">
<!ENTITY n "noun (common) (futsuumeishi)">
]>
<JMdict>
<entry>
<ent_seq>1012000</ent_seq>
<k_ele><keb>振り</keb></k_ele>
<k_ele><keb>風</keb></k_ele>
<r_ele><reb>ふり</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><misc>&uk;</misc><gloss>appearance</gloss></sense>
</entry>
<entry>
<ent_seq>1500620</ent_seq>
<k_ele><keb>風</keb></k_ele>
<r_ele><reb>かぜ</reb></r_ele>
<sense><pos>&n;</pos><gloss>wind</gloss></sense>
</entry>
<entry>
<ent_seq>1315720</ent_seq>
<k_ele><keb>時々</keb></k_ele>
<r_ele><reb>ときどき</reb></r_ele>
<sense><pos>&n;</pos><gloss>sometimes</gloss></sense>
</entry>
<entry>
<ent_seq>1500621</ent_seq>
<k_ele><keb>外</keb></k_ele>
<r_ele><reb>そと</reb></r_ele>
<sense><pos>&n;</pos><gloss>outside</gloss></sense>
</entry>
</JMdict>
`

// jaLevelsPack writes a ja levels pack holding levelsJSON and loads it.
func jaLevelsPack(t *testing.T, id, levelsJSON string) dict.Pack {
	t.Helper()
	dir := t.TempDir()
	manifest := `{"id":"` + id + `","name":"JLPT test","version":"1.0","type":"levels",` +
		`"language":"ja","license":"CC0-1.0","attribution":"test","format":"json"}`
	for name, body := range map[string]string{"manifest.json": manifest, "levels.json": levelsJSON} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("load pack: %v", err)
	}
	return p
}

func jaWordID(t *testing.T, sqlDB *sql.DB, key string) int64 {
	t.Helper()
	var id int64
	if err := sqlDB.QueryRow(`SELECT id FROM entries WHERE language = 'ja' AND kind = 'word' AND ext_key = ?`, key).Scan(&id); err != nil {
		t.Fatalf("entry %s: %v", key, err)
	}
	return id
}

// TestEntryWithReading: an entry may be {"form", "reading"} next to plain
// strings (the format stays backward compatible); the reading picks the
// entry that has both, so 風 (かぜ) joins 風, not the usually-kana 振り.
// A reading no entry of the form has falls back to the form alone.
func TestEntryWithReading(t *testing.T) {
	lang.Register(lang.Ja{})
	sqlDB := newDB(t)
	ctx := context.Background()
	importDictionary(t, sqlDB, dict.Manifest{
		ID: "jmdict-test", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	}, "jmdict.xml", kazeJMdict)
	furi := jaWordID(t, sqlDB, "j:1012000")
	kaze := jaWordID(t, sqlDB, "j:1500620")
	soto := jaWordID(t, sqlDB, "j:1500621")

	pack := jaLevelsPack(t, "reading", `{"unit":"word","levels":[
		{"name":"N5","entries":[{"form":"風","reading":"かぜ"},"外",{"form":"猫","reading":"ねこ"}]},
		{"name":"N4","entries":[{"form":"風","reading":"なし"}]}]}`)
	res, err := levels.Import(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	// No KANJIDIC2 here: the characters 風 and 外 are skipped as well.
	if res.Members != 3 || !slices.Contains(res.Skipped, "猫") {
		t.Errorf("result = %+v, want 3 members and 猫 skipped", res)
	}
	for _, c := range []struct {
		name  string
		id    int64
		level string
	}{{"風 かぜ", kaze, "N5"}, {"外", soto, "N5"}, {"振り", furi, "N4"}} {
		got, err := levels.ForEntry(ctx, sqlDB, c.id)
		if err != nil || len(got) != 1 || got[0].LevelName != c.level {
			t.Errorf("badges of %s = %+v (err %v), want only %s", c.name, got, err, c.level)
		}
	}

	bad := jaLevelsPack(t, "bad", `{"unit":"word","levels":[{"name":"N5","entries":[{"reading":"かぜ"}]}]}`)
	if _, err := levels.Import(ctx, sqlDB, bad); err == nil {
		t.Error("an entry without a form imported, want an invalid-pack error")
	}
}
