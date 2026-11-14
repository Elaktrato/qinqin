package library_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"qinqin/internal/library"
)

func hl(chapter, paragraph, start, end int, text string) library.Highlight {
	return library.Highlight{Chapter: chapter, Paragraph: paragraph, Start: start, End: end, Text: text}
}

// span is a highlight whose text has exactly end-start code points.
func span(chapter, paragraph, start, end int) library.Highlight {
	return hl(chapter, paragraph, start, end, strings.Repeat("x", max(end-start, 1)))
}

func TestHighlightsAddListUpdateDelete(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())

	if list, err := f.ListHighlights(ctx, f.a, bk.ID); err != nil || list == nil || len(list) != 0 {
		t.Fatalf("empty list: %v %#v, want an empty slice", err, list)
	}

	in := hl(0, 2, 3, 5, "你好")
	in.Note = "line one\nline two"
	h1, err := f.AddHighlight(ctx, f.a, bk.ID, in)
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if h1.ID == 0 || h1.BookID != bk.ID || h1.Chapter != 0 || h1.Paragraph != 2 || h1.Start != 3 || h1.End != 5 ||
		h1.Text != "你好" || h1.Color != "yellow" || h1.Note != "line one\nline two" ||
		h1.CreatedAt.IsZero() || !h1.UpdatedAt.Equal(h1.CreatedAt) {
		t.Errorf("highlight = %+v", h1)
	}

	g := hl(1, 0, 0, 2, "再见")
	g.Color = "pink"
	h2, err := f.AddHighlight(ctx, f.a, bk.ID, g)
	if err != nil || h2.Color != "pink" {
		t.Fatalf("add pink: %v %+v", err, h2)
	}

	list, err := f.ListHighlights(ctx, f.a, bk.ID)
	if err != nil || len(list) != 2 || list[0] != h1 || list[1] != h2 {
		t.Fatalf("list: %v %+v", err, list)
	}

	// Only the colour changes; the note stays.
	blue := "blue"
	up, err := f.UpdateHighlight(ctx, f.a, bk.ID, h1.ID, &blue, nil)
	if err != nil || up.Color != "blue" || up.Note != h1.Note || up.Text != h1.Text || up.Start != 3 || up.ID != h1.ID {
		t.Errorf("update colour: %v %+v", err, up)
	}
	// Only the note changes; an empty note clears it.
	empty := ""
	up, err = f.UpdateHighlight(ctx, f.a, bk.ID, h1.ID, nil, &empty)
	if err != nil || up.Color != "blue" || up.Note != "" {
		t.Errorf("clear note: %v %+v", err, up)
	}
	note := "注释"
	green := "green"
	up, err = f.UpdateHighlight(ctx, f.a, bk.ID, h1.ID, &green, &note)
	if err != nil || up.Color != "green" || up.Note != "注释" || up.CreatedAt != h1.CreatedAt {
		t.Errorf("update both: %v %+v", err, up)
	}
	if up.UpdatedAt.Before(h1.UpdatedAt) {
		t.Errorf("updatedAt went back: %v < %v", up.UpdatedAt, h1.UpdatedAt)
	}
	// Neither field: the highlight is returned unchanged.
	same, err := f.UpdateHighlight(ctx, f.a, bk.ID, h1.ID, nil, nil)
	if err != nil || same.Color != "green" || same.Note != "注释" {
		t.Errorf("update nothing: %v %+v", err, same)
	}

	if err := f.DeleteHighlight(ctx, f.a, bk.ID, h1.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.DeleteHighlight(ctx, f.a, bk.ID, h1.ID); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("second delete: %v, want ErrNotFound", err)
	}
	if _, err := f.UpdateHighlight(ctx, f.a, bk.ID, h1.ID, &blue, nil); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("update deleted: %v, want ErrNotFound", err)
	}
	if list, _ := f.ListHighlights(ctx, f.a, bk.ID); len(list) != 1 || list[0].ID != h2.ID {
		t.Errorf("after delete: %+v", list)
	}
}

func TestHighlightsOrdering(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())
	for _, h := range []library.Highlight{
		hl(1, 0, 4, 5, "e"),
		hl(0, 3, 0, 1, "c"),
		hl(0, 1, 9, 10, "b"),
		hl(1, 0, 0, 1, "d"),
		hl(0, 1, 2, 3, "a"),
	} {
		if _, err := f.AddHighlight(ctx, f.a, bk.ID, h); err != nil {
			t.Fatalf("add %+v: %v", h, err)
		}
	}
	list, err := f.ListHighlights(ctx, f.a, bk.ID)
	if err != nil {
		t.Fatal(err)
	}
	var got string
	for _, h := range list {
		got += h.Text
	}
	if got != "abcde" {
		t.Errorf("order = %q, want abcde (chapter, paragraph, start)", got)
	}
}

func TestHighlightOverlap(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())
	first, err := f.AddHighlight(ctx, f.a, bk.ID, span(0, 1, 10, 20))
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range [][2]int{{5, 11}, {19, 25}, {12, 15}, {0, 30}, {10, 20}, {10, 11}, {19, 20}} {
		_, err := f.AddHighlight(ctx, f.a, bk.ID, span(0, 1, r[0], r[1]))
		if !errors.Is(err, library.ErrOverlap) {
			t.Errorf("%v: %v, want ErrOverlap", r, err)
			continue
		}
		var oe *library.OverlapError
		if !errors.As(err, &oe) || oe.ExistingID != first.ID {
			t.Errorf("%v: %v, want the existing id %d", r, err, first.ID)
		}
	}
	// Adjacent ranges touch but do not overlap.
	for _, r := range [][2]int{{5, 10}, {20, 25}} {
		if _, err := f.AddHighlight(ctx, f.a, bk.ID, span(0, 1, r[0], r[1])); err != nil {
			t.Errorf("adjacent %v: %v", r, err)
		}
	}
	// The same range in another paragraph, chapter or book is fine.
	other, _ := f.Create(ctx, book(f.a, f.wa, "h2"), chapters())
	for _, tc := range []struct {
		bookID int64
		h      library.Highlight
	}{
		{bk.ID, span(0, 2, 10, 20)},
		{bk.ID, span(1, 1, 10, 20)},
		{other.ID, span(0, 1, 10, 20)},
	} {
		if _, err := f.AddHighlight(ctx, f.a, tc.bookID, tc.h); err != nil {
			t.Errorf("elsewhere %+v: %v", tc.h, err)
		}
	}
	// A deleted highlight frees its range.
	if err := f.DeleteHighlight(ctx, f.a, bk.ID, first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.AddHighlight(ctx, f.a, bk.ID, span(0, 1, 12, 15)); err != nil {
		t.Errorf("after delete: %v", err)
	}
}

func TestHighlightConcurrentOverlap(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())
	var wg sync.WaitGroup
	errs := make([]error, 8)
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = f.AddHighlight(ctx, f.a, bk.ID, span(0, 0, i, i+5))
		}()
	}
	wg.Wait()
	ok := 0
	for i, err := range errs {
		if err == nil {
			ok++
		} else if !errors.Is(err, library.ErrOverlap) {
			t.Errorf("add %d: %v", i, err)
		}
	}
	list, _ := f.ListHighlights(ctx, f.a, bk.ID)
	if len(list) != ok || ok == 0 {
		t.Fatalf("stored %d, succeeded %d", len(list), ok)
	}
	for i := 1; i < len(list); i++ {
		if list[i].Start < list[i-1].End {
			t.Errorf("stored overlap: %+v and %+v", list[i-1], list[i])
		}
	}
}

func TestHighlightValidation(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters()) // two chapters

	withColor := func(c string) library.Highlight { h := span(0, 0, 0, 1); h.Color = c; return h }
	withNote := func(n string) library.Highlight { h := span(0, 0, 0, 1); h.Note = n; return h }
	for name, tc := range map[string]struct {
		h    library.Highlight
		want error
	}{
		"chapter beyond count": {span(2, 0, 0, 1), library.ErrHighlightRange},
		"negative chapter":     {span(-1, 0, 0, 1), library.ErrHighlightRange},
		"negative paragraph":   {span(0, -1, 0, 1), library.ErrHighlightRange},
		"negative start":       {span(0, 0, -1, 1), library.ErrHighlightRange},
		"empty range":          {span(0, 0, 3, 3), library.ErrHighlightRange},
		"reversed range":       {span(0, 0, 4, 3), library.ErrHighlightRange},
		"end beyond max":       {span(0, 0, 0, library.MaxHighlightOffset+1), library.ErrHighlightRange},
		"unknown colour":       {withColor("red"), library.ErrHighlightColor},
		"colour case":          {withColor("Yellow"), library.ErrHighlightColor},
		"empty text":           {hl(0, 0, 0, 1, ""), library.ErrHighlightText},
		"blank text":           {hl(0, 0, 0, 4, " \n\t "), library.ErrHighlightText},
		"501-rune text":        {hl(0, 0, 0, 501, strings.Repeat("字", 501)), library.ErrHighlightText},
		"leading space":        {hl(0, 0, 0, 2, " x"), library.ErrHighlightText},
		"trailing newline":     {hl(0, 0, 0, 2, "x\n"), library.ErrHighlightText},
		"ideographic space":    {hl(0, 0, 0, 2, "\u3000字"), library.ErrHighlightText},
		"text shorter":         {hl(0, 0, 0, 3, "你好"), library.ErrHighlightText},
		"text longer":          {hl(0, 0, 0, 1, "你好"), library.ErrHighlightText},
		"UTF-16 offsets":       {hl(0, 0, 0, 2, "😀"), library.ErrHighlightText},
		"2001-rune note":       {withNote(strings.Repeat("字", 2001)), library.ErrNoteTooLong},
	} {
		if _, err := f.AddHighlight(ctx, f.a, bk.ID, tc.h); !errors.Is(err, tc.want) {
			t.Errorf("%s: %v, want %v", name, err, tc.want)
		}
	}
	if l, _ := f.ListHighlights(ctx, f.a, bk.ID); len(l) != 0 {
		t.Errorf("rejected adds stored %+v", l)
	}

	// The limits count code points, not bytes or UTF-16 units; inner
	// whitespace is kept and the text is stored exactly.
	for i, h := range []library.Highlight{
		hl(1, 0, library.MaxHighlightOffset-500, library.MaxHighlightOffset, strings.Repeat("字", 500)),
		hl(1, 0, 0, 3, "😀 𠀋"),
		withNote(strings.Repeat("😀", 2000)),
		withColor("green"),
	} {
		h.Paragraph = i
		got, err := f.AddHighlight(ctx, f.a, bk.ID, h)
		if err != nil {
			t.Errorf("at the limits %d: %v", i, err)
		} else if got.Text != h.Text {
			t.Errorf("text %q stored as %q", h.Text, got.Text)
		}
	}

	h, _ := f.AddHighlight(ctx, f.a, bk.ID, span(0, 9, 0, 1))
	red, long := "red", strings.Repeat("a", 2001)
	if _, err := f.UpdateHighlight(ctx, f.a, bk.ID, h.ID, &red, nil); !errors.Is(err, library.ErrHighlightColor) {
		t.Errorf("update red: %v", err)
	}
	empty := ""
	if _, err := f.UpdateHighlight(ctx, f.a, bk.ID, h.ID, &empty, nil); !errors.Is(err, library.ErrHighlightColor) {
		t.Errorf("update empty colour: %v", err)
	}
	if _, err := f.UpdateHighlight(ctx, f.a, bk.ID, h.ID, nil, &long); !errors.Is(err, library.ErrNoteTooLong) {
		t.Errorf("update long note: %v", err)
	}
	if got, _ := f.ListHighlights(ctx, f.a, bk.ID); got[len(got)-1].Color != "yellow" || got[len(got)-1].Note != "" {
		t.Errorf("rejected updates changed %+v", got[len(got)-1])
	}
}

func TestHighlightLimit(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())
	other, _ := f.Create(ctx, book(f.a, f.wa, "h2"), chapters())
	fillHighlights(t, f, bk.ID, library.MaxHighlights)
	if _, err := f.AddHighlight(ctx, f.a, bk.ID, span(1, 0, 0, 1)); !errors.Is(err, library.ErrTooMany) {
		t.Errorf("highlight %d: %v, want ErrTooMany", library.MaxHighlights+1, err)
	}
	// An overlap at the cap still reports the overlap.
	if _, err := f.AddHighlight(ctx, f.a, bk.ID, span(0, 0, 0, 1)); !errors.Is(err, library.ErrOverlap) {
		t.Errorf("overlap at the cap: %v, want ErrOverlap", err)
	}
	// The cap is per book.
	if _, err := f.AddHighlight(ctx, f.a, other.ID, span(0, 0, 0, 1)); err != nil {
		t.Errorf("other book: %v", err)
	}
	if l, err := f.ListHighlights(ctx, f.a, bk.ID); err != nil || len(l) != library.MaxHighlights {
		t.Errorf("highlights = %d, want %d", len(l), library.MaxHighlights)
	}
}

// fillHighlights inserts n highlights directly (chapter 0, paragraph i).
func fillHighlights(t *testing.T, f fixture, bookID int64, n int) {
	t.Helper()
	tx, err := f.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for i := range n {
		if _, err := tx.Exec(`INSERT INTO library_highlights
			(user_id, book_id, chapter, paragraph, start_cp, end_cp, text, color, note, created_at, updated_at)
			VALUES (?, ?, 0, ?, 0, 1, 'x', 'yellow', '', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`, f.a, bookID, i); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestHighlightsOtherUser(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())
	h, _ := f.AddHighlight(ctx, f.a, bk.ID, hl(0, 0, 0, 6, "secret"))
	bobs, _ := f.Create(ctx, book(f.b, f.wb, "h1"), chapters())
	blue := "blue"

	if _, err := f.ListHighlights(ctx, f.b, bk.ID); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("list: %v", err)
	}
	if _, err := f.AddHighlight(ctx, f.b, bk.ID, span(0, 0, 5, 6)); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("add: %v", err)
	}
	// Over alice's range: 404, not her highlight's id.
	if _, err := f.AddHighlight(ctx, f.b, bk.ID, span(0, 0, 0, 2)); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("add over alice's: %v", err)
	}
	// Beyond the chapter count of alice's book: still 404.
	if _, err := f.AddHighlight(ctx, f.b, bk.ID, span(5, 0, 0, 2)); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("add beyond chapters: %v", err)
	}
	if _, err := f.UpdateHighlight(ctx, f.b, bk.ID, h.ID, &blue, nil); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("update: %v", err)
	}
	if err := f.DeleteHighlight(ctx, f.b, bk.ID, h.ID); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("delete: %v", err)
	}
	// Bob's own book with alice's highlight id.
	if _, err := f.UpdateHighlight(ctx, f.b, bobs.ID, h.ID, &blue, nil); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("update via own book: %v", err)
	}
	if err := f.DeleteHighlight(ctx, f.b, bobs.ID, h.ID); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("delete via own book: %v", err)
	}
	// Alice through another of her books.
	mine2, _ := f.Create(ctx, book(f.a, f.wa, "h2"), chapters())
	if _, err := f.UpdateHighlight(ctx, f.a, mine2.ID, h.ID, &blue, nil); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("update via another book: %v", err)
	}
	if err := f.DeleteHighlight(ctx, f.a, mine2.ID, h.ID); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("delete via another book: %v", err)
	}
	if l, _ := f.ListHighlights(ctx, f.a, bk.ID); len(l) != 1 || l[0] != h {
		t.Errorf("alice's highlights = %+v, want hers intact", l)
	}
	if _, err := f.AddHighlight(ctx, f.a, 999, span(0, 0, 0, 1)); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("unknown book: %v", err)
	}
}

func TestDeleteBookDeletesHighlights(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())
	keep, _ := f.Create(ctx, book(f.a, f.wa, "h2"), chapters())
	f.AddHighlight(ctx, f.a, bk.ID, span(0, 0, 0, 1))
	f.AddHighlight(ctx, f.a, bk.ID, hl(1, 0, 0, 1, "y"))
	f.AddBookmark(ctx, f.a, bk.ID, "0:1", "")
	kept, _ := f.AddHighlight(ctx, f.a, keep.ID, hl(0, 0, 0, 1, "z"))

	if err := f.Delete(ctx, f.b, bk.ID); !errors.Is(err, library.ErrNotFound) {
		t.Errorf("bob delete: %v", err)
	}
	var n int
	f.DB.QueryRow(`SELECT COUNT(*) FROM library_highlights WHERE book_id = ?`, bk.ID).Scan(&n)
	if n != 2 {
		t.Errorf("after bob's delete: %d highlights, want 2", n)
	}
	if err := f.Delete(ctx, f.a, bk.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.DB.QueryRow(`SELECT COUNT(*) FROM library_highlights WHERE book_id = ?`, bk.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("%d highlights survive their book", n)
	}
	if l, _ := f.ListHighlights(ctx, f.a, keep.ID); len(l) != 1 || l[0].ID != kept.ID {
		t.Errorf("other book's highlights = %+v", l)
	}
}

func TestHighlightNotesAreCleaned(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	bk, _ := f.Create(ctx, book(f.a, f.wa, "h1"), chapters())
	r := func(c rune) string { return string(c) }
	for i, tc := range []struct{ in, want string }{
		{"line one\r\nline two\rthree", "line one\nline two\nthree"},     // CR LF and CR become LF
		{"  keep\tinner   spacing\n\n ", "  keep\tinner   spacing\n\n "}, // whitespace is not collapsed
		{"a" + r(0x202e) + "b" + r(0x202c) + "c", "abc"},                 // bidi embeddings and overrides go
		{r(0x202a) + r(0x202b) + r(0x202d) + "x" + r(0x2066) + r(0x2067) + r(0x2068) + "y" + r(0x2069), "xy"},
		{"a\x00b\x1fc\x7fd" + r(0x85) + "e", "abcde"}, // other control characters go
		{"a" + r(0xad) + "b" + r(0x200c) + "c" + r(0x200d) + "d", "a" + r(0xad) + "b" + r(0x200c) + "c" + r(0x200d) + "d"},
		{"<b>not html</b> & 😀", "<b>not html</b> & 😀"},
	} {
		h := span(0, i, 0, 1)
		h.Note = tc.in
		got, err := f.AddHighlight(ctx, f.a, bk.ID, h)
		if err != nil || got.Note != tc.want {
			t.Errorf("add note %q: %v %q, want %q", tc.in, err, got.Note, tc.want)
			continue
		}
		up, err := f.UpdateHighlight(ctx, f.a, bk.ID, got.ID, nil, &tc.in)
		if err != nil || up.Note != tc.want {
			t.Errorf("update note %q: %v %q, want %q", tc.in, err, up.Note, tc.want)
		}
	}
	// The limit counts the cleaned note.
	h := span(1, 0, 0, 1)
	h.Note = strings.Repeat("字", 2000) + strings.Repeat(r(0x202e), 10)
	if _, err := f.AddHighlight(ctx, f.a, bk.ID, h); err != nil {
		t.Errorf("2000 characters plus controls: %v", err)
	}
	// The snapshot is never cleaned: it must equal the book's text.
	soft := "a" + r(0xad) + "b"
	if got, err := f.AddHighlight(ctx, f.a, bk.ID, hl(1, 1, 0, 3, soft)); err != nil || got.Text != soft {
		t.Errorf("snapshot with a soft hyphen: %v %q", err, got.Text)
	}
}
