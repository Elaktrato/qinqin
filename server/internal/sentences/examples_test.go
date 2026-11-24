package sentences_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/model"
	"qinqin/internal/sentences"
)

func sentencesModel(hanzi string) model.Sentence {
	return model.Sentence{Hanzi: hanzi, Translation: "x"}
}

// examplesEnv is a database with a small CC-CEDICT, a pack sentence on 学习
// and two users.
type examplesEnv struct {
	db           *sql.DB
	alice, bob   int64
	xuexi, nihao int64
	ctx          context.Context
}

func newExamplesEnv(t *testing.T) examplesEnv {
	t.Helper()
	sqlDB := dbtest.Open(t)
	importCedict(t, sqlDB, "學習 学习 [xue2 xi2] /to learn/to study/", "你好 你好 [ni3 hao3] /hello/")
	e := examplesEnv{db: sqlDB, ctx: context.Background(),
		alice: dbtest.User(t, sqlDB, "alice"), bob: dbtest.User(t, sqlDB, "bob"),
		xuexi: lexID(t, sqlDB, "zh", "word", "学习"), nihao: lexID(t, sqlDB, "zh", "word", "你好")}
	if _, err := sqlDB.Exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at)
		VALUES (?, 'zh-pack', NULL, '我在学习。', '', 'I am studying.', '2026-11-01T00:00:00Z')`, e.xuexi); err != nil {
		t.Fatal(err)
	}
	return e
}

func cands(texts ...string) []sentences.Candidate {
	out := make([]sentences.Candidate, 0, len(texts))
	for _, s := range texts {
		out = append(out, sentences.Candidate{Text: s, Reading: "r", Translation: "t " + s})
	}
	return out
}

func gen(t *testing.T, e examplesEnv, user, entry int64, requestID, level string, texts ...string) []sentences.Draft {
	t.Helper()
	g, err := sentences.StoreGeneration(e.ctx, e.db, user, entry, sentences.Generation{RequestID: requestID, Level: level, Provider: "anthropic", Model: "m1"}, cands(texts...), 0)
	if err != nil {
		t.Fatal(err)
	}
	return g.Drafts
}

func TestDraftsReplaceAndAreIdempotentByRequest(t *testing.T) {
	e := newExamplesEnv(t)
	first := gen(t, e, e.alice, e.xuexi, "r1", "elementary", "我喜欢学习。", "学习很好。")
	if len(first) != 2 || first[0].Hanzi != "我喜欢学习。" || first[0].Level != "elementary" || first[0].Provider != "anthropic" || first[0].RequestID != "r1" {
		t.Fatalf("drafts = %+v", first)
	}
	// The same request again writes nothing new and answers the stored drafts.
	again := gen(t, e, e.alice, e.xuexi, "r1", "advanced", "别的。")
	if len(again) != 2 || again[0].ID != first[0].ID {
		t.Fatalf("a repeated request = %+v", again)
	}
	if got, ok, err := sentences.StoredGeneration(e.ctx, e.db, e.alice, e.xuexi, "r1"); err != nil || !ok || len(got.Drafts) != 2 {
		t.Fatalf("StoredGeneration = %+v %v %v", got, ok, err)
	}
	// A new request replaces the undecided drafts.
	second := gen(t, e, e.alice, e.xuexi, "r2", "advanced", "学习是一件事。")
	v, err := sentences.Examples(e.ctx, e.db, e.alice, e.xuexi)
	if err != nil || len(v.Drafts) != 1 || v.Drafts[0].ID != second[0].ID || v.DefaultLevel != "advanced" {
		t.Fatalf("examples = %+v %v", v, err)
	}
	// Bob sees none of it and starts at beginner.
	bv, err := sentences.Examples(e.ctx, e.db, e.bob, e.xuexi)
	if err != nil || len(bv.Drafts) != 0 || bv.DefaultLevel != "beginner" {
		t.Fatalf("bob = %+v %v", bv, err)
	}
	if _, ok, _ := sentences.StoredGeneration(e.ctx, e.db, e.bob, e.xuexi, "r2"); ok {
		t.Fatal("bob sees alice's request")
	}
}

func TestKeepMakesAnOwnSentenceMarkedAsAI(t *testing.T) {
	e := newExamplesEnv(t)
	d := gen(t, e, e.alice, e.xuexi, "r1", "intermediate", "我喜欢学习。", "学习很好。")
	if _, err := sentences.KeepDraft(e.ctx, e.db, e.bob, e.xuexi, d[0].ID); !errors.Is(err, sentences.ErrDraftNotFound) {
		t.Fatalf("bob keeps alice's draft: %v", err)
	}
	if _, err := sentences.KeepDraft(e.ctx, e.db, e.alice, e.nihao, d[0].ID); !errors.Is(err, sentences.ErrDraftNotFound) {
		t.Fatalf("a draft kept on another entry: %v", err)
	}
	s, err := sentences.KeepDraft(e.ctx, e.db, e.alice, e.xuexi, d[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if s.AI == nil || s.AI.Provider != "anthropic" || s.AI.Model != "m1" || s.UserID == nil || *s.UserID != e.alice || s.SourcePack != "" || s.Hanzi != "我喜欢学习。" {
		t.Fatalf("kept = %+v", s)
	}
	if _, err := sentences.KeepDraft(e.ctx, e.db, e.alice, e.xuexi, d[0].ID); !errors.Is(err, sentences.ErrDraftNotFound) {
		t.Fatalf("a draft kept twice: %v", err)
	}
	list, err := sentences.ForEntry(e.ctx, e.db, e.xuexi, e.alice)
	if err != nil || len(list) != 2 || list[0].AI != nil || list[1].AI == nil || list[1].ID != s.ID {
		t.Fatalf("alice's sentences = %+v %v", list, err)
	}
	if list, _ := sentences.ForEntry(e.ctx, e.db, e.xuexi, e.bob); len(list) != 1 {
		t.Fatalf("bob sees %+v", list)
	}
	v, _ := sentences.Examples(e.ctx, e.db, e.alice, e.xuexi)
	if len(v.Drafts) != 1 || v.DefaultLevel != "intermediate" {
		t.Fatalf("after keep = %+v", v)
	}
	if n, err := sentences.KeptCount(e.ctx, e.db, e.alice, e.xuexi); err != nil || n != 1 {
		t.Fatalf("kept count = %d %v", n, err)
	}
}

func TestKeepStopsAtTheCap(t *testing.T) {
	e := newExamplesEnv(t)
	for i := 0; i < sentences.MaxKeptPerEntry; i++ {
		d := gen(t, e, e.alice, e.xuexi, fmt.Sprintf("r%d", i), "beginner", fmt.Sprintf("学习%d。", i))
		if _, err := sentences.KeepDraft(e.ctx, e.db, e.alice, e.xuexi, d[0].ID); err != nil {
			t.Fatal(err)
		}
	}
	d := gen(t, e, e.alice, e.xuexi, "over", "beginner", "学习再一次。")
	if _, err := sentences.KeepDraft(e.ctx, e.db, e.alice, e.xuexi, d[0].ID); !errors.Is(err, sentences.ErrExamplesFull) {
		t.Fatalf("keep over the cap: %v", err)
	}
	if v, _ := sentences.Examples(e.ctx, e.db, e.alice, e.xuexi); len(v.Drafts) != 1 {
		t.Fatal("a refused keep must leave the draft")
	}
}

func reports(t *testing.T, e examplesEnv, user int64) []string {
	t.Helper()
	rows, err := e.db.Query(`SELECT reason || ':' || hanzi || ':' || provider || ':' || level FROM example_reports WHERE user_id = ? ORDER BY id`, user)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		_ = rows.Scan(&s)
		out = append(out, s)
	}
	return out
}

func TestDiscardAndReportADraft(t *testing.T) {
	e := newExamplesEnv(t)
	d := gen(t, e, e.alice, e.xuexi, "r1", "advanced", "我喜欢学习。", "学习很好。")
	if err := sentences.DiscardDraft(e.ctx, e.db, e.bob, e.xuexi, d[0].ID, ""); !errors.Is(err, sentences.ErrDraftNotFound) {
		t.Fatalf("bob discards alice's draft: %v", err)
	}
	if err := sentences.DiscardDraft(e.ctx, e.db, e.alice, e.xuexi, d[0].ID, ""); err != nil {
		t.Fatal(err)
	}
	if err := sentences.DiscardDraft(e.ctx, e.db, e.alice, e.xuexi, d[1].ID, "unnatural"); err != nil {
		t.Fatal(err)
	}
	if v, _ := sentences.Examples(e.ctx, e.db, e.alice, e.xuexi); len(v.Drafts) != 0 {
		t.Fatalf("drafts left: %+v", v.Drafts)
	}
	if got := reports(t, e, e.alice); len(got) != 1 || got[0] != "unnatural:学习很好。:anthropic:advanced" {
		t.Fatalf("reports = %v", got)
	}
	if err := sentences.DiscardDraft(e.ctx, e.db, e.alice, e.xuexi, d[1].ID, "spam"); !errors.Is(err, sentences.ErrBadReason) {
		t.Fatalf("unknown reason: %v", err)
	}
}

func TestDeleteAnAIExample(t *testing.T) {
	e := newExamplesEnv(t)
	d := gen(t, e, e.alice, e.xuexi, "r1", "beginner", "我喜欢学习。")
	s, err := sentences.KeepDraft(e.ctx, e.db, e.alice, e.xuexi, d[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	own, err := sentences.AddUser(e.ctx, e.db, e.alice, e.xuexi, sentencesModel("书上的句子。"))
	if err != nil {
		t.Fatal(err)
	}
	var packID int64
	_ = e.db.QueryRow(`SELECT id FROM sentences WHERE source_pack = 'zh-pack'`).Scan(&packID)
	for name, c := range map[string]struct{ user, entry, id int64 }{
		"another user": {e.bob, e.xuexi, s.ID}, "another entry": {e.alice, e.nihao, s.ID},
		"an own sentence the AI did not write": {e.alice, e.xuexi, own}, "a pack sentence": {e.alice, e.xuexi, packID},
	} {
		if err := sentences.DeleteAI(e.ctx, e.db, c.user, c.entry, c.id, ""); !errors.Is(err, sentences.ErrSentenceNotFound) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if err := sentences.DeleteAI(e.ctx, e.db, e.alice, e.xuexi, s.ID, "wrong_translation"); err != nil {
		t.Fatal(err)
	}
	if err := sentences.DeleteAI(e.ctx, e.db, e.alice, e.xuexi, s.ID, ""); !errors.Is(err, sentences.ErrSentenceNotFound) {
		t.Fatalf("deleted twice: %v", err)
	}
	var deleted sql.NullString
	if err := e.db.QueryRow(`SELECT deleted_at FROM sentences WHERE id = ?`, s.ID).Scan(&deleted); err != nil || !deleted.Valid {
		t.Fatalf("an AI example is tombstoned (the pull ships it): %v %v", deleted, err)
	}
	if got := reports(t, e, e.alice); len(got) != 1 || got[0] != "wrong_translation:我喜欢学习。:anthropic:beginner" {
		t.Fatalf("reports = %v", got)
	}
	if n, _ := sentences.KeptCount(e.ctx, e.db, e.alice, e.xuexi); n != 0 {
		t.Fatalf("kept count after delete = %d", n)
	}
}

func TestReportsKeepTheNewest(t *testing.T) {
	e := newExamplesEnv(t)
	for i := 0; i < sentences.MaxReportsPerUser+3; i++ {
		d := gen(t, e, e.alice, e.xuexi, fmt.Sprintf("r%d", i), "beginner", fmt.Sprintf("学习%d。", i))
		if err := sentences.DiscardDraft(e.ctx, e.db, e.alice, e.xuexi, d[0].ID, "other"); err != nil {
			t.Fatal(err)
		}
	}
	got := reports(t, e, e.alice)
	if len(got) != sentences.MaxReportsPerUser || got[0] != "other:学习3。:anthropic:beginner" {
		t.Fatalf("%d reports, oldest %q", len(got), got[0])
	}
}

// Fix wave: a generation where every sentence was dropped is remembered under
// its request id (a retry answers it without a second call) and leaves the
// earlier undecided drafts alone, so their Keep still works.
func TestAnEmptyGenerationIsRememberedAndKeepsTheDrafts(t *testing.T) {
	e := newExamplesEnv(t)
	first := gen(t, e, e.alice, e.xuexi, "r1", "beginner", "我喜欢学习。", "学习很好。")
	g := sentences.Generation{RequestID: "r2", Level: "advanced", Provider: "anthropic", Model: "m2"}
	got, err := sentences.StoreGeneration(e.ctx, e.db, e.alice, e.xuexi, g, nil, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Drafts) != 2 || got.Drafts[0].ID != first[0].ID || got.Dropped != 3 || got.RequestID != "r2" || got.Provider != "anthropic" || got.Model != "m2" {
		t.Fatalf("empty generation = %+v", got)
	}
	stored, ok, err := sentences.StoredGeneration(e.ctx, e.db, e.alice, e.xuexi, "r2")
	if err != nil || !ok || stored.Dropped != 3 || len(stored.Drafts) != 2 {
		t.Fatalf("stored = %+v %v %v", stored, ok, err)
	}
	// A retry with sentences writes nothing.
	again, err := sentences.StoreGeneration(e.ctx, e.db, e.alice, e.xuexi, g, cands("学习再来。"), 0)
	if err != nil || again.Dropped != 3 || len(again.Drafts) != 2 {
		t.Fatalf("retry = %+v %v", again, err)
	}
	if _, err := sentences.KeepDraft(e.ctx, e.db, e.alice, e.xuexi, first[0].ID); err != nil {
		t.Fatalf("keep a draft of the earlier generation: %v", err)
	}
	v, err := sentences.Examples(e.ctx, e.db, e.alice, e.xuexi)
	if err != nil || v.LastRequest == nil || v.LastRequest.RequestID != "r2" || v.LastRequest.Dropped != 3 || v.DefaultLevel != "advanced" {
		t.Fatalf("examples = %+v %v", v, err)
	}
	if bv, _ := sentences.Examples(e.ctx, e.db, e.bob, e.xuexi); bv.LastRequest != nil {
		t.Fatalf("bob sees alice's request %+v", bv.LastRequest)
	}
}

// Generation markers are kept a day (the client polls for 180 s at most).
func TestGenerationMarkersExpire(t *testing.T) {
	e := newExamplesEnv(t)
	if _, err := e.db.Exec(`INSERT INTO example_generations (user_id, entry_id, request_id, level, dropped, provider, model, created_at)
		VALUES (?, ?, 'old', 'beginner', 0, 'p', 'm', '2000-01-01T00:00:00Z')`, e.alice, e.nihao); err != nil {
		t.Fatal(err)
	}
	gen(t, e, e.alice, e.xuexi, "new", "beginner", "学习。")
	if _, ok, _ := sentences.StoredGeneration(e.ctx, e.db, e.alice, e.nihao, "old"); ok {
		t.Fatal("a marker older than a day survived")
	}
}
