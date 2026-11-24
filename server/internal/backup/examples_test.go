package backup

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
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
			if s.AI.Provider != "anthropic" || s.AI.Model != "claude-opus-5-5" || s.AI.Level != "beginner" || s.Hanzi != "你好吗？" {
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
	w.DB.QueryRow(`SELECT COUNT(*) FROM sentences WHERE user_id = ? AND deleted_at IS NULL AND ai_provider = 'anthropic' AND ai_model = 'claude-opus-5-5' AND ai_level = 'beginner' AND hanzi = '你好吗？'`, uid).Scan(&ai)
	w.DB.QueryRow(`SELECT COUNT(*) FROM sentences WHERE user_id = ? AND deleted_at IS NULL AND ai_provider = '' AND ai_model = '' AND hanzi = '我说你好。'`, uid).Scan(&plain)
	w.DB.QueryRow(`SELECT COUNT(*) FROM example_drafts WHERE user_id = ?`, uid).Scan(&drafts)
	w.DB.QueryRow(`SELECT COUNT(*) FROM example_reports WHERE user_id = ?`, uid).Scan(&reports)
	if ai != 1 || plain != 1 || drafts != 0 || reports != 1 {
		t.Errorf("after restore: %d marked, %d plain, %d drafts, %d reports", ai, plain, drafts, reports)
	}
}

// A hand-edited archive is held to the live rules of a kept example: a
// provider, a model and a level, the lengths of the server's checks.
func TestMalformedAIMarkIsRefused(t *testing.T) {
	line := func(hanzi, pinyin, translation, ai string) string {
		return `{"id":1,"entryId":1,"hanzi":"` + hanzi + `","pinyin":"` + pinyin + `","translation":"` + translation + `","updatedAt":"2026-11-24T09:00:00Z"` + ai + `}`
	}
	ok := `,"ai":{"provider":"p","model":"m","level":"beginner"}`
	for name, l := range map[string]string{
		"both empty":         line("h", "", "t", `,"ai":{"provider":"","model":"","level":"beginner"}`),
		"no model":           line("h", "", "t", `,"ai":{"provider":"p","model":"","level":"beginner"}`),
		"no provider":        line("h", "", "t", `,"ai":{"provider":"","model":"m","level":"beginner"}`),
		"no level":           line("h", "", "t", `,"ai":{"provider":"p","model":"m"}`),
		"an unknown level":   line("h", "", "t", `,"ai":{"provider":"p","model":"m","level":"expert"}`),
		"a long provider":    line("h", "", "t", `,"ai":{"provider":"`+strings.Repeat("p", 65)+`","model":"m","level":"beginner"}`),
		"a long model":       line("h", "", "t", `,"ai":{"provider":"p","model":"`+strings.Repeat("m", 201)+`","level":"beginner"}`),
		"an unknown member":  line("h", "", "t", `,"ai":{"provider":"p","model":"m","level":"beginner","x":1}`),
		"a long text":        line(strings.Repeat("字", 201), "", "t", ok),
		"a long translation": line("h", "", strings.Repeat("t", 401), ok),
		"a long reading":     line("h", strings.Repeat("p", 401), "t", ok),
		"no translation":     line("h", "", "", ok),
	} {
		if ownSentenceLineOK([]byte(l)) {
			t.Errorf("%s: accepted", name)
		}
	}
	if !ownSentenceLineOK([]byte(line(strings.Repeat("字", 200), "", "t", ok))) {
		t.Error("a well-formed AI example at the length cap is refused")
	}
	if !ownSentenceLineOK([]byte(line(strings.Repeat("字", 300), "", "", ""))) {
		t.Error("a plain own sentence keeps the plain rules")
	}
}

// More than ten AI examples on one entry is a hand-edited archive.
func TestTooManyAIExamplesOnAnEntryAreRefused(t *testing.T) {
	w := newWorld(t)
	uid := w.AliceUID
	for i := 0; i < 11; i++ {
		exec(t, w.DB, `INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at, ai_provider, ai_model, ai_level)
			VALUES (?, '', ?, ?, '', 't', '2026-11-24T09:00:00Z', 'anthropic', 'm', 'beginner')`, w.E1, uid, fmt.Sprintf("你好%d。", i))
	}
	data, _ := exportBytes(t, w, uid)
	p := filepath.Join(t.TempDir(), "x.zip")
	os.WriteFile(p, data, 0o644)
	a, err := Open(p)
	if err == nil {
		a.Close()
		t.Fatal("an archive with 11 AI examples on one entry was read")
	}
}
