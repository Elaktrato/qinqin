package packs_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"qinqin/internal/dbtest"
	"qinqin/internal/lemma"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

// An import or an uninstall whose transaction read before it wrote failed
// with SQLITE_BUSY ("database is locked") when another connection committed
// in between: in WAL mode a read snapshot cannot be upgraded to a write past
// a newer commit, and the busy timeout does not apply. That is what the data
// package builder does while an administrator installs the next pack (#192
// review). Every pack transaction takes the write lock first (BeginWrite),
// so the other connection's write waits instead. The hook makes the race
// deterministic: right after each BeginWrite it reads in the transaction
// (a snapshot) and has another connection, which does not wait for locks,
// try to commit a write.
func TestPackTransactionsTakeTheWriteLockFirst(t *testing.T) {
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	for _, typ := range pack.Types() {
		build, ok := typeCases[typ]
		if !ok {
			t.Errorf("%s: no case", typ)
			continue
		}
		t.Run(typ, func(t *testing.T) {
			sqlDB, path := dbtest.OpenPath(t)
			if _, err := sqlDB.Exec(`CREATE TABLE other_writes (n INTEGER)`); err != nil {
				t.Fatal(err)
			}
			other, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(0)&_pragma=journal_mode(WAL)") // reopen
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { other.Close() })
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			stores := t.TempDir()
			opts := []packs.Option{packs.WithAudioStore(filepath.Join(stores, "audio")), packs.WithFontStore(filepath.Join(stores, "fonts"))}
			if typ != pack.TypeDictionary {
				if _, err := packs.Import(ctx, sqlDB, dictPack(t), opts...); err != nil {
					t.Fatal(err)
				}
			}
			begins, committedBetween := 0, 0
			restore := pack.SetAfterBeginForTests(func(tx *sql.Tx) {
				begins++
				var n int
				if err := tx.QueryRow(`SELECT COUNT(*) FROM pack_texts`).Scan(&n); err != nil {
					t.Errorf("read in the transaction: %v", err)
				}
				if _, err := other.Exec(`INSERT INTO other_writes VALUES (1)`); err == nil {
					committedBetween++
				}
			})
			defer restore()
			p := build(t)
			if _, err := packs.Import(ctx, sqlDB, p, opts...); err != nil {
				t.Errorf("import: %v", err)
			}
			if err := packs.Uninstall(ctx, sqlDB, typ, packs.RegistryID(p.Manifest), opts...); err != nil {
				t.Errorf("uninstall: %v", err)
			}
			if begins == 0 {
				t.Error("no pack transaction began through BeginWrite")
			}
			if committedBetween > 0 {
				t.Errorf("another connection committed inside %d of %d pack transactions", committedBetween, begins)
			}
		})
	}
}
