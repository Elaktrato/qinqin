package levels_test

import (
	"context"
	"database/sql"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/levels"
)

const longAgo = "2020-01-01T00:00:00Z"

func backdate(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	for _, table := range []string{"levels", "level_members"} {
		if _, err := sqlDB.Exec(`UPDATE ` + table + ` SET updated_at = '` + longAgo + `'`); err != nil {
			t.Fatalf("backdate %s: %v", table, err)
		}
	}
}

func newerThan2021(t *testing.T, sqlDB *sql.DB, table string) int {
	t.Helper()
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM ` + table + ` WHERE updated_at > '2021-01-01T00:00:00Z'`).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

// Re-importing an identical levels pack writes no level or membership
// row: nothing is tombstoned and revived, nothing re-stamped.
func TestReimportIdenticalSchemeWritesNothing(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	seedFixture(t, entries.Store{DB: sqlDB})
	pack, err := dict.LoadPack(hskMini)
	if err != nil {
		t.Fatalf("load pack: %v", err)
	}
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("first import: %v", err)
	}
	backdate(t, sqlDB)

	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("second import: %v", err)
	}
	for _, table := range []string{"levels", "level_members"} {
		if n := newerThan2021(t, sqlDB, table); n != 0 {
			t.Errorf("%s: %d rows written by an identical re-import, want 0", table, n)
		}
	}
}

// A changed pack touches only what changed: unchanged members keep their
// rows, a moved member is tombstoned in the old level and added to the
// new one, and a dropped level is tombstoned with its members.
func TestReimportTouchesOnlyChangedMembers(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	fe := seedFixture(t, entries.Store{DB: sqlDB})
	reimport := func(json string) {
		t.Helper()
		if _, err := levels.Import(ctx, sqlDB, buildPack(t, "hsk-mini", json)); err != nil {
			t.Fatalf("import: %v", err)
		}
	}
	memberStamp := func(entryID int64, level string) (stamp string, active bool, found bool) {
		var deleted sql.NullString
		err := sqlDB.QueryRow(`
			SELECT m.updated_at, m.deleted_at FROM level_members m JOIN levels l ON l.id = m.level_id
			WHERE m.entry_id = ? AND l.name = ?`, entryID, level).Scan(&stamp, &deleted)
		if err == sql.ErrNoRows {
			return "", false, false
		}
		if err != nil {
			t.Fatalf("read member: %v", err)
		}
		return stamp, !deleted.Valid, true
	}

	reimport(`{"unit":"word","levels":[{"name":"1","entries":["你好","谢谢"]},{"name":"2","entries":["银行"]}]}`)
	backdate(t, sqlDB)

	// 谢谢 moves from level 1 to level 2.
	reimport(`{"unit":"word","levels":[{"name":"1","entries":["你好"]},{"name":"2","entries":["银行","谢谢"]}]}`)

	for _, c := range []struct {
		entry int64
		level string
		what  string
	}{{fe.nihao, "1", "你好@1"}, {fe.yinhang, "2", "银行@2"}} {
		stamp, active, found := memberStamp(c.entry, c.level)
		if !found || !active || stamp != longAgo {
			t.Errorf("unchanged member %s: found=%v active=%v updated_at=%s, want untouched", c.what, found, active, stamp)
		}
	}
	if _, active, found := memberStamp(fe.xiexie, "1"); !found || active {
		t.Errorf("谢谢@1: found=%v active=%v, want tombstoned", found, active)
	}
	if stamp, active, found := memberStamp(fe.xiexie, "2"); !found || !active || stamp == longAgo {
		t.Errorf("谢谢@2: found=%v active=%v updated_at=%s, want newly active", found, active, stamp)
	}

	// Dropping level 2 tombstones it and its members; level 1 survives.
	reimport(`{"unit":"word","levels":[{"name":"1","entries":["你好"]}]}`)
	var activeLevels, activeMembersL2 int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM levels WHERE deleted_at IS NULL`).Scan(&activeLevels); err != nil || activeLevels != 1 {
		t.Errorf("active levels = %d, %v; want 1", activeLevels, err)
	}
	if err := sqlDB.QueryRow(`
		SELECT COUNT(*) FROM level_members m JOIN levels l ON l.id = m.level_id
		WHERE l.name = '2' AND m.deleted_at IS NULL`).Scan(&activeMembersL2); err != nil || activeMembersL2 != 0 {
		t.Errorf("active members of dropped level 2 = %d, %v; want 0", activeMembersL2, err)
	}
}
