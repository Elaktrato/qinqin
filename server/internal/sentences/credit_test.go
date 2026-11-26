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
 {"id":4706,"hanzi":"你好，世界。","pinyin":"nǐ hǎo, shì jiè.","translation":"Hello, world."},
 {"id":4709,"hanzi":"你好吗？","translation":"How are you?"},
 {"hanzi":"你好，再见。","translation":"Hello, goodbye."}]}],
 "credits":{"4706":{"by":"bunbuku","tid":355041,"tby":"CK"},"4709":{"by":"","tid":52115,"tby":"human600"}}}`

// A pack sentence carries who wrote it: the id of its page on Tatoeba and its
// owner, and the same for its translation, joined from the pack's credits.
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

// A credit key without a sentence that uses it, or a sentence id with no
// credit, is a malformed pack.
func TestPackCreditsMustMatch(t *testing.T) {
	lang.Register(lang.Zh{})
	sqlDB := dbtest.Open(t)
	seedWords(t, sqlDB)
	bad := `{"entries":[{"word":"你好","sentences":[{"id":7,"hanzi":"你好。","translation":"Hi."}]}],"credits":{}}`
	if _, err := sentences.ImportPack(context.Background(), sqlDB, buildPack(t, "mini", bad)); err == nil {
		t.Error("a sentence id without a credits entry was accepted")
	}
}
