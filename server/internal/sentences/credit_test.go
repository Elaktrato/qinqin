package sentences_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/lang"
	"qinqin/internal/model"
	"qinqin/internal/sentences"
)

const creditPack = `{"entries":[{"word":"你好","sentences":[
 {"id":4706,"hanzi":"你好，世界。","pinyin":"nǐ hǎo, shì jiè.","translation":"Hello, world.","by":"bunbuku","tid":355041,"tby":"CK"},
 {"id":4709,"hanzi":"你好吗？","translation":"How are you?","tid":52115,"tby":"human600"},
 {"hanzi":"你好，再见。","translation":"Hello, goodbye."}]}]}`

// A pack sentence carries who wrote it: the id of its page on Tatoeba and its
// owner, and the same for its translation, each on the sentence itself.
func TestPackSentenceCarriesItsCredit(t *testing.T) {
	lang.Register(lang.Zh{})
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	nihao, _ := seedWords(t, sqlDB)
	if _, err := sentences.ImportPack(ctx, sqlDB, buildPack(t, "mini", creditPack)); err != nil {
		t.Fatal(err)
	}
	list, err := sentences.ForEntry(ctx, sqlDB, nihao, 0)
	if err != nil {
		t.Fatal(err)
	}
	by := map[string]model.Sentence{}
	for _, s := range list {
		by[s.Translation] = s
	}
	c := by["Hello, world."].Credit
	if c == nil || c.Source != "Tatoeba" || c.ID != 4706 || c.Owner != "bunbuku" ||
		c.URL != "https://tatoeba.org/sentences/show/4706" ||
		c.TranslationID != 355041 || c.TranslationOwner != "CK" ||
		c.TranslationURL != "https://tatoeba.org/sentences/show/355041" {
		t.Errorf("credit = %+v", c)
	}
	if c := by["How are you?"].Credit; c == nil || c.Owner != "" || c.URL == "" || c.TranslationOwner != "human600" {
		t.Errorf("an ownerless sentence keeps its link: %+v", c)
	}
	if c := by["Hello, goodbye."].Credit; c != nil {
		t.Errorf("a sentence without an id has no credit: %+v", c)
	}
	b, _ := json.Marshal(by["Hello, goodbye."])
	if strings.Contains(string(b), "credit") {
		t.Errorf("an uncredited sentence serialises no credit key: %s", b)
	}

	// A re-import with a corrected owner updates the row in place.
	fixed := strings.Replace(creditPack, `"by":"bunbuku"`, `"by":"bunbuku2"`, 1)
	if _, err := sentences.ImportPack(ctx, sqlDB, buildPack(t, "mini", fixed)); err != nil {
		t.Fatal(err)
	}
	list, _ = sentences.ForEntry(ctx, sqlDB, nihao, 0)
	if len(list) != 3 {
		t.Fatalf("rows = %d, want 3 (no churn)", len(list))
	}
	for _, s := range list {
		if s.Translation == "Hello, world." && s.Credit.Owner != "bunbuku2" {
			t.Errorf("owner not updated: %+v", s.Credit)
		}
	}
}

// A sentence id without its translation's id is a malformed pack, and so is
// the old shape (credits in a separate map, none on the sentence).
func TestPackCreditsMustBeOnTheSentence(t *testing.T) {
	lang.Register(lang.Zh{})
	sqlDB := dbtest.Open(t)
	seedWords(t, sqlDB)
	for name, bad := range map[string]string{
		"no translation id": `{"entries":[{"word":"你好","sentences":[{"id":7,"hanzi":"你好。","translation":"Hi.","by":"x"}]}]}`,
		"old credits map":   `{"entries":[{"word":"你好","sentences":[{"id":7,"hanzi":"你好。","translation":"Hi."}]}],"credits":{"7":{"by":"x","tid":8,"tby":"y"}}}`,
	} {
		if _, err := sentences.ImportPack(context.Background(), sqlDB, buildPack(t, "mini", bad)); err == nil {
			t.Errorf("%s: a pack without the credit on the sentence was accepted", name)
		}
	}
}
