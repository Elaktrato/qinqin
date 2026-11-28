package backup

import (
	"context"
	"database/sql"
	"strings"
	"testing"
)

// A saved sentence's source (#280) goes into the backup with the book's
// archive id, and a restore points it at the restored book's new id.
func TestRestoreMapsTheSentenceSourceToTheRestoredBook(t *testing.T) {
	a, err := Open(writeZip(t, sampleFiles(t), zopts{}))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	tg, _ := sampleTarget(t)
	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{}); err != nil {
		t.Fatalf("Restore: %v", err)
	}
	var book int64
	if err := tg.DB.QueryRow(`SELECT id FROM library_books WHERE user_id = ? AND title = 'Sample book'`, tg.UID).Scan(&book); err != nil {
		t.Fatal(err)
	}
	var kind, title string
	var srcBook sql.NullInt64
	var chapter, paragraph, start, end int
	if err := tg.DB.QueryRow(`SELECT source_kind, source_book_id, source_title, source_chapter, source_paragraph, source_start, source_end
		FROM sentences WHERE user_id = ? AND hanzi = '你好，世界。' AND deleted_at IS NULL`, tg.UID).
		Scan(&kind, &srcBook, &title, &chapter, &paragraph, &start, &end); err != nil {
		t.Fatal(err)
	}
	if kind != "book" || !srcBook.Valid || srcBook.Int64 != book || title != "Sample book" || chapter != 0 || paragraph != 0 || start != 0 || end != 2 {
		t.Fatalf("restored source = %s %v %q %d %d %d %d, want book %d", kind, srcBook, title, chapter, paragraph, start, end, book)
	}

	// The export writes it back with the book's id; a sentence without a
	// book (deleted) keeps its title without one.
	if _, err := tg.DB.Exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at,
		source_kind, source_book_id, source_title, source_chapter, source_paragraph, source_start, source_end)
		SELECT entry_id, '', user_id, '再见。', '', '', updated_at, 'book', NULL, 'Gone', 1, 2, 3, 4 FROM sentences
		WHERE user_id = ? AND hanzi = '你好，世界。'`, tg.UID); err != nil {
		t.Fatal(err)
	}
	data, _ := exportBytes(t, tg.baseWorld, tg.UID)
	files := mustUnzip(t, data)
	got := string(files[PartName(NameSentences, 1)])
	for _, want := range []string{
		`"source":{"kind":"book","bookId":` + itoa(int(book)) + `,"title":"Sample book","chapter":0,"paragraph":0,"start":0,"end":2}`,
		`"source":{"kind":"book","bookId":null,"title":"Gone","chapter":1,"paragraph":2,"start":3,"end":4}`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("export lacks %s:\n%s", want, got)
		}
	}
}
