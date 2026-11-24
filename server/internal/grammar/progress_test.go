package grammar

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"qinqin/internal/dbtest"
)

func TestRecordRunKeepsTheBestAndIsolates(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice, bob := dbtest.User(t, sqlDB, "alice"), dbtest.User(t, sqlDB, "bob")
	ws, ws2 := dbtest.Workspace(t, sqlDB, alice, "zh"), dbtest.Workspace(t, sqlDB, alice, "ja")
	bobWS := dbtest.Workspace(t, sqlDB, bob, "zh")
	run := func(user, ws int64, lesson string, score, total int) Progress {
		t.Helper()
		p, err := RecordRun(ctx, sqlDB, user, ws, "zh-grammar", lesson, score, total)
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	if p := run(alice, ws, "le", 3, 4); p.Best != 3 || p.Total != 4 || p.CompletedAt == "" || p.PackID != "zh-grammar" || p.LessonID != "le" {
		t.Errorf("first run = %+v", p)
	}
	if p := run(alice, ws, "le", 1, 4); p.Best != 3 {
		t.Errorf("a lower score lowered the best: %+v", p)
	}
	if p := run(alice, ws, "le", 4, 4); p.Best != 4 {
		t.Errorf("a higher score = %+v", p)
	}
	if p := run(alice, ws, "le", 2, 5); p.Best != 2 || p.Total != 5 {
		t.Errorf("another number of exercises starts over: %+v", p)
	}
	run(alice, ws2, "le", 1, 1)
	run(bob, bobWS, "ba", 1, 2)
	list, err := ListProgress(ctx, sqlDB, alice, ws)
	if err != nil || len(list) != 1 || list[0].LessonID != "le" || list[0].Best != 2 {
		t.Errorf("alice's list = %+v (%v)", list, err)
	}
	if list, err := ListProgress(ctx, sqlDB, bob, ws); err != nil || len(list) != 0 {
		t.Errorf("bob reading alice's workspace = %+v (%v)", list, err)
	}
	for name, c := range map[string]struct {
		pack, lesson string
		score, total int
	}{
		"score above total": {"zh-grammar", "le", 5, 4},
		"negative score":    {"zh-grammar", "le", -1, 4},
		"huge total":        {"zh-grammar", "le", 1, 1001},
		"bad lesson id":     {"zh-grammar", "Le Change", 1, 1},
		"empty pack":        {"", "le", 1, 1},
		"bad pack id":       {"zh grammar", "le", 1, 1},
	} {
		var inv *InvalidError
		if _, err := RecordRun(ctx, sqlDB, alice, ws, c.pack, c.lesson, c.score, c.total); !errors.As(err, &inv) {
			t.Errorf("%s: %v, want an InvalidError", name, err)
		}
	}
}

// Fix wave (#199): a user holds at most MaxProgressRows lessons' progress; a
// new lesson beyond it is refused, a lesson already stored still records.
func TestRecordRunCapsTheRowsOfAUser(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice, bob := dbtest.User(t, sqlDB, "alice"), dbtest.User(t, sqlDB, "bob")
	ws, bobWS := dbtest.Workspace(t, sqlDB, alice, "zh"), dbtest.Workspace(t, sqlDB, bob, "zh")
	tx, err := sqlDB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < MaxProgressRows; i++ {
		if _, err := tx.Exec(`INSERT INTO grammar_progress (user_id, workspace_id, pack_id, lesson_id, completed_at, best, total, updated_at)
			VALUES (?, ?, 'p', ?, '2026-11-20T10:00:00Z', 0, 1, '2026-11-20T10:00:00Z')`, alice, ws, fmt.Sprintf("l%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var inv *InvalidError
	if _, err := RecordRun(ctx, sqlDB, alice, ws, "p", "one-more", 1, 1); !errors.As(err, &inv) {
		t.Errorf("a lesson beyond the cap: %v, want InvalidError", err)
	}
	if _, err := RecordRun(ctx, sqlDB, alice, ws, "p", "l7", 1, 1); err != nil {
		t.Errorf("a stored lesson: %v", err)
	}
	if _, err := RecordRun(ctx, sqlDB, bob, bobWS, "p", "one-more", 1, 1); err != nil {
		t.Errorf("another user: %v", err)
	}
}
