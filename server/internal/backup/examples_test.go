package backup

import (
	"context"
	"strings"
	"testing"
)

// #186: a kept AI example travels in the own sentences part with its mark
// and comes back marked; a plain own sentence stays unmarked. Drafts and
// reports are not in the archive: a restore drops the drafts and keeps the
// reports.
func TestExportAndRestoreAIExamples(t *testing.T) {
	w := newWorld(t)
	uid := w.AliceUID
	exec(t, w.DB, `INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at, ai_provider, ai_model, ai_level)
		VALUES (?, '', ?, '你好吗？', 'nǐ hǎo ma', 'How are you?', '2026-11-24T09:00:00Z', 'anthropic', 'claude-opus-5-5', 'beginner'),
		       (?, '', ?, '我说你好。', '', 'I say hello.', '2026-11-24T09:00:00Z', '', '', '')`, w.E1, uid, w.E1, uid)
	exec(t, w.DB, `INSERT INTO example_drafts (user_id, entry_id, request_id, hanzi, pinyin, translation, level, provider, model, created_at)
		VALUES (?, ?, 'r1', '你好！', '', 'Hi!', 'beginner', 'anthropic', 'm', '2026-11-24T09:00:00Z')`, uid, w.E1)
	exec(t, w.DB, `INSERT INTO example_reports (user_id, entry_id, language, hanzi, pinyin, translation, reason, level, provider, model, created_at)
		VALUES (?, ?, 'zh', '坏句子。', '', 'Bad.', 'unnatural', 'beginner', 'anthropic', 'm', '2026-11-24T09:00:00Z')`, uid, w.E1)

	a := openExport(t, w, uid)
	var lines []OwnSentence
	if err := a.OwnSentences(func(s OwnSentence) error { lines = append(lines, s); return nil }); err != nil {
		t.Fatal(err)
	}
	marked := 0
	for _, s := range lines {
		if s.AI != nil {
			marked++
			if s.AI.Provider != "anthropic" || s.AI.Model != "claude-opus-5-5" || s.Hanzi != "你好吗？" {
				t.Errorf("exported mark %+v on %q", s.AI, s.Hanzi)
			}
		}
	}
	if marked != 1 {
		t.Fatalf("%d marked lines in %+v", marked, lines)
	}
	var keep int64
	w.DB.QueryRow(`SELECT id FROM sessions WHERE token_hash = 'keep'`).Scan(&keep)
	if _, rep, err := Restore(context.Background(), deps(w), uid, keep, a, Options{}); err != nil {
		t.Fatalf("Restore: %v (%+v)", err, rep)
	}
	var ai, plain, drafts, reports int
	w.DB.QueryRow(`SELECT COUNT(*) FROM sentences WHERE user_id = ? AND deleted_at IS NULL AND ai_provider = 'anthropic' AND ai_model = 'claude-opus-5-5' AND hanzi = '你好吗？'`, uid).Scan(&ai)
	w.DB.QueryRow(`SELECT COUNT(*) FROM sentences WHERE user_id = ? AND deleted_at IS NULL AND ai_provider = '' AND ai_model = '' AND hanzi = '我说你好。'`, uid).Scan(&plain)
	w.DB.QueryRow(`SELECT COUNT(*) FROM example_drafts WHERE user_id = ?`, uid).Scan(&drafts)
	w.DB.QueryRow(`SELECT COUNT(*) FROM example_reports WHERE user_id = ?`, uid).Scan(&reports)
	if ai != 1 || plain != 1 || drafts != 0 || reports != 1 {
		t.Errorf("after restore: %d marked, %d plain, %d drafts, %d reports", ai, plain, drafts, reports)
	}
}

// A hand-edited archive with a malformed mark is refused.
func TestMalformedAIMarkIsRefused(t *testing.T) {
	for name, line := range map[string]string{
		"both empty":        `{"id":1,"entryId":1,"hanzi":"h","pinyin":"","translation":"t","updatedAt":"2026-11-24T09:00:00Z","ai":{"provider":"","model":""}}`,
		"a long provider":   `{"id":1,"entryId":1,"hanzi":"h","pinyin":"","translation":"t","updatedAt":"2026-11-24T09:00:00Z","ai":{"provider":"` + strings.Repeat("p", 65) + `","model":"m"}}`,
		"an unknown member": `{"id":1,"entryId":1,"hanzi":"h","pinyin":"","translation":"t","updatedAt":"2026-11-24T09:00:00Z","ai":{"provider":"p","model":"m","x":1}}`,
		"a long model":      `{"id":1,"entryId":1,"hanzi":"h","pinyin":"","translation":"t","updatedAt":"2026-11-24T09:00:00Z","ai":{"provider":"p","model":"` + strings.Repeat("m", 201) + `"}}`,
	} {
		if ownSentenceLineOK([]byte(line)) {
			t.Errorf("%s: accepted", name)
		}
	}
	if !ownSentenceLineOK([]byte(`{"id":1,"entryId":1,"hanzi":"h","pinyin":"","translation":"t","updatedAt":"2026-11-24T09:00:00Z","ai":{"provider":"p","model":""}}`)) {
		t.Error("a provider without a model is a mark")
	}
	if !ownSentenceLineOK([]byte(`{"id":1,"entryId":1,"hanzi":"h","pinyin":"","translation":"t","updatedAt":"2026-11-24T09:00:00Z"}`)) {
		t.Error("a line without ai is a plain own sentence")
	}
}
