package levels_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/levels"
)

func schemeRow(t *testing.T, sqlDB *sql.DB, packID string) (notice, updated string) {
	t.Helper()
	if err := sqlDB.QueryRow(`SELECT notice, updated_at FROM schemes WHERE pack_id = ?`, packID).Scan(&notice, &updated); err != nil {
		t.Fatalf("scheme %s: %v", packID, err)
	}
	return notice, updated
}

// The scheme row carries the manifest's notice; an identical re-import
// writes no scheme row (no restamp), a changed notice updates it.
func TestSchemeNoticeWithoutRestamp(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	seedFixture(t, sqlDB)
	pack, err := dict.LoadPack(hskMini)
	if err != nil {
		t.Fatalf("load pack: %v", err)
	}
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("import: %v", err)
	}
	id := pack.Manifest.ID
	if notice, _ := schemeRow(t, sqlDB, id); notice != "" {
		t.Errorf("pack without notice: notice = %q, want ''", notice)
	}

	if _, err := sqlDB.Exec(`UPDATE schemes SET updated_at = ?`, longAgo); err != nil {
		t.Fatal(err)
	}
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("identical re-import: %v", err)
	}
	if _, updated := schemeRow(t, sqlDB, id); updated != longAgo {
		t.Errorf("identical re-import restamped the scheme: updated_at = %q", updated)
	}

	pack.Manifest.Notice = "Approximate levels, see [the source](https://example.com)."
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("re-import with notice: %v", err)
	}
	notice, updated := schemeRow(t, sqlDB, id)
	if notice != pack.Manifest.Notice || updated == longAgo {
		t.Errorf("changed notice: notice = %q, updated_at = %q; want it stored and restamped", notice, updated)
	}
	schemes, err := levels.List(ctx, sqlDB)
	if err != nil || len(schemes) != 1 || schemes[0].Notice != pack.Manifest.Notice {
		t.Errorf("List = %+v, %v; want the notice", schemes, err)
	}

	// Uninstalled then re-imported unchanged: the row revives.
	if err := levels.Uninstall(ctx, sqlDB, schemes[0].ID); err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("re-import after uninstall: %v", err)
	}
	if schemes, err := levels.List(ctx, sqlDB); err != nil || len(schemes) != 1 {
		t.Errorf("after revive: List = %+v, %v; want the scheme back", schemes, err)
	}

	pack.Manifest.Notice = "[x](data:text/plain,hi)"
	if _, err := levels.Import(ctx, sqlDB, pack); !errors.Is(err, dict.ErrInvalidPack) {
		t.Errorf("import with a data: link = %v, want ErrInvalidPack", err)
	}
}
