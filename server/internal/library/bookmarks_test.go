package library_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"qinqin/internal/library"
)

func TestBookmarksAddListRenameDelete(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, err := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())
	if err != nil {
		t.Fatal(err)
	}

	if list, err := f.ListBookmarks(ctx, f.a, bk.ID); err != nil || list == nil || len(list) != 0 {
		t.Fatalf("empty list: %v %#v, want an empty slice", err, list)
	}

	m1, created, err := f.AddBookmark(ctx, f.a, bk.ID, "0:3", "  你好。 ")
	if err != nil || !created {
		t.Fatalf("add: %v created=%v", err, created)
	}
	if m1.ID == 0 || m1.BookID != bk.ID || m1.Position != "0:3" || m1.Label != "你好。" || m1.CreatedAt.IsZero() {
		t.Errorf("bookmark = %+v", m1)
	}
	m2, _, err := f.AddBookmark(ctx, f.a, bk.ID, "1:0", "")
	if err != nil {
		t.Fatal(err)
	}

	list, err := f.ListBookmarks(ctx, f.a, bk.ID)
	if err != nil || len(list) != 2 || list[0].ID != m1.ID || list[1].ID != m2.ID {
		t.Fatalf("list: %v %+v", err, list)
	}
	if list[0] != m1 {
		t.Errorf("listed %+v, added %+v", list[0], m1)
	}

	// The same position again returns the existing bookmark.
	again, created, err := f.AddBookmark(ctx, f.a, bk.ID, "0:3", "other")
	if err != nil || created || again != m1 {
		t.Errorf("repeat position: %v created=%v %+v, want the existing %+v", err, created, again, m1)
	}

	renamed, err := f.RenameBookmark(ctx, f.a, bk.ID, m2.ID, "\tChapter two ")
	if err != nil || renamed.Label != "Chapter two" || renamed.ID != m2.ID || renamed.Position != "1:0" {
		t.Errorf("rename: %v %+v", err, renamed)
	}
	if err := f.DeleteBookmark(ctx, f.a, bk.ID, m1.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.DeleteBookmark(ctx, f.a, bk.ID, m1.ID); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("second delete: %v, want ErrNotFound", err)
	}
	list, _ = f.ListBookmarks(ctx, f.a, bk.ID)
	if len(list) != 1 || list[0].ID != m2.ID || list[0].Label != "Chapter two" {
		t.Errorf("after rename and delete: %+v", list)
	}
}

func TestBookmarkLabels(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())

	for i, tc := range []struct{ in, want string }{
		{strings.Repeat("字", 120), strings.Repeat("字", 120)},                // runes, not bytes
		{"  " + strings.Repeat("a", 120) + "\n ", strings.Repeat("a", 120)}, // trimmed before counting
		{"line one\nline two\t\tend", "line one line two end"},              // whitespace runs collapse
		{"a\x00b\x1fc", "abc"}, // control characters dropped
		{"soft­hyphen 👩‍💻", "soft­hyphen 👩‍💻"}, // format characters kept
	} {
		m, _, err := f.AddBookmark(ctx, f.a, bk.ID, fmt.Sprintf("0:%d", i), tc.in)
		if err != nil || m.Label != tc.want {
			t.Errorf("label %q: %v %q, want %q", tc.in, err, m.Label, tc.want)
		}
	}
	if _, _, err := f.AddBookmark(ctx, f.a, bk.ID, "9:9", strings.Repeat("字", 121)); !errors.Is(err, library.ErrLabelTooLong) {
		t.Errorf("121 characters: %v, want ErrLabelTooLong", err)
	}
	m, _, _ := f.AddBookmark(ctx, f.a, bk.ID, "9:8", "x")
	if _, err := f.RenameBookmark(ctx, f.a, bk.ID, m.ID, strings.Repeat("a", 121)); !errors.Is(err, library.ErrLabelTooLong) {
		t.Errorf("rename to 121 characters: %v, want ErrLabelTooLong", err)
	}
}

func TestBookmarkPositions(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())

	if _, _, err := f.AddBookmark(ctx, f.a, bk.ID, "", "x"); !errors.Is(err, library.ErrPositionEmpty) {
		t.Errorf("empty position: %v, want ErrPositionEmpty", err)
	}
	// The same length rule as the reading position.
	long := strings.Repeat("1", library.MaxPositionLen+1)
	if _, _, err := f.AddBookmark(ctx, f.a, bk.ID, long, "x"); !errors.Is(err, library.ErrPositionTooLong) {
		t.Errorf("long position: %v, want ErrPositionTooLong", err)
	}
	if err := f.SetPosition(ctx, f.a, bk.ID, long); !errors.Is(err, library.ErrPositionTooLong) {
		t.Errorf("SetPosition long: %v, want ErrPositionTooLong", err)
	}
	if _, _, err := f.AddBookmark(ctx, f.a, bk.ID, strings.Repeat("1", library.MaxPositionLen), "x"); err != nil {
		t.Errorf("position at the cap: %v", err)
	}
	if l, _ := f.ListBookmarks(ctx, f.a, bk.ID); len(l) != 1 {
		t.Errorf("bookmarks = %d, want 1", len(l))
	}
}

func TestBookmarkLimit(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())
	other, _ := f.Create(ctx, book(f.a, f.wa, "h2"), chapters())
	for i := range library.MaxBookmarks {
		if _, _, err := f.AddBookmark(ctx, f.a, bk.ID, fmt.Sprintf("0:%d", i), ""); err != nil {
			t.Fatalf("bookmark %d: %v", i, err)
		}
	}
	if _, _, err := f.AddBookmark(ctx, f.a, bk.ID, "1:0", ""); !errors.Is(err, library.ErrTooMany) {
		t.Errorf("bookmark 201: %v, want ErrTooMany", err)
	}
	// An existing position at the cap still answers with the bookmark.
	if m, created, err := f.AddBookmark(ctx, f.a, bk.ID, "0:5", ""); err != nil || created || m.Position != "0:5" {
		t.Errorf("existing at the cap: %v created=%v %+v", err, created, m)
	}
	// The cap is per book.
	if _, _, err := f.AddBookmark(ctx, f.a, other.ID, "0:0", ""); err != nil {
		t.Errorf("other book: %v", err)
	}
	if l, _ := f.ListBookmarks(ctx, f.a, bk.ID); len(l) != library.MaxBookmarks {
		t.Errorf("bookmarks = %d, want %d", len(l), library.MaxBookmarks)
	}
}

func TestBookmarkConcurrentSamePosition(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())
	var wg sync.WaitGroup
	ids := make([]int64, 8)
	errs := make([]error, 8)
	for i := range ids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m, _, err := f.AddBookmark(ctx, f.a, bk.ID, "2:7", "x")
			ids[i], errs[i] = m.ID, err
		}()
	}
	wg.Wait()
	for i := range ids {
		if errs[i] != nil || ids[i] != ids[0] {
			t.Errorf("add %d: id %d err %v, want id %d", i, ids[i], errs[i], ids[0])
		}
	}
	if l, _ := f.ListBookmarks(ctx, f.a, bk.ID); len(l) != 1 {
		t.Errorf("bookmarks = %d, want 1", len(l))
	}
}

func TestBookmarksOtherUser(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())
	m, _, _ := f.AddBookmark(ctx, f.a, bk.ID, "0:1", "mine")
	bobs, _ := f.Create(ctx, book(f.b, f.wb, "h1"), chapters())

	if _, err := f.ListBookmarks(ctx, f.b, bk.ID); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("list: %v", err)
	}
	if _, _, err := f.AddBookmark(ctx, f.b, bk.ID, "0:2", "x"); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("add: %v", err)
	}
	// The same position as alice's does not hand bob her bookmark.
	if got, _, err := f.AddBookmark(ctx, f.b, bk.ID, "0:1", "x"); !errors.Is(err, library.ErrNotFound) || got.ID != 0 {
		t.Errorf("add at alice's position: %v %+v", err, got)
	}
	if _, err := f.RenameBookmark(ctx, f.b, bk.ID, m.ID, "x"); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("rename: %v", err)
	}
	if err := f.DeleteBookmark(ctx, f.b, bk.ID, m.ID); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("delete: %v", err)
	}
	// Bob's own book id with alice's bookmark id does not reach it either.
	if _, err := f.RenameBookmark(ctx, f.b, bobs.ID, m.ID, "x"); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("rename via own book: %v", err)
	}
	if err := f.DeleteBookmark(ctx, f.b, bobs.ID, m.ID); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("delete via own book: %v", err)
	}
	// Nor does alice reach her bookmark through another of her books.
	mine2, _ := f.Create(ctx, book(f.a, f.wa, "h2"), chapters())
	if err := f.DeleteBookmark(ctx, f.a, mine2.ID, m.ID); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("delete via another book: %v", err)
	}
	if l, _ := f.ListBookmarks(ctx, f.a, bk.ID); len(l) != 1 || l[0].Label != "mine" {
		t.Errorf("alice's bookmarks = %+v, want hers intact", l)
	}
	if l, _ := f.ListBookmarks(ctx, f.a, 999); l != nil {
		t.Errorf("unknown book lists %+v", l)
	}
}

func TestDeleteBookDeletesBookmarks(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())
	keep, _ := f.Create(ctx, book(f.a, f.wa, "h2"), chapters())
	f.AddBookmark(ctx, f.a, bk.ID, "0:1", "")
	f.AddBookmark(ctx, f.a, bk.ID, "0:2", "")
	kept, _, _ := f.AddBookmark(ctx, f.a, keep.ID, "0:1", "")

	if err := f.Delete(ctx, f.a, bk.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := f.DB.QueryRow(`SELECT COUNT(*) FROM library_bookmarks WHERE book_id = ?`, bk.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d bookmarks survive their book", n)
	}
	if l, _ := f.ListBookmarks(ctx, f.a, keep.ID); len(l) != 1 || l[0].ID != kept.ID {
		t.Errorf("other book's bookmarks = %+v", l)
	}
	// The content file goes as before.
	if n := countFiles(t, f.Dir); n != 1 {
		t.Errorf("files = %d, want 1", n)
	}
	// A failed delete (another user) removes no bookmark.
	if err := f.Delete(ctx, f.b, keep.ID); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("bob delete: %v", err)
	}
	if l, _ := f.ListBookmarks(ctx, f.a, keep.ID); len(l) != 1 {
		t.Errorf("bookmarks after bob's delete = %+v", l)
	}
}
