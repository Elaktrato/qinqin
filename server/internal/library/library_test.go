package library_test

import (
	"context"
	"database/sql"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/db"
	"qinqin/internal/library"
)

func setup(t *testing.T) (library.Store, int64, int64) {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return library.Store{DB: sqlDB, Dir: t.TempDir()}, newUser(t, sqlDB, "a"), newUser(t, sqlDB, "b")
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

func book(uid int64, sourceID string) library.Book {
	return library.Book{UserID: uid, Language: "zh", Title: "T", Author: "A", Source: "upload", SourceID: sourceID}
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
	s, a, _ := setup(t)
	ctx := context.Background()
	b, err := s.Create(ctx, book(a, "h1"), chapters())
	if err != nil {
		t.Fatal(err)
	}
	if b.ID == 0 || b.ChapterCount != 2 || b.CreatedAt.IsZero() {
		t.Fatalf("created book: %+v", b)
	}
	list, err := s.List(ctx, a)
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
	s, a, b := setup(t)
	ctx := context.Background()
	bk, _ := s.Create(ctx, book(a, "h1"), chapters())
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
	if l, _ := s.List(ctx, b); len(l) != 0 {
		t.Fatalf("list leaks: %+v", l)
	}
}

func TestCreateDuplicate(t *testing.T) {
	s, a, b := setup(t)
	ctx := context.Background()
	if _, err := s.Create(ctx, book(a, "h1"), chapters()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create(ctx, book(a, "h1"), chapters()); !errors.Is(err, library.ErrDuplicate) {
		t.Fatalf("want ErrDuplicate, got %v", err)
	}
	if n := countFiles(t, s.Dir); n != 1 {
		t.Fatalf("files on disk: %d", n)
	}
	if _, err := s.Create(ctx, book(b, "h1"), chapters()); err != nil {
		t.Fatalf("other user same source: %v", err)
	}
	for i := 0; i < 2; i++ {
		if _, err := s.Create(ctx, book(a, ""), chapters()); err != nil {
			t.Fatalf("empty source id: %v", err)
		}
	}
}

func TestCreateFailureLeavesNoFile(t *testing.T) {
	s, a, _ := setup(t)
	// a regular file where the books dir should be makes the write fail
	// after the row insert; the row must not survive either.
	blocker := filepath.Join(t.TempDir(), "blocker")
	if err := os.WriteFile(blocker, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	s.Dir = blocker
	if _, err := s.Create(context.Background(), book(a, "x"), chapters()); err == nil {
		t.Fatal("want error")
	}
	if l, _ := s.List(context.Background(), a); len(l) != 0 {
		t.Fatalf("row survived failed create: %+v", l)
	}
}

func TestDeleteRemovesFile(t *testing.T) {
	s, a, _ := setup(t)
	ctx := context.Background()
	bk, _ := s.Create(ctx, book(a, "h1"), chapters())
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
	s, a, _ := setup(t)
	ctx := context.Background()
	bk, _ := s.Create(ctx, book(a, "h1"), chapters())
	for _, n := range []int{-1, 2} {
		if _, err := s.Chapter(ctx, a, bk.ID, n); !errors.Is(err, library.ErrNotFound) {
			t.Fatalf("chapter %d: %v", n, err)
		}
	}
}
