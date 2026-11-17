package library_test

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"qinqin/internal/library"
)

// Library rows carry a write stamp (updatedAt) and every deletion is
// logged in library_deletions in the same transaction (migration 038),
// so a delta sync (item 5) can page library changes and tombstones.

const old = "2020-01-01T00:00:00Z"

func backdate(t *testing.T, f fixture, table string, id int64) {
	t.Helper()
	if _, err := f.DB.Exec(`UPDATE `+table+` SET updated_at = ? WHERE id = ?`, old, id); err != nil {
		t.Fatal(err)
	}
}

func fresh(t *testing.T, ts time.Time) {
	t.Helper()
	if !ts.After(time.Date(2021, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("updatedAt %v was not stamped", ts)
	}
}

func TestLibraryRowsCarryUpdatedAt(t *testing.T) {
	ctx := context.Background()
	f := setup(t)
	b, err := f.Create(ctx, book(f.a, f.wa, "s"), chapters())
	if err != nil {
		t.Fatal(err)
	}
	if b.UpdatedAt.IsZero() || !b.UpdatedAt.Equal(b.CreatedAt) {
		t.Errorf("created book updatedAt %v, createdAt %v", b.UpdatedAt, b.CreatedAt)
	}
	got, err := f.Get(ctx, f.a, b.ID)
	if err != nil || !got.UpdatedAt.Equal(b.CreatedAt) {
		t.Errorf("read book updatedAt %v (%v)", got.UpdatedAt, err)
	}
	// A position write stamps the book.
	backdate(t, f, "library_books", b.ID)
	if err := f.SetPosition(ctx, f.a, b.ID, "1:0"); err != nil {
		t.Fatal(err)
	}
	got, _ = f.Get(ctx, f.a, b.ID)
	fresh(t, got.UpdatedAt)
	list, _ := f.List(ctx, f.a, f.wa)
	if len(list) != 1 || !list[0].UpdatedAt.Equal(got.UpdatedAt) {
		t.Errorf("listed book %+v", list)
	}

	m, _, err := f.AddBookmark(ctx, f.a, b.ID, "0:0", "start")
	if err != nil {
		t.Fatal(err)
	}
	if !m.UpdatedAt.Equal(m.CreatedAt) {
		t.Errorf("new bookmark updatedAt %v createdAt %v", m.UpdatedAt, m.CreatedAt)
	}
	backdate(t, f, "library_bookmarks", m.ID)
	renamed, err := f.RenameBookmark(ctx, f.a, b.ID, m.ID, "beginning")
	if err != nil {
		t.Fatal(err)
	}
	fresh(t, renamed.UpdatedAt)
	ms, _ := f.ListBookmarks(ctx, f.a, b.ID)
	if len(ms) != 1 || !ms[0].UpdatedAt.Equal(renamed.UpdatedAt) {
		t.Errorf("listed bookmarks %+v", ms)
	}
	// An existing bookmark at the position comes back unchanged.
	backdate(t, f, "library_bookmarks", m.ID)
	again, created, err := f.AddBookmark(ctx, f.a, b.ID, "0:0", "x")
	if err != nil || created || again.UpdatedAt.Format(time.RFC3339) != old {
		t.Errorf("re-add: created %v updatedAt %v (%v)", created, again.UpdatedAt, err)
	}

	h, err := f.AddHighlight(ctx, f.a, b.ID, hl(0, 0, 0, 2, "你好"))
	if err != nil {
		t.Fatal(err)
	}
	backdate(t, f, "library_highlights", h.ID)
	color := "green"
	edited, err := f.UpdateHighlight(ctx, f.a, b.ID, h.ID, &color, nil)
	if err != nil {
		t.Fatal(err)
	}
	fresh(t, edited.UpdatedAt)
}

type deletion struct {
	user, ws int64
	coll     string
	row      int64
}

func deletions(t *testing.T, f fixture) []deletion {
	t.Helper()
	rs, err := f.DB.Query(`SELECT user_id, workspace_id, collection, row_id, deleted_at FROM library_deletions`)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Close()
	var out []deletion
	for rs.Next() {
		var d deletion
		var at string
		if err := rs.Scan(&d.user, &d.ws, &d.coll, &d.row, &at); err != nil {
			t.Fatal(err)
		}
		if _, err := time.Parse(time.RFC3339, at); err != nil {
			t.Errorf("deleted_at %q: %v", at, err)
		}
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return fmt.Sprint(out[i]) < fmt.Sprint(out[j]) })
	return out
}

func clearDeletions(t *testing.T, f fixture) {
	t.Helper()
	if _, err := f.DB.Exec(`DELETE FROM library_deletions`); err != nil {
		t.Fatal(err)
	}
}

func TestEveryLibraryDeleteIsLogged(t *testing.T) {
	ctx := context.Background()
	f := setup(t)
	b, _ := f.Create(ctx, book(f.a, f.wa, "one"), chapters())
	m, _, _ := f.AddBookmark(ctx, f.a, b.ID, "0:0", "x")
	m2, _, _ := f.AddBookmark(ctx, f.a, b.ID, "1:0", "y")
	h, _ := f.AddHighlight(ctx, f.a, b.ID, hl(0, 0, 0, 2, "你好"))
	h2, _ := f.AddHighlight(ctx, f.a, b.ID, hl(1, 0, 0, 2, "再见"))

	// Another user's ids log nothing.
	if err := f.DeleteBookmark(ctx, f.b, b.ID, m.ID); err == nil {
		t.Error("bob deleted alice's bookmark")
	}
	if err := f.DeleteHighlight(ctx, f.b, b.ID, h.ID); err == nil {
		t.Error("bob deleted alice's highlight")
	}
	if err := f.Delete(ctx, f.b, b.ID); err == nil {
		t.Error("bob deleted alice's book")
	}
	if got := deletions(t, f); len(got) != 0 {
		t.Fatalf("refused deletes logged %v", got)
	}

	if err := f.DeleteBookmark(ctx, f.a, b.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.DeleteHighlight(ctx, f.a, b.ID, h.ID); err != nil {
		t.Fatal(err)
	}
	want := []deletion{{f.a, f.wa, "bookmarks", m.ID}, {f.a, f.wa, "highlights", h.ID}}
	if got := deletions(t, f); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("single deletes logged %v, want %v", got, want)
	}
	clearDeletions(t, f)
	// A book goes with its remaining bookmarks and highlights.
	if err := f.Delete(ctx, f.a, b.ID); err != nil {
		t.Fatal(err)
	}
	want = []deletion{{f.a, f.wa, "bookmarks", m2.ID}, {f.a, f.wa, "books", b.ID}, {f.a, f.wa, "highlights", h2.ID}}
	if got := deletions(t, f); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("book delete logged %v, want %v", got, want)
	}
	clearDeletions(t, f)

	// A workspace's books, bookmarks and highlights, inside the caller's transaction.
	other := newWorkspace(t, f.DB, f.a, "zh", "second")
	w1, _ := f.Create(ctx, book(f.a, f.wa, "w1"), chapters())
	keep, _ := f.Create(ctx, book(f.a, other, "keep"), chapters())
	wm, _, _ := f.AddBookmark(ctx, f.a, w1.ID, "0:0", "x")
	wh, _ := f.AddHighlight(ctx, f.a, w1.ID, hl(0, 0, 0, 2, "你好"))
	f.AddBookmark(ctx, f.a, keep.ID, "0:0", "x")
	tx, err := f.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := library.DeleteWorkspaceBooks(ctx, tx, f.a, f.wa); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	want = []deletion{{f.a, f.wa, "bookmarks", wm.ID}, {f.a, f.wa, "books", w1.ID}, {f.a, f.wa, "highlights", wh.ID}}
	if got := deletions(t, f); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("workspace delete logged %v, want %v", got, want)
	}
}

// A failing log insert rolls the deletion back: no row is lost from the
// log while it disappears from the live table.
func TestLibraryDeleteRollsBackWhenTheLogFails(t *testing.T) {
	ctx := context.Background()
	f := setup(t)
	b, _ := f.Create(ctx, book(f.a, f.wa, "one"), chapters())
	m, _, _ := f.AddBookmark(ctx, f.a, b.ID, "0:0", "x")
	h, _ := f.AddHighlight(ctx, f.a, b.ID, hl(0, 0, 0, 2, "你好"))
	if _, err := f.DB.Exec(`CREATE TRIGGER boom BEFORE INSERT ON library_deletions BEGIN SELECT RAISE(ABORT, 'boom'); END`); err != nil {
		t.Fatal(err)
	}
	for name, del := range map[string]func() error{
		"bookmark":  func() error { return f.DeleteBookmark(ctx, f.a, b.ID, m.ID) },
		"highlight": func() error { return f.DeleteHighlight(ctx, f.a, b.ID, h.ID) },
		"book":      func() error { return f.Delete(ctx, f.a, b.ID) },
		"workspace": func() error {
			tx, err := f.DB.BeginTx(ctx, nil)
			if err != nil {
				return err
			}
			defer tx.Rollback()
			_, err = library.DeleteWorkspaceBooks(ctx, tx, f.a, f.wa)
			return err
		},
	} {
		if err := del(); err == nil || !strings.Contains(err.Error(), "boom") {
			t.Errorf("%s delete with a failing log: %v", name, err)
		}
	}
	var n int
	f.DB.QueryRow(`SELECT (SELECT COUNT(*) FROM library_books) + (SELECT COUNT(*) FROM library_bookmarks) + (SELECT COUNT(*) FROM library_highlights)`).Scan(&n)
	if n != 3 {
		t.Errorf("%d library rows left, want all 3", n)
	}
}
