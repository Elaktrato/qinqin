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

// Files downloaded or edited on Windows end lines with CRLF; the \r is
// not part of the line.
func TestCedictImportAcceptsCRLF(t *testing.T) {
	sqlDB := dbtest.Open(t)
	text := strings.ReplaceAll(goodCedictLines(30), "\n", "\r\n")
	pk := cedictPackFromText(t, text)
	res, err := dict.ImportLexicon(context.Background(), sqlDB, &pk)
	if err != nil {
		t.Fatalf("ImportLexicon(CRLF file): %v", err)
	}
	if res.Skipped != 0 || res.Entries < 30 {
		t.Errorf("Result = %+v, want 30 entries and nothing skipped", res)
	}
}

// A dictionary pack with no entries is a wrong or truncated file, not a
// dictionary: the import fails rather than installing an empty one.
func TestCedictImportRejectsEmptyFile(t *testing.T) {
	sqlDB := dbtest.Open(t)
	for name, text := range map[string]string{
		"empty":         "",
		"comments only": "# CC-CEDICT\n#! version=1\n",
	} {
		pk := cedictPackFromText(t, text)
		_, err := dict.ImportLexicon(context.Background(), sqlDB, &pk)
		if !errors.Is(err, pack.ErrInvalidPack) {
			t.Errorf("%s: ImportLexicon err = %v, want ErrInvalidPack", name, err)
		}
	}
}
