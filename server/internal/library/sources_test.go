package library_test

import (
	"context"
	"testing"

	"qinqin/internal/library"
	"qinqin/internal/model"
	"qinqin/internal/sentences"
)

// A saved sentence's source (#280) loses its book when the book goes, by a
// book delete or a workspace delete, and keeps its title and place.
func TestDeletingABookDetachesItsSentences(t *testing.T) {
	ctx := context.Background()
	f := setup(t)
	// Entry 900 need not exist: own sentences are not checked against the lexicon here.
	one, err := f.Create(ctx, book(f.a, f.wa, "one"), chapters())
	if err != nil {
		t.Fatal(err)
	}
	two, err := f.Create(ctx, book(f.a, f.wa, "two"), chapters())
	if err != nil {
		t.Fatal(err)
	}
	save := func(bookID int64, text string) int64 {
		src := sentences.BookSource(sentences.SourceRequest{BookID: bookID, Chapter: 0, Paragraph: 1, Start: 2, End: 4}, "T")
		id, err := sentences.AddUser(ctx, f.DB, f.a, 900, model.Sentence{Hanzi: text, Source: &src})
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	s1, s2 := save(one.ID, "一。"), save(two.ID, "二。")
	bookOf := func(id int64) *int64 {
		s, err := sentences.Get(ctx, f.DB, id, f.a)
		if err != nil {
			t.Fatal(err)
		}
		if s.Source == nil || s.Source.Title != "T" || s.Source.Paragraph != 1 || s.Source.Start != 2 || s.Source.End != 4 {
			t.Fatalf("source of %d = %+v", id, s.Source)
		}
		return s.Source.BookID
	}

	if err := f.Delete(ctx, f.a, one.ID); err != nil {
		t.Fatal(err)
	}
	if b := bookOf(s1); b != nil {
		t.Fatalf("a deleted book's sentence still links to book %d", *b)
	}
	if b := bookOf(s2); b == nil || *b != two.ID {
		t.Fatalf("another book's sentence lost its book: %v", b)
	}

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
	if b := bookOf(s2); b != nil {
		t.Fatalf("a workspace delete left the link to book %d", *b)
	}
}
