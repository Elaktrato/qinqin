package library_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"qinqin/internal/library"
)

// TestDeleteWorkspaceBooks deletes every book of one workspace with its
// bookmarks and highlights inside the caller's transaction, returns
// their ids for RemoveContent, and leaves the user's other workspace and
// other users' books untouched.
func TestDeleteWorkspaceBooks(t *testing.T) {
	ctx := context.Background()
	f := setup(t)
	other := newWorkspace(t, f.DB, f.a, "zh", "second")

	b1, err := f.Create(ctx, book(f.a, f.wa, "one"), chapters())
	if err != nil {
		t.Fatal(err)
	}
	b2, err := f.Create(ctx, book(f.a, f.wa, "two"), chapters())
	if err != nil {
		t.Fatal(err)
	}
	keep, err := f.Create(ctx, book(f.a, other, "one"), chapters())
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := f.Create(ctx, book(f.b, f.wb, "one"), chapters())
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []int64{b1.ID, b2.ID, keep.ID} {
		if _, _, err := f.AddBookmark(ctx, f.a, id, "0:0", "x"); err != nil {
			t.Fatal(err)
		}
		if _, err := f.AddHighlight(ctx, f.a, id, hl(0, 0, 0, 2, "你好")); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := f.AddBookmark(ctx, f.b, foreign.ID, "0:0", "x"); err != nil {
		t.Fatal(err)
	}

	// Another user's id deletes nothing.
	tx, err := f.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	ids, err := library.DeleteWorkspaceBooks(ctx, tx, f.b, f.wa)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 0 {
		t.Errorf("foreign user deleted %v", ids)
	}
	tx.Rollback()

	tx, err = f.DB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	ids, err = library.DeleteWorkspaceBooks(ctx, tx, f.a, f.wa)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 || ids[0] != b1.ID || ids[1] != b2.ID {
		t.Errorf("deleted ids = %v, want [%d %d]", ids, b1.ID, b2.ID)
	}
	if err := f.RemoveContent(f.a, ids); err != nil {
		t.Fatalf("RemoveContent: %v", err)
	}
	// A second removal of the same (now missing) files is not an error.
	if err := f.RemoveContent(f.a, ids); err != nil {
		t.Fatalf("RemoveContent again: %v", err)
	}

	for _, id := range ids {
		if _, err := f.Get(ctx, f.a, id); !errors.Is(err, library.ErrNotFound) {
			t.Errorf("book %d after delete: err = %v, want ErrNotFound", id, err)
		}
		if _, err := os.Stat(filepath.Join(f.Dir, strconv.FormatInt(f.a, 10), strconv.FormatInt(id, 10)+".json")); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("content file of book %d still there (stat err %v)", id, err)
		}
	}
	for _, q := range []string{
		`SELECT COUNT(*) FROM library_bookmarks WHERE book_id IN (?, ?)`,
		`SELECT COUNT(*) FROM library_highlights WHERE book_id IN (?, ?)`,
	} {
		var n int
		if err := f.DB.QueryRow(q, b1.ID, b2.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Errorf("%s: %d rows left", q, n)
		}
	}

	// The other workspace and the other user keep everything.
	if _, err := f.Get(ctx, f.a, keep.ID); err != nil {
		t.Errorf("kept book: %v", err)
	}
	if _, err := f.Chapter(ctx, f.a, keep.ID, 0); err != nil {
		t.Errorf("kept book content: %v", err)
	}
	if list, err := f.ListBookmarks(ctx, f.a, keep.ID); err != nil || len(list) != 1 {
		t.Errorf("kept bookmarks = %v, %v", list, err)
	}
	if list, err := f.ListHighlights(ctx, f.a, keep.ID); err != nil || len(list) != 1 {
		t.Errorf("kept highlights = %v, %v", list, err)
	}
	if _, err := f.Chapter(ctx, f.b, foreign.ID, 0); err != nil {
		t.Errorf("foreign book content: %v", err)
	}
	if list, err := f.ListBookmarks(ctx, f.b, foreign.ID); err != nil || len(list) != 1 {
		t.Errorf("foreign bookmarks = %v, %v", list, err)
	}
}
