package backup

import (
	"context"
	"testing"
)

// Fix wave (#199): rows whose own stamp is empty or not RFC 3339 (what a
// migration or an older server could leave) still export as an archive the
// user can restore, and every one of them comes back.
func TestExportAndRestoreRowsWithUnreadableStamps(t *testing.T) {
	w := newWorld(t)
	uid, ws := w.AliceUID, w.Alice.WS1
	exec(t, w.DB, `INSERT INTO grammar_progress (user_id, workspace_id, pack_id, lesson_id, completed_at, best, total, updated_at)
		VALUES (?, ?, 'p', 'empty', '', 1, 2, '2026-11-20T10:00:00Z'), (?, ?, 'p', 'bad', 'yesterday', 1, 2, '2026-11-20T10:00:00Z')`, uid, ws, uid, ws)
	exec(t, w.DB, `INSERT INTO journal_entries (user_id, workspace_id, id, date, title, text, source, created_at, updated_at)
		VALUES (?, ?, 'e1', '2026-11-19', '', 't', 'typed', '2026-11-19T08:00:00Z', '2026-11-20T10:00:00Z')`, uid, ws)
	exec(t, w.DB, `INSERT INTO journal_reviews (user_id, workspace_id, entry_id, text_hash, annotations, overall, model, dropped, created_at)
		VALUES (?, ?, 'e1', 'h', '[]', '{}', 'm', '{}', '')`, uid, ws)
	exec(t, w.DB, `INSERT INTO journal_suggestions (user_id, workspace_id, items, model, created_at) VALUES (?, ?, '[]', 'm', 'soon')`, uid, ws)

	a := openExport(t, w, uid) // fails the test when the archive does not open
	var keep int64
	w.DB.QueryRow(`SELECT id FROM sessions WHERE token_hash = 'keep'`).Scan(&keep)
	if _, rep, err := Restore(context.Background(), deps(w), uid, keep, a, Options{}); err != nil {
		t.Fatalf("Restore: %v (%+v)", err, rep)
	}
	for q, want := range map[string]int{
		`SELECT COUNT(*) FROM grammar_progress WHERE user_id = ?`:    2,
		`SELECT COUNT(*) FROM journal_reviews WHERE user_id = ?`:     1,
		`SELECT COUNT(*) FROM journal_suggestions WHERE user_id = ?`: 1,
	} {
		var n int
		if err := w.DB.QueryRow(q, uid).Scan(&n); err != nil || n != want {
			t.Errorf("%s = %d (%v), want %d", q, n, err, want)
		}
	}
	var completed string
	w.DB.QueryRow(`SELECT completed_at FROM grammar_progress WHERE user_id = ? AND lesson_id = 'empty'`, uid).Scan(&completed)
	if completed != "2026-11-20T10:00:00Z" {
		t.Errorf("restored completedAt %q, want the row's write time", completed)
	}
}

// Fix wave (#199): the dry run drops exactly what the restore drops; a
// journal or grammar row without a workspace is not restored.
func TestPlanDropsWhatTheRestoreDrops(t *testing.T) {
	ws := int64(3)
	for _, c := range []struct {
		row  Row
		drop bool
	}{
		{Row{Key: "journal:settings", WorkspaceID: nil}, true},
		{Row{Key: "journal:settings", WorkspaceID: &ws}, false},
		{Row{Key: "grammar:progress:p:l", WorkspaceID: nil}, true},
		{Row{Key: "grammar:progress:p:l", WorkspaceID: &ws}, false},
		{Row{Key: "appearance", WorkspaceID: nil}, false},
		{Row{Key: "no-such-family", WorkspaceID: nil}, true},
	} {
		if got := planDrops(c.row); got != c.drop {
			t.Errorf("planDrops(%s, ws %v) = %v, want %v", c.row.Key, c.row.WorkspaceID, got, c.drop)
		}
	}
}
