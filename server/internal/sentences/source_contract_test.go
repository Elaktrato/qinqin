package sentences_test

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"

	"qinqin/internal/model"
	"qinqin/internal/sentences"
)

// sourceFixture is docs/contracts/reader/sentence-sources.json (#280): the
// Go side checks the request rule, the fill rule on the same text and what
// a book delete leaves.
type sourceFixture struct {
	Limits struct {
		MaxParagraph int `json:"maxParagraph"`
		MaxOffset    int `json:"maxOffset"`
	} `json:"limits"`
	Check []struct {
		Name          string `json:"name"`
		EntryLanguage string `json:"entryLanguage"`
		Book          *struct {
			Owner        string `json:"owner"`
			Language     string `json:"language"`
			ChapterCount int    `json:"chapterCount"`
		} `json:"book"`
		Source sentences.SourceRequest `json:"source"`
		Want   string                  `json:"want"`
	} `json:"check"`
	Merge []struct {
		Name     string `json:"name"`
		Existing *struct {
			Own    bool                     `json:"own"`
			Source *sentences.SourceRequest `json:"source"`
		} `json:"existing"`
		Source *sentences.SourceRequest `json:"source"`
		Want   *model.SentenceSource    `json:"want"`
	} `json:"merge"`
	Detach []struct {
		Name      string  `json:"name"`
		Deleted   []int64 `json:"deleted"`
		Sentences []struct {
			ID     int64                 `json:"id"`
			Source *model.SentenceSource `json:"source"`
		} `json:"sentences"`
		Want []struct {
			ID     int64                 `json:"id"`
			Source *model.SentenceSource `json:"source"`
			Moved  bool                  `json:"moved"`
		} `json:"want"`
	} `json:"detach"`
}

func loadSourceFixture(t *testing.T) sourceFixture {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/reader/sentence-sources.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx sourceFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(fx.Check) == 0 || len(fx.Merge) == 0 || len(fx.Detach) == 0 {
		t.Fatal("the fixture lost its cases")
	}
	return fx
}

func TestSentenceSourceLimitsContract(t *testing.T) {
	fx := loadSourceFixture(t)
	if fx.Limits.MaxParagraph != sentences.MaxSourceParagraph || fx.Limits.MaxOffset != sentences.MaxSourceOffset {
		t.Fatalf("limits %+v, Go has %d and %d", fx.Limits, sentences.MaxSourceParagraph, sentences.MaxSourceOffset)
	}
}

func TestSentenceSourceCheckContract(t *testing.T) {
	fx := loadSourceFixture(t)
	for _, c := range fx.Check {
		var book *sentences.SourceBook
		// Another user's book is not found for the caller: the handler passes nil.
		if c.Book != nil && c.Book.Owner == "caller" {
			book = &sentences.SourceBook{Language: c.Book.Language, ChapterCount: c.Book.ChapterCount, Title: "T"}
		}
		err := sentences.CheckSource(c.Source, book, c.EntryLanguage)
		got := "ok"
		if errors.Is(err, sentences.ErrBadSource) {
			got = "invalid"
		} else if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		if got != c.Want {
			t.Errorf("%s: CheckSource = %v, want %s", c.Name, err, c.Want)
		}
	}
}

// bookTitles are the fixture's books.
var bookTitles = map[int64]string{5: "Book five", 6: "Book six"}

func TestSentenceSourceMergeContract(t *testing.T) {
	fx := loadSourceFixture(t)
	for _, c := range fx.Merge {
		t.Run(c.Name, func(t *testing.T) {
			e := newExamplesEnv(t)
			var id int64
			switch {
			case c.Existing == nil:
				s := sentencesModel("书上的句子。")
				if c.Source != nil {
					src := sentences.BookSource(*c.Source, bookTitles[c.Source.BookID])
					s.Source = &src
				}
				var err error
				if id, err = sentences.AddUser(e.ctx, e.db, e.alice, e.xuexi, s); err != nil {
					t.Fatal(err)
				}
			case c.Existing.Own:
				s := sentencesModel("书上的句子。")
				if c.Existing.Source != nil {
					src := sentences.BookSource(*c.Existing.Source, bookTitles[c.Existing.Source.BookID])
					s.Source = &src
				}
				var err error
				if id, err = sentences.AddUser(e.ctx, e.db, e.alice, e.xuexi, s); err != nil {
					t.Fatal(err)
				}
			default:
				if err := e.db.QueryRow(`SELECT id FROM sentences WHERE source_pack = 'zh-pack'`).Scan(&id); err != nil {
					t.Fatal(err)
				}
			}
			const old = "2020-01-01T00:00:00Z"
			if _, err := e.db.Exec(`UPDATE sentences SET updated_at = ? WHERE id = ?`, old, id); err != nil {
				t.Fatal(err)
			}
			adopted := false
			if c.Existing != nil && c.Source != nil {
				var err error
				adopted, err = sentences.AdoptSource(e.ctx, e.db, e.alice, id, sentences.BookSource(*c.Source, bookTitles[c.Source.BookID]))
				if err != nil {
					t.Fatal(err)
				}
			}
			got, err := sentences.Get(e.ctx, e.db, id, e.alice)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got.Source, c.Want) {
				t.Fatalf("source = %+v, want %+v", got.Source, c.Want)
			}
			wantAdopted := c.Existing != nil && c.Existing.Own && c.Existing.Source == nil && c.Source != nil
			if adopted != wantAdopted {
				t.Fatalf("adopted = %v, want %v", adopted, wantAdopted)
			}
			if moved := stampOf(t, e, id) != old; moved != wantAdopted {
				t.Fatalf("updated_at moved = %v, want %v (the pull ships an adopted source)", moved, wantAdopted)
			}
		})
	}
}

func stampOf(t *testing.T, e examplesEnv, id int64) string {
	t.Helper()
	var s string
	if err := e.db.QueryRow(`SELECT updated_at FROM sentences WHERE id = ?`, id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSentenceSourceDetachContract(t *testing.T) {
	fx := loadSourceFixture(t)
	for _, c := range fx.Detach {
		t.Run(c.Name, func(t *testing.T) {
			e := newExamplesEnv(t)
			ids := map[int64]int64{} // fixture id -> row id
			for _, s := range c.Sentences {
				m := sentencesModel("句子" + string(rune('A'+s.ID)) + "。")
				m.Source = s.Source
				id, err := sentences.AddUser(e.ctx, e.db, e.alice, e.xuexi, m)
				if err != nil {
					t.Fatal(err)
				}
				ids[s.ID] = id
			}
			// Bob's sentence on the same book id is never touched by Alice's delete.
			bobSrc := sentences.BookSource(sentences.SourceRequest{BookID: 5, Chapter: 0, Paragraph: 0, Start: 0, End: 1}, "Bob's")
			bobs, err := sentences.AddUser(e.ctx, e.db, e.bob, e.xuexi, model.Sentence{Hanzi: "鲍勃。", Source: &bobSrc})
			if err != nil {
				t.Fatal(err)
			}
			const old = "2020-01-01T00:00:00Z"
			if _, err := e.db.Exec(`UPDATE sentences SET updated_at = ?`, old); err != nil {
				t.Fatal(err)
			}
			tx, err := e.db.BeginTx(e.ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			if err := sentences.DetachBooks(e.ctx, tx, e.alice, c.Deleted); err != nil {
				t.Fatal(err)
			}
			if err := tx.Commit(); err != nil {
				t.Fatal(err)
			}
			for _, w := range c.Want {
				got, err := sentences.Get(e.ctx, e.db, ids[w.ID], e.alice)
				if err != nil {
					t.Fatal(err)
				}
				if !reflect.DeepEqual(got.Source, w.Source) {
					t.Errorf("sentence %d: source = %+v, want %+v", w.ID, got.Source, w.Source)
				}
				if moved := stampOf(t, e, ids[w.ID]) != old; moved != w.Moved {
					t.Errorf("sentence %d: updated_at moved = %v, want %v", w.ID, moved, w.Moved)
				}
			}
			b, err := sentences.Get(e.ctx, e.db, bobs, e.bob)
			if err != nil {
				t.Fatal(err)
			}
			if b.Source == nil || b.Source.BookID == nil || *b.Source.BookID != 5 || stampOf(t, e, bobs) != old {
				t.Fatalf("another user's sentence changed: %+v", b.Source)
			}
		})
	}
}
