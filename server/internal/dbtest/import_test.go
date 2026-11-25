package dbtest_test

import (
	"context"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/lang"
	"qinqin/internal/pack"
)

// The tiny dictionary pack imports with the real importer into a database
// from Open.
func TestDictPackImports(t *testing.T) {
	lang.Register(lang.Zh{})
	sqlDB := dbtest.Open(t)
	p, err := pack.LoadPack(dbtest.DictPack(t))
	if err != nil {
		t.Fatal(err)
	}
	res, err := dict.ImportLexicon(context.Background(), sqlDB, &p)
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM forms`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n < len(dbtest.DictWords) {
		t.Errorf("%d forms after importing %d words (result %+v)", n, len(dbtest.DictWords), res)
	}
}
