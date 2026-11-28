package api_test

import (
	"context"
	"net/http"
	"strconv"
	"testing"

	"qinqin/internal/lang"
	"qinqin/internal/model"
	"qinqin/internal/pack"
	"qinqin/internal/sentences"
)

// TestSentenceSourceRoutes: POST /api/entries/{id}/sentences with a source
// (#280, docs/contracts/reader/sentence-sources.json) stores the book's title
// and the place; another user's book, another language and a place the book
// does not have are 422; the same text adopts a source; the source is the
// owner's alone; a deleted book leaves the title without the book.
func TestSentenceSourceRoutes(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	importSchemeCedict(t, sqlDB)
	nihao := lexID(t, sqlDB, "zh", "word", "你好")
	pk, err := pack.LoadPack(sentencesFixture)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := sentences.ImportPack(context.Background(), sqlDB, pk); err != nil {
		t.Fatal(err)
	}
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	upload := func(token, language string) int64 {
		t.Helper()
		ws := newWorkspace(t, ts.URL, token, language, "")
		var b libBook
		decodeJSON(t, uploadBook(t, ts.URL, token, tinyEpub(t, language), "", ws), &b)
		if b.ID == 0 {
			t.Fatal("upload failed")
		}
		return b.ID
	}
	aliceBook, bobBook, aliceJa := upload(alice, "zh"), upload(bob, "zh"), upload(alice, "ja")
	path := "/api/entries/" + strconv.FormatInt(nihao, 10) + "/sentences"
	post := func(token string, body map[string]any) (int, model.Sentence) {
		t.Helper()
		resp := doJSON(t, http.MethodPost, ts.URL, path, token, body)
		var got model.Sentence
		if resp.StatusCode < 300 {
			decodeJSON(t, resp, &got)
		} else {
			resp.Body.Close()
		}
		return resp.StatusCode, got
	}
	src := func(book int64, chapter int) map[string]any {
		return map[string]any{"bookId": book, "chapter": chapter, "paragraph": 3, "start": 4, "end": 6}
	}

	code, s := post(alice, map[string]any{"hanzi": "他说你好。", "source": src(aliceBook, 1)})
	if code != http.StatusCreated || s.Source == nil || s.Source.Kind != "book" || s.Source.BookID == nil ||
		*s.Source.BookID != aliceBook || s.Source.Title != "Tiny" || s.Source.Chapter != 1 ||
		s.Source.Paragraph != 3 || s.Source.Start != 4 || s.Source.End != 6 {
		t.Fatalf("POST with a source = %d %+v", code, s.Source)
	}
	for name, body := range map[string]map[string]any{
		"another user's book":        {"hanzi": "新的。", "source": src(bobBook, 0)},
		"a book of another language": {"hanzi": "新的。", "source": src(aliceJa, 0)},
		"a chapter it does not have": {"hanzi": "新的。", "source": src(aliceBook, 2)},
		"no such book":               {"hanzi": "新的。", "source": src(999999, 0)},
		"an empty range":             {"hanzi": "新的。", "source": map[string]any{"bookId": aliceBook, "chapter": 0, "paragraph": 0, "start": 2, "end": 2}},
	} {
		if code, _ := post(alice, body); code != http.StatusUnprocessableEntity {
			t.Errorf("%s: POST = %d, want 422", name, code)
		}
	}
	if code, _ := post("", map[string]any{"hanzi": "新的。", "source": src(aliceBook, 0)}); code != http.StatusUnauthorized {
		t.Errorf("no session = %d, want 401", code)
	}

	// The same text: a sourceless own sentence takes the source, a sourced one keeps its own.
	code, plain := post(alice, map[string]any{"hanzi": "你好，老师。"})
	if code != http.StatusCreated || plain.Source != nil {
		t.Fatalf("a sentence without a source = %d %+v", code, plain.Source)
	}
	if code, again := post(alice, map[string]any{"hanzi": "你好，老师。", "source": src(aliceBook, 0)}); code != http.StatusOK ||
		again.ID != plain.ID || again.Source == nil || again.Source.Chapter != 0 {
		t.Fatalf("the same text with a source = %d %+v", code, again.Source)
	}
	if code, kept := post(alice, map[string]any{"hanzi": "他说你好。", "source": src(aliceBook, 0)}); code != http.StatusOK ||
		kept.ID != s.ID || kept.Source == nil || kept.Source.Chapter != 1 {
		t.Fatalf("a sourced sentence keeps its source: %d %+v", code, kept.Source)
	}
	// A pack sentence's text is answered as it is, without a source.
	if code, packed := post(alice, map[string]any{"hanzi": "你好吗？", "source": src(aliceBook, 0)}); code != http.StatusOK || packed.Source != nil {
		t.Fatalf("a pack sentence = %d %+v", code, packed.Source)
	}

	// Only the owner sees the sentence and its source.
	for _, got := range getEntryBodyAs(t, ts.URL, nihao, bob).Sentences {
		if got.Source != nil || got.ID == s.ID {
			t.Fatalf("bob sees alice's sentence or a source: %+v", got)
		}
	}
	sourceOf := func(id int64) *model.SentenceSource {
		for _, got := range getEntryBodyAs(t, ts.URL, nihao, alice).Sentences {
			if got.ID == id {
				return got.Source
			}
		}
		t.Fatalf("sentence %d is gone", id)
		return nil
	}
	if got := sourceOf(s.ID); got == nil || got.BookID == nil || *got.BookID != aliceBook {
		t.Fatalf("GET entry source = %+v", got)
	}

	// The book is deleted: the sentence keeps its title and place, without the book.
	if r := doJSON(t, http.MethodDelete, ts.URL, "/api/library/books/"+strconv.FormatInt(aliceBook, 10), alice, nil); r.StatusCode != http.StatusNoContent {
		t.Fatalf("delete book = %d", r.StatusCode)
	}
	if got := sourceOf(s.ID); got == nil || got.BookID != nil || got.Title != "Tiny" || got.Chapter != 1 || got.Start != 4 {
		t.Fatalf("after the delete: %+v", got)
	}
	if code, _ := post(alice, map[string]any{"hanzi": "新的。", "source": src(aliceBook, 0)}); code != http.StatusUnprocessableEntity {
		t.Errorf("a deleted book as source = %d, want 422", code)
	}
}
