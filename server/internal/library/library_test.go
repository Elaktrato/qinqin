package library_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/db"
	"qinqin/internal/library"
)

// fixture is a store with two users, each with a zh workspace.
type fixture struct {
	library.Store
	a, b   int64 // users
	wa, wb int64 // their zh workspaces
}

func setup(t *testing.T) fixture {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	f := fixture{Store: library.Store{DB: sqlDB, Dir: t.TempDir()}}
	f.a, f.b = newUser(t, sqlDB, "a"), newUser(t, sqlDB, "b")
	f.wa, f.wb = newWorkspace(t, sqlDB, f.a, "zh", ""), newWorkspace(t, sqlDB, f.b, "zh", "")
	return f
}

func newWorkspace(t *testing.T, sqlDB *sql.DB, uid int64, language, name string) int64 {
	t.Helper()
	res, err := sqlDB.Exec(`INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (?, ?, ?, '{}', 't')`, uid, language, name)
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

func newUser(t *testing.T, sqlDB *sql.DB, name string) int64 {
	t.Helper()
	u, err := auth.CreateUser(context.Background(), sqlDB, name, "pw-"+name, false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return u.ID
}

func chapters() []library.Chapter {
	return []library.Chapter{
		{Title: "One", Paragraphs: []library.Paragraph{{{Text: "你好", Ruby: "nǐ hǎo"}, {Text: "。"}}}},
		{Title: "Two", Paragraphs: []library.Paragraph{{{Text: "再见"}}}},
	}
}

func book(uid, ws int64, sourceID string) library.Book {
	return library.Book{UserID: uid, WorkspaceID: ws, Language: "zh", Title: "T", Author: "A", Source: "upload", SourceID: sourceID}
}

func countFiles(t *testing.T, dir string) int {
	t.Helper()
	n := 0
	filepath.WalkDir(dir, func(_ string, d fs.DirEntry, _ error) error {
		if !d.IsDir() {
			n++
		}
		return nil
	})
	return n
}

func TestCreateListGetRoundTrip(t *testing.T) {
	f := setup(t)
	s, a := f.Store, f.a
	ctx := context.Background()
	b, err := s.Create(ctx, book(a, f.wa, "h1"), chapters())
	if err != nil {
		t.Fatal(err)
	}
	if b.ID == 0 || b.ChapterCount != 2 || b.CreatedAt.IsZero() {
		t.Fatalf("created book: %+v", b)
	}
	list, err := s.List(ctx, a, 0)
	if err != nil || len(list) != 1 || list[0].ID != b.ID {
		t.Fatalf("list: %v %+v", err, list)
	}
	got, err := s.Get(ctx, a, b.ID)
	if err != nil || got.Title != "T" || got.SourceID != "h1" || got.ChapterCount != 2 {
		t.Fatalf("get: %v %+v", err, got)
	}
	ch, err := s.Chapter(ctx, a, b.ID, 1)
	if err != nil || ch.Title != "Two" || ch.Paragraphs[0][0].Text != "再见" {
		t.Fatalf("chapter: %v %+v", err, ch)
	}
	if err := s.SetPosition(ctx, a, b.ID, "1:3"); err != nil {
		t.Fatal(err)
	}
	got, _ = s.Get(ctx, a, b.ID)
	if got.Position != "1:3" {
		t.Fatalf("position %q", got.Position)
	}
}

func TestGetOtherUsersBook(t *testing.T) {
	f := setup(t)
	s, a, b := f.Store, f.a, f.b
	ctx := context.Background()
	bk, _ := s.Create(ctx, book(a, f.wa, "h1"), chapters())
	if _, err := s.Get(ctx, b, bk.ID); !errors.Is(err, library.ErrNotFound) {
		t.Fatalf("get: %v", err)
	}
	if _, err := s.Chapter(ctx, b, bk.ID, 0); !errors.Is(err, library.ErrNotFound) {
		t.Fatalf("chapter: %v", err)
	}
	if err := s.SetPosition(ctx, b, bk.ID, "x"); !errors.Is(err, library.ErrNotFound) {
		t.Fatalf("setposition: %v", err)
	}
	if err := s.Delete(ctx, b, bk.ID); !errors.Is(err, library.ErrNotFound) {
		t.Fatalf("delete: %v", err)
	}
	if l, _ := s.List(ctx, b, 0); len(l) != 0 {
		t.Fatalf("list leaks: %+v", l)
	}
}

func TestCreateDuplicate(t *testing.T) {
	f := setup(t)
	s, a, b := f.Store, f.a, f.b
	ctx := context.Background()
	if _, err := s.Create(ctx, book(a, f.wa, "h1"), chapters()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(ctx, book(a, f.wa, "h1"), chapters()); !errors.Is(err, library.ErrDuplicate) {
		t.Fatalf("want ErrDuplicate, got %v", err)
	}
	if n := countFiles(t, s.Dir); n != 1 {
		t.Fatalf("files on disk: %d", n)
	}
	if _, err := s.Create(ctx, book(b, f.wb, "h1"), chapters()); err != nil {
		t.Fatalf("other user same source: %v", err)
	}
	for i := 0; i < 2; i++ {
		if _, err := s.Create(ctx, book(a, f.wa, ""), chapters()); err != nil {
			t.Fatalf("empty source id: %v", err)
		}
	}
}

func TestCreateFailureLeavesNoFile(t *testing.T) {
	f := setup(t)
	s, a := f.Store, f.a
	// a regular file where the books dir should be makes the write fail
	// after the row insert; the row must not survive either.
	blocker := filepath.Join(t.TempDir(), "blocker")
	if err := os.WriteFile(blocker, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	s.Dir = blocker
	if _, err := s.Create(context.Background(), book(a, f.wa, "x"), chapters()); err == nil {
		t.Fatal("want error")
	}
	if l, _ := s.List(context.Background(), a, 0); len(l) != 0 {
		t.Fatalf("row survived failed create: %+v", l)
	}
}

func TestDeleteRemovesFile(t *testing.T) {
	f := setup(t)
	s, a := f.Store, f.a
	ctx := context.Background()
	bk, _ := s.Create(ctx, book(a, f.wa, "h1"), chapters())
	if err := s.Delete(ctx, a, bk.ID); err != nil {
		t.Fatal(err)
	}
	if n := countFiles(t, s.Dir); n != 0 {
		t.Fatalf("files remain: %d", n)
	}
	if _, err := s.Get(ctx, a, bk.ID); !errors.Is(err, library.ErrNotFound) {
		t.Fatalf("get after delete: %v", err)
	}
}

func TestChapterOutOfRange(t *testing.T) {
	f := setup(t)
	s, a := f.Store, f.a
	ctx := context.Background()
	bk, _ := s.Create(ctx, book(a, f.wa, "h1"), chapters())
	for _, n := range []int{-1, 2} {
		if _, err := s.Chapter(ctx, a, bk.ID, n); !errors.Is(err, library.ErrNotFound) {
			t.Fatalf("chapter %d: %v", n, err)
		}
	}
}

func TestCreateScopesToWorkspace(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	graded := newWorkspace(t, f.DB, f.a, "zh", "graded")
	ja := newWorkspace(t, f.DB, f.a, "ja", "")

	b1, err := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())
	if err != nil || b1.WorkspaceID != f.wa {
		t.Fatalf("create in wa: %v %+v", err, b1)
	}
	// The same work in a second zh workspace is not a duplicate.
	b2, err := f.Create(ctx, book(f.a, graded, "h1"), chapters())
	if err != nil {
		t.Fatalf("same source in another workspace: %v", err)
	}
	if _, err := f.Create(ctx, book(f.a, graded, "h1"), chapters()); !errors.Is(err, library.ErrDuplicate) {
		t.Fatalf("repeat in the same workspace: %v, want ErrDuplicate", err)
	}

	// List filters by workspace; 0 lists all of the user's books.
	for ws, want := range map[int64][]int64{0: {b1.ID, b2.ID}, f.wa: {b1.ID}, graded: {b2.ID}, ja: nil, f.wb: nil} {
		list, err := f.List(ctx, f.a, ws)
		if err != nil {
			t.Fatal(err)
		}
		if list == nil {
			t.Errorf("list %d is nil, want an empty slice", ws)
		}
		var ids []int64
		for _, b := range list {
			ids = append(ids, b.ID)
			if ws != 0 && b.WorkspaceID != ws {
				t.Errorf("list %d returned book of workspace %d", ws, b.WorkspaceID)
			}
		}
		if fmt.Sprint(ids) != fmt.Sprint(want) {
			t.Errorf("list workspace %d = %v, want %v", ws, ids, want)
		}
	}
	got, err := f.Get(ctx, f.a, b2.ID)
	if err != nil || got.WorkspaceID != graded {
		t.Errorf("get: %v %+v, want workspace %d", err, got, graded)
	}
}

func TestCreateChecksWorkspace(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	ja := newWorkspace(t, f.DB, f.a, "ja", "")

	// Another user's workspace, an unknown one and none at all.
	for _, ws := range []int64{f.wb, 999, 0} {
		if _, err := f.Create(ctx, book(f.a, ws, "x"), chapters()); !errors.Is(err, library.ErrWorkspaceNotFound) {
			t.Errorf("workspace %d: %v, want ErrWorkspaceNotFound", ws, err)
		}
	}
	// A workspace of another language.
	_, err := f.Create(ctx, book(f.a, ja, "x"), chapters())
	var mismatch *library.LanguageMismatchError
	if !errors.As(err, &mismatch) || mismatch.Workspace != "ja" || mismatch.Book != "zh" {
		t.Fatalf("language mismatch: %v", err)
	}
	if mismatch.Error() != "workspace language is ja, book is zh" {
		t.Errorf("message = %q", mismatch.Error())
	}
	if l, _ := f.List(ctx, f.a, 0); len(l) != 0 {
		t.Errorf("rejected creates stored books: %+v", l)
	}
	if n := countFiles(t, f.Dir); n != 0 {
		t.Errorf("rejected creates left %d files", n)
	}
}

func TestHasSource(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	graded := newWorkspace(t, f.DB, f.a, "zh", "graded")
	if _, err := f.Create(ctx, book(f.a, f.wa, "h1"), chapters()); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		user, ws         int64
		source, sourceID string
		want             bool
	}{
		{f.a, f.wa, "upload", "h1", true},
		{f.a, graded, "upload", "h1", false}, // another workspace
		{f.a, f.wa, "aozora", "h1", false},   // another source
		{f.a, f.wa, "upload", "h2", false},   // another work
		{f.b, f.wa, "upload", "h1", false},   // not the user's workspace
	} {
		got, err := f.HasSource(ctx, tc.user, tc.ws, tc.source, tc.sourceID)
		if err != nil || got != tc.want {
			t.Errorf("HasSource(%+v) = %v %v, want %v", tc, got, err, tc.want)
		}
	}
}

func TestWorkspaceLanguage(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	if lang, err := f.WorkspaceLanguage(ctx, f.a, f.wa); err != nil || lang != "zh" {
		t.Errorf("own workspace: %q %v", lang, err)
	}
	for _, ws := range []int64{f.wb, 999, 0} {
		if _, err := f.WorkspaceLanguage(ctx, f.a, ws); !errors.Is(err, library.ErrWorkspaceNotFound) {
			t.Errorf("workspace %d: %v, want ErrWorkspaceNotFound", ws, err)
		}
	}
}
