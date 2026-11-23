package freq_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/freq"
)

// noticePack is a freq-csv pack whose manifest carries notice.
func noticePack(t *testing.T, notice string) *dict.Pack {
	t.Helper()
	m := fmt.Sprintf(`{"id":"p","name":"Pack p","version":"1","type":"frequency","language":"ja","license":"CC0-1.0","attribution":"test","notice":%q,"format":"freq-csv"}`, notice)
	return loadPack(t, writeFiles(t, map[string]string{
		"manifest.json": m,
		"freq.csv":      "term,reading,rank\n猫,,3\n",
	}))
}

func packRow(t *testing.T, sqlDB *sql.DB) (notice, updated string) {
	t.Helper()
	if err := sqlDB.QueryRow(`SELECT notice, updated_at FROM frequency_packs WHERE pack_id = 'p'`).Scan(&notice, &updated); err != nil {
		t.Fatal(err)
	}
	return notice, updated
}

func TestImportStoresNoticeWithoutRestamp(t *testing.T) {
	sqlDB := dbtest.Open(t)
	mustImport(t, sqlDB, csvPack(t, "p", "猫,,3\n"))
	if notice, _ := packRow(t, sqlDB); notice != "" {
		t.Errorf("pack without notice: notice = %q, want ''", notice)
	}

	mustImport(t, sqlDB, noticePack(t, "Ranks unmodified; see [Jiten](https://jiten.moe)."))
	if notice, _ := packRow(t, sqlDB); notice != "Ranks unmodified; see [Jiten](https://jiten.moe)." {
		t.Errorf("notice = %q", notice)
	}
	packs, err := freq.Store{DB: sqlDB}.Packs(context.Background())
	if err != nil || len(packs) != 1 || packs[0].Notice != "Ranks unmodified; see [Jiten](https://jiten.moe)." {
		t.Errorf("Packs = %+v, %v; want the notice", packs, err)
	}

	if _, err := sqlDB.Exec(`UPDATE frequency_packs SET updated_at = 'sentinel'`); err != nil {
		t.Fatal(err)
	}
	mustImport(t, sqlDB, noticePack(t, "Ranks unmodified; see [Jiten](https://jiten.moe)."))
	if _, updated := packRow(t, sqlDB); updated != "sentinel" {
		t.Errorf("identical re-import restamped the pack: updated_at = %q", updated)
	}

	mustImport(t, sqlDB, noticePack(t, "Changed."))
	notice, updated := packRow(t, sqlDB)
	if notice != "Changed." || updated == "sentinel" {
		t.Errorf("changed notice: notice = %q, updated_at = %q; want it stored and restamped", notice, updated)
	}
	if got := lookup(t, sqlDB, []string{"猫"}, nil); len(got["猫"]) != 1 || got["猫"][0].Rank != 3 {
		t.Errorf("rows after a notice-only change: %+v", got["猫"])
	}
}

func TestImportRejectsInvalidNotice(t *testing.T) {
	sqlDB := dbtest.Open(t)
	p := csvPack(t, "p", "猫,,3\n")
	p.Manifest.Notice = "[x](http://example.com)"
	if _, err := freq.Import(context.Background(), sqlDB, p); !errors.Is(err, dict.ErrInvalidPack) {
		t.Errorf("Import with an http: link = %v, want ErrInvalidPack", err)
	}
	if n := count(t, sqlDB, `SELECT count(*) FROM frequency_packs`); n != 0 {
		t.Errorf("%d packs written by a rejected pack, want 0", n)
	}
}
