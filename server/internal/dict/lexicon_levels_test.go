package dict_test

import (
	"archive/zip"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/pack"
)

// Grade, level, frequency and stroke attrs of character entries: what
// KANJIDIC2 and Unihan store, and how they survive the other importers
// and re-imports.

// fixtureHaoAttrs are the attrs the committed Unihan sample gives 好.
var fixtureHaoAttrs = map[string]string{"strokes": "6", "tghz": "1", "gb": "1", "hkgrade": "1"}

func TestLexiconKanjidic2LevelAttrs(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importLexiconPack(t, sqlDB, kanjidicLexPack(t, ""))
	for ch, want := range map[string]map[string]string{
		"日": {"strokes": "4", "grade": "1", "freq": "2", "src": "kd2"},
		"学": {"strokes": "8", "grade": "2", "freq": "175", "src": "kd2"},
	} {
		if got := lexByKey(t, sqlDB, "ja", "character", ch).Attrs; !reflect.DeepEqual(got, want) {
			t.Errorf("%s attrs = %v, want %v", ch, got, want)
		}
	}
	// The bare radical entry is not a KANJIDIC2 character.
	if got := lexByKey(t, sqlDB, "ja", "character", "子").Attrs; len(got) != 0 {
		t.Errorf("radical 子 attrs = %v, want none", got)
	}
}

func TestLexiconUnihanLevelAttrs(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importLexiconPack(t, sqlDB, unihanLexPack(t))
	if got := lexByKey(t, sqlDB, "zh", "character", "好").Attrs; !reflect.DeepEqual(got, fixtureHaoAttrs) {
		t.Errorf("好 attrs = %v, want %v", got, fixtureHaoAttrs)
	}
	if got := lexByKey(t, sqlDB, "zh", "character", "复").Attrs; len(got) != 0 {
		t.Errorf("复 attrs = %v, want none", got)
	}
}

// writeUnihanZip writes a Unihan.zip holding the given members into dir.
func writeUnihanZip(t *testing.T, dir string, members map[string]string) {
	t.Helper()
	f, err := os.Create(filepath.Join(dir, "Unihan.zip"))
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for name, content := range members {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

func unihanZipPack(t *testing.T, members map[string]string) *pack.Pack {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(unihanManifest)
	if err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	writeUnihanZip(t, dir, members)
	pk, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	return &pk
}

var unihanZipCore = map[string]string{
	"Unihan_IRGSources.txt": "U+597D\tkRSUnicode\t38.6\nU+597D\tkTotalStrokes\t6\n",
	"Unihan_Variants.txt":   "U+5FA9\tkSimplifiedVariant\tU+590D\n",
	"Unihan_Readings.txt":   "U+597D\tkDefinition\tgood\nU+597D\tkTGHZ2013\t095.050:hǎo\n",
}

func TestLexiconUnihanZipReadsLevelMembers(t *testing.T) {
	members := map[string]string{
		"Unihan_OtherMappings.txt":      "U+597D\tkGB0\t2635\nU+5FA9\tkGB0\t5601\n",
		"Unihan_DictionaryLikeData.txt": "U+597D\tkGradeLevel\t1\n",
		"Unihan_NumericValues.txt":      "U+4E00\tkPrimaryNumeric\t1\n",
	}
	for k, v := range unihanZipCore {
		members[k] = v
	}
	sqlDB := dbtest.Open(t)
	importLexiconPack(t, sqlDB, unihanZipPack(t, members))
	if got := lexByKey(t, sqlDB, "zh", "character", "好").Attrs; !reflect.DeepEqual(got, fixtureHaoAttrs) {
		t.Errorf("好 attrs = %v, want %v", got, fixtureHaoAttrs)
	}
	if got, want := lexByKey(t, sqlDB, "zh", "character", "復").Attrs, map[string]string{"gb": "2"}; !reflect.DeepEqual(got, want) {
		t.Errorf("復 attrs = %v, want %v", got, want)
	}
}

// An older Unihan.zip without the OtherMappings and DictionaryLikeData
// members still imports, with the attrs its other members carry.
func TestLexiconUnihanZipToleratesMissingLevelMembers(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importLexiconPack(t, sqlDB, unihanZipPack(t, unihanZipCore))
	if got, want := lexByKey(t, sqlDB, "zh", "character", "好").Attrs, map[string]string{"strokes": "6", "tghz": "1"}; !reflect.DeepEqual(got, want) {
		t.Errorf("好 attrs = %v, want %v", got, want)
	}
}

// A required member is still required.
func TestLexiconUnihanZipRequiresCoreMembers(t *testing.T) {
	members := map[string]string{}
	for k, v := range unihanZipCore {
		if k != "Unihan_Variants.txt" {
			members[k] = v
		}
	}
	sqlDB := dbtest.Open(t)
	if _, err := dict.ImportLexicon(t.Context(), sqlDB, unihanZipPack(t, members)); err == nil {
		t.Fatal("ImportLexicon of a Unihan.zip without its variants member succeeded")
	}
}

// CEDICT owns no character attrs: whichever of CEDICT and Unihan imports
// first, the Unihan attrs stay on the shared character.
func TestLexiconCedictAndUnihanKeepUnihanAttrsInEitherOrder(t *testing.T) {
	for name, order := range map[string][]func(*testing.T) *pack.Pack{
		"cedict then unihan": {
			func(t *testing.T) *pack.Pack { return cedictLexPack(t, lexCedictChars) },
			unihanLexPack,
		},
		"unihan then cedict": {
			unihanLexPack,
			func(t *testing.T) *pack.Pack { return cedictLexPack(t, lexCedictChars) },
		},
	} {
		t.Run(name, func(t *testing.T) {
			sqlDB := dbtest.Open(t)
			for _, p := range order {
				importLexiconPack(t, sqlDB, p(t))
			}
			checkMergedChars(t, sqlDB)
			if got := lexByKey(t, sqlDB, "zh", "character", "好").Attrs; !reflect.DeepEqual(got, fixtureHaoAttrs) {
				t.Errorf("好 attrs = %v, want %v", got, fixtureHaoAttrs)
			}
		})
	}
}

// setAttrs overwrites the stored attrs of an entry and backdates it, as
// an older importer would have left it.
func setAttrs(t *testing.T, sqlDB *sql.DB, language, key string, attrs map[string]string) {
	t.Helper()
	b, err := json.Marshal(attrs)
	if err != nil {
		t.Fatal(err)
	}
	res, err := sqlDB.Exec(`UPDATE entries SET attrs = ?, updated_at = ? WHERE language = ? AND kind = 'character' AND ext_key = ?`,
		string(b), longAgo, language, key)
	if err != nil {
		t.Fatal(err)
	}
	if n, _ := res.RowsAffected(); n != 1 {
		t.Fatalf("set attrs of %s: %d rows", key, n)
	}
}

func entryStamp(t *testing.T, sqlDB *sql.DB, language, key string) string {
	t.Helper()
	var stamp string
	if err := sqlDB.QueryRow(`SELECT updated_at FROM entries WHERE language = ? AND kind = 'character' AND ext_key = ?`,
		language, key).Scan(&stamp); err != nil {
		t.Fatal(err)
	}
	return stamp
}

// Re-importing over a database an older importer wrote (strokes only, or
// stale values) updates the importer's own attrs, drops its keys the
// source no longer carries — and the retired "jlpt" key of the pre-2010
// scale, which no KANJIDIC2 import writes any more — keeps keys other
// importers own, and stamps only the entries whose attrs changed.
func TestLexiconReimportUpdatesOldAttrs(t *testing.T) {
	t.Run("kanjidic2", func(t *testing.T) {
		sqlDB := dbtest.Open(t)
		importLexiconPack(t, sqlDB, kanjidicLexPack(t, ""))
		setAttrs(t, sqlDB, "ja", "日", map[string]string{"strokes": "4", "jlpt": "4"})
		setAttrs(t, sqlDB, "ja", "学", map[string]string{"strokes": "8", "grade": "9", "jlpt": "3", "freq": "175", "src": "kd2", "other": "kept"})
		if _, err := sqlDB.Exec(`UPDATE entries SET updated_at = ?`, longAgo); err != nil {
			t.Fatal(err)
		}
		importLexiconPack(t, sqlDB, kanjidicLexPack(t, ""))
		for ch, want := range map[string]map[string]string{
			"日": {"strokes": "4", "grade": "1", "freq": "2", "src": "kd2"},
			"学": {"strokes": "8", "grade": "2", "freq": "175", "src": "kd2", "other": "kept"},
		} {
			if got := lexByKey(t, sqlDB, "ja", "character", ch).Attrs; !reflect.DeepEqual(got, want) {
				t.Errorf("%s attrs = %v, want %v", ch, got, want)
			}
			if stamp := entryStamp(t, sqlDB, "ja", ch); stamp == longAgo {
				t.Errorf("%s not restamped after its attrs changed", ch)
			}
		}
		if stamp := entryStamp(t, sqlDB, "ja", "子"); stamp != longAgo {
			t.Errorf("unchanged radical 子 restamped: %s", stamp)
		}
	})
	t.Run("unihan", func(t *testing.T) {
		sqlDB := dbtest.Open(t)
		importLexiconPack(t, sqlDB, cedictLexPack(t, lexCedictChars))
		importLexiconPack(t, sqlDB, unihanLexPack(t))
		setAttrs(t, sqlDB, "zh", "好", map[string]string{"strokes": "5", "gb": "2", "other": "kept"})
		setAttrs(t, sqlDB, "zh", "复", map[string]string{"hkgrade": "3"})
		if _, err := sqlDB.Exec(`UPDATE entries SET updated_at = ?`, longAgo); err != nil {
			t.Fatal(err)
		}
		importLexiconPack(t, sqlDB, unihanLexPack(t))
		want := map[string]string{"other": "kept"}
		for k, v := range fixtureHaoAttrs {
			want[k] = v
		}
		if got := lexByKey(t, sqlDB, "zh", "character", "好").Attrs; !reflect.DeepEqual(got, want) {
			t.Errorf("好 attrs = %v, want %v", got, want)
		}
		if got := lexByKey(t, sqlDB, "zh", "character", "复").Attrs; len(got) != 0 {
			t.Errorf("复 attrs = %v, want the stale hkgrade dropped", got)
		}
		for _, ch := range []string{"好", "复"} {
			if stamp := entryStamp(t, sqlDB, "zh", ch); stamp == longAgo {
				t.Errorf("%s not restamped after its attrs changed", ch)
			}
		}
		if stamp := entryStamp(t, sqlDB, "zh", "複"); stamp != longAgo {
			t.Errorf("unchanged 複 restamped: %s", stamp)
		}
	})
}
