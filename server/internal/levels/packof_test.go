package levels_test

import (
	"context"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/levels"
)

func TestPackOf(t *testing.T) {
	ctx, sqlDB := context.Background(), dbtest.Open(t)
	if _, err := sqlDB.Exec(`INSERT INTO schemes (id, pack_id, name, unit, version, language, license, attribution, updated_at, deleted_at)
		VALUES (5, 'hsk', 'n', 'word', '1', 'zh', 'l', 'a', 't', NULL), (6, 'old', 'n', 'word', '1', 'ja', 'l', 'a', 't', 't')`); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[int64][2]string{5: {"hsk", "zh"}, 6: {"old", "ja"}, 99: {"", ""}} {
		p, l, err := levels.PackOf(ctx, sqlDB, id)
		if err != nil || p != want[0] || l != want[1] {
			t.Errorf("PackOf(%d) = %q %q %v; want %v", id, p, l, err, want)
		}
	}
}
