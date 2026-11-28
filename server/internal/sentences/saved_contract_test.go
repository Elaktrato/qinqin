package sentences_test

import (
	"encoding/json"
	"errors"
	"os"
	"testing"
	"unicode/utf8"

	"qinqin/internal/model"
	"qinqin/internal/sentences"
)

// savedFixture is docs/contracts/reader/saved-sentences.json (#279): the Go
// side checks the normalise and same-text rules and who may remove what.
type savedFixture struct {
	Whitespace []string `json:"whitespace"`
	Normalize  []struct {
		Name string `json:"name"`
		Text string `json:"text"`
		Want string `json:"want"`
	} `json:"normalize"`
	Same []struct {
		Name      string `json:"name"`
		Sentences []struct {
			ID    int64  `json:"id"`
			Hanzi string `json:"hanzi"`
		} `json:"sentences"`
		Text string `json:"text"`
		Want *int64 `json:"want"`
	} `json:"same"`
	Remove []struct {
		Name     string `json:"name"`
		Sentence string `json:"sentence"`
		Caller   string `json:"caller"`
		Reason   string `json:"reason"`
		Want     int    `json:"want"`
	} `json:"remove"`
}

func loadSavedFixture(t *testing.T) savedFixture {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/reader/saved-sentences.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx savedFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(fx.Normalize) == 0 || len(fx.Same) == 0 || len(fx.Remove) == 0 {
		t.Fatal("the fixture lost its cases")
	}
	return fx
}

func TestSavedSentencesNormalizeContract(t *testing.T) {
	fx := loadSavedFixture(t)
	for _, c := range fx.Normalize {
		if got := sentences.NormalizeText(c.Text); got != c.Want {
			t.Errorf("%s: NormalizeText(%q) = %q, want %q", c.Name, c.Text, got, c.Want)
		}
	}
	// Each listed character alone is whitespace; the list is the whole set.
	for _, ws := range fx.Whitespace {
		r, _ := utf8.DecodeRuneInString(ws)
		if got := sentences.NormalizeText("a" + ws + "b"); got != "a b" {
			t.Errorf("U+%04X is whitespace: got %q", r, got)
		}
	}
	listed := map[rune]bool{}
	for _, ws := range fx.Whitespace {
		r, _ := utf8.DecodeRuneInString(ws)
		listed[r] = true
	}
	for r := rune(0); r <= 0xFFFF; r++ {
		if listed[r] || (r >= 0xD800 && r <= 0xDFFF) {
			continue
		}
		if got := sentences.NormalizeText("a" + string(r) + "b"); got != "a"+string(r)+"b" {
			t.Fatalf("U+%04X is not in the fixture's whitespace but NormalizeText folds it", r)
		}
	}
}

func TestSavedSentencesSameContract(t *testing.T) {
	fx := loadSavedFixture(t)
	for _, c := range fx.Same {
		list := make([]model.Sentence, 0, len(c.Sentences))
		for _, s := range c.Sentences {
			list = append(list, model.Sentence{ID: s.ID, Hanzi: s.Hanzi})
		}
		got, ok := sentences.SameText(list, c.Text)
		switch {
		case c.Want == nil && ok:
			t.Errorf("%s: matched %d, want none", c.Name, got.ID)
		case c.Want != nil && (!ok || got.ID != *c.Want):
			t.Errorf("%s: got %d (%v), want %d", c.Name, got.ID, ok, *c.Want)
		}
	}
}

func TestSavedSentencesRemoveContract(t *testing.T) {
	fx := loadSavedFixture(t)
	for _, c := range fx.Remove {
		t.Run(c.Name, func(t *testing.T) {
			e := newExamplesEnv(t)
			var id int64
			switch c.Sentence {
			case "own":
				var err error
				if id, err = sentences.AddUser(e.ctx, e.db, e.alice, e.xuexi, sentencesModel("书上的句子。")); err != nil {
					t.Fatal(err)
				}
			case "ai":
				d := gen(t, e, e.alice, e.xuexi, "r1", "beginner", "我喜欢学习。")
				s, err := sentences.KeepDraft(e.ctx, e.db, e.alice, e.xuexi, d[0].ID)
				if err != nil {
					t.Fatal(err)
				}
				id = s.ID
			case "pack":
				if err := e.db.QueryRow(`SELECT id FROM sentences WHERE source_pack = 'zh-pack'`).Scan(&id); err != nil {
					t.Fatal(err)
				}
			default:
				t.Fatalf("unknown sentence %q", c.Sentence)
			}
			caller := e.alice
			if c.Caller == "other" {
				caller = e.bob
			}
			err := sentences.DeleteOwn(e.ctx, e.db, caller, e.xuexi, id, c.Reason)
			got := 204
			switch {
			case err == nil:
			case errors.Is(err, sentences.ErrSentenceNotFound):
				got = 404
			case errors.Is(err, sentences.ErrBadReason), errors.Is(err, sentences.ErrNotReportable):
				got = 400
			default:
				t.Fatal(err)
			}
			if got != c.Want {
				t.Fatalf("DeleteOwn = %v (%d), want %d", err, got, c.Want)
			}
			var deleted *string
			if err := e.db.QueryRow(`SELECT deleted_at FROM sentences WHERE id = ?`, id).Scan(&deleted); err != nil {
				t.Fatal(err)
			}
			if (deleted != nil) != (c.Want == 204) {
				t.Fatalf("tombstoned = %v, want %v", deleted != nil, c.Want == 204)
			}
		})
	}
}

// FindSame reads the sentences the caller sees on the entry (pack and own,
// never another user's) and answers the first with the same text.
func TestFindSameSeesWhatTheCallerSees(t *testing.T) {
	e := newExamplesEnv(t)
	bobs, err := sentences.AddUser(e.ctx, e.db, e.bob, e.xuexi, sentencesModel("他在学习。"))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := sentences.FindSame(e.ctx, e.db, e.xuexi, e.alice, "他在学习。"); err != nil || ok {
		t.Fatalf("alice sees bob's sentence: %v %v", ok, err)
	}
	if s, ok, err := sentences.FindSame(e.ctx, e.db, e.xuexi, e.bob, " 他在学习。\n"); err != nil || !ok || s.ID != bobs {
		t.Fatalf("bob's own: %+v %v %v", s, ok, err)
	}
	if s, ok, err := sentences.FindSame(e.ctx, e.db, e.xuexi, e.alice, "我在学习。"); err != nil || !ok || s.SourcePack != "zh-pack" {
		t.Fatalf("the pack sentence: %+v %v %v", s, ok, err)
	}
	if err := sentences.DeleteOwn(e.ctx, e.db, e.bob, e.xuexi, bobs, ""); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := sentences.FindSame(e.ctx, e.db, e.xuexi, e.bob, "他在学习。"); err != nil || ok {
		t.Fatalf("a removed sentence is not the same any more: %v %v", ok, err)
	}
}
