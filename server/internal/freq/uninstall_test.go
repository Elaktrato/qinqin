package freq_test

import (
	"context"
	"errors"
	"testing"

	"qinqin/internal/freq"
)

func TestUninstallFrequencyPack(t *testing.T) {
	sqlDB := openDB(t)
	ctx := context.Background()
	body := "猫,ねこ,1\n犬,いぬ,2\n鳥,とり,3\n"
	mustImport(t, sqlDB, csvPack(t, "up", body))
	store := freq.Store{DB: sqlDB}
	before, _ := store.Packs(ctx)
	if len(before) != 1 {
		t.Fatalf("packs before = %+v", before)
	}
	ord := before[0].Ord

	if err := freq.Uninstall(ctx, sqlDB, "up"); err != nil {
		t.Fatalf("Uninstall: %v", err)
	}
	if got, _ := store.Packs(ctx); len(got) != 0 {
		t.Errorf("Packs after uninstall = %+v", got)
	}
	if rows, err := store.Rows(ctx, []string{"猫", "犬", "鳥"}); err != nil || len(rows) != 0 {
		t.Errorf("Rows after uninstall = %+v, %v", rows, err)
	}
	if n := count(t, sqlDB, `SELECT COUNT(*) FROM frequency`); n != 0 {
		t.Errorf("frequency rows left = %d", n)
	}
	if err := freq.Uninstall(ctx, sqlDB, "up"); !errors.Is(err, freq.ErrNotFound) {
		t.Errorf("second Uninstall err = %v, want ErrNotFound", err)
	}
	if err := freq.Uninstall(ctx, sqlDB, "nope"); !errors.Is(err, freq.ErrNotFound) {
		t.Errorf("unknown Uninstall err = %v, want ErrNotFound", err)
	}

	mustImport(t, sqlDB, csvPack(t, "up", body))
	after, _ := store.Packs(ctx)
	if len(after) != 1 || after[0].Ord != ord {
		t.Errorf("Packs after reinstall = %+v, want ord %d", after, ord)
	}
	if n := count(t, sqlDB, `SELECT COUNT(*) FROM frequency`); n != 3 {
		t.Errorf("frequency rows after reinstall = %d, want 3", n)
	}
}
