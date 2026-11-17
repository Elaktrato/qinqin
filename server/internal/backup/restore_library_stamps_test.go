package backup

import (
	"context"
	"testing"
	"time"
)

// Review fix (phase A, 1): restored library rows are new rows of this
// server, so every one is stamped updated_at = the restore time (a delta
// pull from any earlier cursor ships them; migration 038 made updated_at a
// column of all three tables). The archive's createdAt is kept.
func TestRestoreStampsLibraryRowsWithTheRestoreTime(t *testing.T) {
	a, err := Open(writeZip(t, sampleFiles(t), zopts{}))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	tg, _ := sampleTarget(t)
	at := time.Date(2026, 11, 16, 12, 30, 0, 0, time.UTC)
	d := deps(tg.baseWorld)
	d.Now = func() time.Time { return at }
	if _, _, err := Restore(context.Background(), d, tg.UID, 0, a, Options{}); err != nil {
		t.Fatalf("Restore: %v", err)
	}
	want := at.Format(time.RFC3339)
	for _, q := range []string{
		`SELECT COUNT(*), COUNT(CASE WHEN updated_at = ? THEN 1 END), COUNT(CASE WHEN created_at = '2026-11-05T00:00:00Z' THEN 1 END) FROM library_books WHERE user_id = ?`,
		`SELECT COUNT(*), COUNT(CASE WHEN updated_at = ? THEN 1 END), COUNT(created_at) FROM library_bookmarks WHERE user_id = ?`,
		`SELECT COUNT(*), COUNT(CASE WHEN updated_at = ? THEN 1 END), COUNT(created_at) FROM library_highlights WHERE user_id = ?`,
	} {
		var n, stamped, created int
		if err := tg.DB.QueryRow(q, want, tg.UID).Scan(&n, &stamped, &created); err != nil {
			t.Fatal(err)
		}
		if n == 0 || stamped != n || created != n {
			t.Errorf("%s: %d rows, %d stamped %s, %d with createdAt", q, n, stamped, want, created)
		}
	}
}
