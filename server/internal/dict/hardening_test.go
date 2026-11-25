package dict_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/pack"
)

func TestJSONPackIdenticalLinesGiveOneSense(t *testing.T) {
	sqlDB := dbtest.Open(t)
	res := importLexiconPack(t, sqlDB, miniLexPack(t, `{"entries": [
		{"written": "好", "kind": "character", "glosses": ["good"]},
		{"written": "好", "kind": "character", "glosses": ["good"]},
		{"written": "好", "kind": "character", "glosses": ["fine"]}]}`))
	if res.Entries != 1 || res.Senses != 2 {
		t.Errorf("result = %+v, want 1 entry, 2 senses (the identical line adds none)", res)
	}
	got := senseGlosses(t, sqlDB, lexByKey(t, sqlDB, "zh", "character", "好"))
	if len(got) != 2 {
		t.Errorf("好 senses = %v, want 2", got)
	}
}

func TestCedictKindIsCharacterOnlyForOneHanzi(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importLexiconPack(t, sqlDB, cedictLexPack(t,
		"好 好 [hao3] /good/\nA A [a5] /letter A/\n1 1 [yi1] /digit one/\n"))
	lexByKey(t, sqlDB, "zh", "character", "好")
	lexByKey(t, sqlDB, "zh", "word", "A")
	lexByKey(t, sqlDB, "zh", "word", "1")
}

func TestCedictIndentedCommentIsNotMalformed(t *testing.T) {
	sqlDB := dbtest.Open(t)
	res := importLexiconPack(t, sqlDB, cedictLexPack(t, "  # an indented comment\n\t#another\n好 好 [hao3] /good/\n"))
	if res.Skipped != 0 || res.Entries != 1 {
		t.Errorf("result = %+v, want 1 entry and nothing skipped", res)
	}
}

func TestCompressedReadersRejectCorruptInput(t *testing.T) {
	good := gzipBytes(t, []byte(strings.Repeat("好 好 [hao3] /good/\n", 500)))
	cases := map[string][]byte{
		"truncated gzip": good[:len(good)/2],
		"corrupt header": []byte("not a gzip stream at all"),
	}
	for name, payload := range cases {
		for _, format := range []string{"cedict", "unihan"} {
			t.Run(name+"/"+format, func(t *testing.T) {
				dir := writeCompressedPack(t, compressedManifest(format, "zh"), "dictionary.txt.gz", payload)
				pk, err := pack.LoadPack(dir)
				if err != nil {
					t.Fatalf("LoadPack: %v", err)
				}
				_, err = dict.ImportLexicon(context.Background(), dbtest.Open(t), &pk)
				if !errors.Is(err, pack.ErrInvalidPack) {
					t.Errorf("ImportLexicon = %v, want ErrInvalidPack", err)
				}
			})
		}
	}
}

func TestUnihanZipMissingRequiredMember(t *testing.T) {
	members := map[string]string{}
	for k, v := range unihanZipCore {
		if k != "Unihan_Variants.txt" {
			members[k] = v
		}
	}
	_, err := dict.ImportLexicon(context.Background(), dbtest.Open(t), unihanZipPack(t, members))
	if !errors.Is(err, pack.ErrInvalidPack) || !strings.Contains(err.Error(), "Unihan_Variants.txt") {
		t.Errorf("ImportLexicon = %v, want ErrInvalidPack naming the missing member", err)
	}
}

func TestUnihanRadicalOutsideKangxiNamesDictionaryAndWritesNothing(t *testing.T) {
	sqlDB := dbtest.Open(t)
	m := unihanManifest
	m.ID = "my-unihan-pack"
	_, err := importUnihanPack(t, context.Background(), sqlDB, m,
		"U+4E00\tkDefinition\tone",
		"U+597D\tkRSUnicode\t215.6")
	if err == nil {
		t.Fatal("import with radical 215 succeeded")
	}
	if msg := err.Error(); !strings.Contains(msg, "dictionary unihan (pack my-unihan-pack)") {
		t.Errorf("error = %q, want it to name the dictionary key unihan and the pack", msg)
	}
	assertNoLexiconRows(t, sqlDB)
}

func TestUnihanSelfVariantMakesNoLink(t *testing.T) {
	sqlDB := dbtest.Open(t)
	_, err := importUnihanPack(t, context.Background(), sqlDB, unihanManifest,
		"U+597D\tkTraditionalVariant\tU+597D",
		"U+597D\tkDefinition\tgood")
	if err != nil {
		t.Fatal(err)
	}
	if got := lexLinks(t, sqlDB, lexByKey(t, sqlDB, "zh", "character", "好"), "variant"); len(got) != 0 {
		t.Errorf("好 variant links = %v, want none for a self-pair", got)
	}
}

func TestUnihanResultCountsPackEntriesNotBareRadicals(t *testing.T) {
	res, err := importUnihanPack(t, context.Background(), dbtest.Open(t), unihanManifest,
		"U+597D\tkRSUnicode\t38.3")
	if err != nil {
		t.Fatal(err)
	}
	if res.Entries != 1 {
		t.Errorf("Entries = %d, want 1: the bare radical 女 is not a pack entry", res.Entries)
	}
}

func TestImportLexiconUnimplementedFormat(t *testing.T) {
	m := unihanManifest
	m.ID, m.Format = "freq-as-dict", pack.FormatFreqCSV
	pk := lexPack(t, m, "dictionary.txt", "x\n")
	_, err := dict.ImportLexicon(context.Background(), dbtest.Open(t), pk)
	if !errors.Is(err, pack.ErrInvalidPack) || !strings.Contains(err.Error(), "not implemented") {
		t.Errorf("ImportLexicon = %v, want ErrInvalidPack not implemented", err)
	}
}
