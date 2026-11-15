package dict

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/lexicon"
)

// A radical outside the Kangxi table is rejected before the first entry is
// written, not after (the surrounding transaction would hide a late check).
func TestUnihanRadicalCheckRunsBeforeAnyWrite(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	ctx := context.Background()
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	data := UnihanData{
		Radicals:    map[string]int{"好": 215},
		Definitions: map[string]string{"一": "one"},
	}
	_, err = importUnihanLexicon(ctx, tx, lexicon.Store{DB: sqlDB}, 1, Manifest{Language: "zh"}, data)
	if err == nil || !strings.Contains(err.Error(), "215") {
		t.Fatalf("err = %v, want the radical error", err)
	}
	var n int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM entries`).Scan(&n); err != nil || n != 0 {
		t.Errorf("entries written before the radical check = %d, %v; want 0", n, err)
	}
}
