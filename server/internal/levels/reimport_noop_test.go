package levels_test

import (
	"context"
	"database/sql"
	"slices"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/levels"
	"qinqin/internal/model"
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
	sqlDB := dbtest.Open(t)
	seedFixture(t, sqlDB)
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
	sqlDB := dbtest.Open(t)
	fe := seedFixture(t, sqlDB)
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

// A re-seed of a changed pack with the same pack id (the bundled
// jlpt-kanji renamed to "JLPT kanji (approximate)" with kanji added and
// dropped) updates the scheme in place: same scheme id, the new name and
// version on the scheme and its badges, added kanji listed, dropped ones
// gone.
func TestReimportChangedPackRenamesSchemeAndUpdatesMembers(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	fe := seedFixture(t, sqlDB)
	importAs := func(name, version, json string) {
		t.Helper()
		pack := buildPack(t, "jlpt-kanji", json)
		pack.Manifest.Name, pack.Manifest.Version = name, version
		if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
			t.Fatalf("import %s: %v", name, err)
		}
	}
	schemes := func() []model.Scheme {
		t.Helper()
		s, err := levels.List(ctx, sqlDB)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		return s
	}
	members := func(id int64, level string) []int64 {
		t.Helper()
		ids, err := levels.EntryIDs(ctx, sqlDB, id, level)
		if err != nil {
			t.Fatalf("EntryIDs %s: %v", level, err)
		}
		slices.Sort(ids)
		return ids
	}
	sorted := func(ids ...int64) []int64 { slices.Sort(ids); return ids }

	importAs("JLPT (kanji)", "1", `{"unit":"character","levels":[{"name":"N5","entries":["你","好"]},{"name":"N4","entries":["谢"]}]}`)
	before := schemes()
	if len(before) != 1 {
		t.Fatalf("schemes after first import = %+v, want 1", before)
	}

	// 好 dropped, 银 added to N5, 行 added to N4.
	importAs("JLPT kanji (approximate)", "2", `{"unit":"character","levels":[{"name":"N5","entries":["你","银"]},{"name":"N4","entries":["谢","行"]}]}`)
	after := schemes()
	if len(after) != 1 || after[0].ID != before[0].ID {
		t.Fatalf("schemes after re-import = %+v, want the same single scheme %d", after, before[0].ID)
	}
	if s := after[0]; s.Name != "JLPT kanji (approximate)" || s.Version != "2" || s.PackID != "jlpt-kanji" {
		t.Errorf("scheme = name %q, version %q, pack %q; want the renamed jlpt-kanji, version 2", s.Name, s.Version, s.PackID)
	}
	id := after[0].ID
	if got, want := members(id, "N5"), sorted(fe.chars["你"], fe.chars["银"]); !slices.Equal(got, want) {
		t.Errorf("N5 members = %v, want %v (你, 银)", got, want)
	}
	if got, want := members(id, "N4"), sorted(fe.chars["谢"], fe.chars["行"]); !slices.Equal(got, want) {
		t.Errorf("N4 members = %v, want %v (谢, 行)", got, want)
	}
	if badges, err := levels.ForEntry(ctx, sqlDB, fe.chars["好"]); err != nil || len(badges) != 0 {
		t.Errorf("好 badges = %+v, %v; want none (dropped)", badges, err)
	}
	badges, err := levels.ForEntry(ctx, sqlDB, fe.chars["银"])
	if err != nil || len(badges) != 1 || badges[0].SchemeName != "JLPT kanji (approximate)" || badges[0].LevelName != "N5" {
		t.Errorf("银 badges = %+v, %v; want N5 of JLPT kanji (approximate)", badges, err)
	}
}
