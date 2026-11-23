package dict_test

import (
	"context"
	"os"
	"reflect"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
)

func kanjidicLexPack(t *testing.T, xml string) *dict.Pack {
	t.Helper()
	if xml == "" {
		data, err := os.ReadFile(kanjidic2Fixture)
		if err != nil {
			t.Fatal(err)
		}
		xml = string(data)
	}
	return lexPack(t, kanjidic2Manifest, "kanjidic2.xml", xml)
}

func TestLexiconKanjidic2Entries(t *testing.T) {
	sqlDB := dbtest.Open(t)
	res := importLexiconPack(t, sqlDB, kanjidicLexPack(t, ""))
	// 日 and 学; the bare radical 子 is not counted.
	if res.Entries != 2 || res.Senses != 2 {
		t.Errorf("result = %+v, want 2 entries and 2 senses", res)
	}
	nichi := lexByKey(t, sqlDB, "ja", "character", "日")
	want := []string{"on|ニチ|にち", "on|ジツ|じつ", "kun|ひ|ひ"}
	if got := readingList(nichi); !reflect.DeepEqual(got, want) {
		t.Errorf("日 readings = %v, want %v", got, want)
	}
	if nichi.Attrs["strokes"] != "4" {
		t.Errorf("日 strokes = %q, want 4", nichi.Attrs["strokes"])
	}
	if got, want := formList(nichi), []string{"日|"}; !reflect.DeepEqual(got, want) {
		t.Errorf("日 forms = %v, want %v", got, want)
	}
	if got, want := senseGlosses(t, sqlDB, nichi), []string{"kanjidic2: day, sun"}; !reflect.DeepEqual(got, want) {
		t.Errorf("日 senses = %v, want %v", got, want)
	}
	var license string
	if err := sqlDB.QueryRow(`SELECT license FROM dictionaries WHERE pack_id = 'kanjidic2'`).Scan(&license); err != nil || license != "CC BY-SA 4.0" {
		t.Errorf("built-in kanjidic2 dictionary license = %q, %v", license, err)
	}
	gaku := lexByKey(t, sqlDB, "ja", "character", "学")
	if got, want := senseGlosses(t, sqlDB, gaku), []string{"kanjidic2: study/learning"}; !reflect.DeepEqual(got, want) {
		t.Errorf("学 senses = %v, want %v", got, want)
	}
}

func TestLexiconKanjidic2RadicalLink(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importLexiconPack(t, sqlDB, kanjidicLexPack(t, ""))
	gaku := lexByKey(t, sqlDB, "ja", "character", "学")
	if got := lexLinks(t, sqlDB, gaku, "radical"); !reflect.DeepEqual(got, []string{"子"}) {
		t.Errorf("学 radical links = %v, want [子]", got)
	}
	ko := lexByKey(t, sqlDB, "ja", "character", "子")
	if len(ko.Senses) != 0 || len(ko.Readings) != 0 || ko.Language != "ja" {
		t.Errorf("bare radical entry = %+v", ko)
	}
	// The link points from the character to the radical, never back.
	if got := lexLinks(t, sqlDB, ko, "radical"); len(got) != 0 {
		t.Errorf("子 radical links = %v, want none", got)
	}
}

func TestLexiconKanjidic2RadicalOutsideKangxiAbortsWholePack(t *testing.T) {
	sqlDB := dbtest.Open(t)
	data, err := os.ReadFile(kanjidic2Fixture)
	if err != nil {
		t.Fatal(err)
	}
	// 学 comes after 日: the pack fails after 日 was written.
	bad := strings.Replace(string(data), ">39<", ">215<", 1)
	if _, err := dict.ImportLexicon(context.Background(), sqlDB, kanjidicLexPack(t, bad)); err == nil {
		t.Fatal("ImportLexicon with radical 215 succeeded")
	}
	assertNoLexiconRows(t, sqlDB)
}
