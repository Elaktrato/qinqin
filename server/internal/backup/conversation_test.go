package backup

import (
	"context"
	"testing"
)

// #185: a conversation of the partner and its messages travel in the
// personal backup (journal:conversation:<id>) and come back on a restore.
func TestExportAndRestoreConversations(t *testing.T) {
	w := newWorld(t)
	uid, ws := w.AliceUID, w.Alice.WS1
	exec(t, w.DB, `INSERT INTO journal_conversations (user_id, workspace_id, id, topic, level, created_at, updated_at)
		VALUES (?, ?, 'c1', '周末', 'elementary', '2026-11-24T09:00:00Z', '2026-11-24T09:01:00Z')`, uid, ws)
	exec(t, w.DB, `INSERT INTO journal_messages (user_id, workspace_id, conversation_id, seq, role, text, annotations, model, provider, created_at)
		VALUES (?, ?, 'c1', 1, 'partner', '你好！', '[]', 'm', 'anthropic', '2026-11-24T09:00:05Z'),
		       (?, ?, 'c1', 2, 'learner', '我是很好。', '[{"id":"m2a1","quote":"是很","prefix":"我","suffix":"好。","correction":"很","explanation":"e","category":"grammar","kind":"mistake"}]', '', '', '2026-11-24T09:01:00Z')`,
		uid, ws, uid, ws)

	a := openExport(t, w, uid)
	var keep int64
	w.DB.QueryRow(`SELECT id FROM sessions WHERE token_hash = 'keep'`).Scan(&keep)
	if _, rep, err := Restore(context.Background(), deps(w), uid, keep, a, Options{}); err != nil {
		t.Fatalf("Restore: %v (%+v)", err, rep)
	}
	var convs, msgs int
	var anns string
	w.DB.QueryRow(`SELECT COUNT(*) FROM journal_conversations WHERE user_id = ? AND topic = '周末' AND level = 'elementary'`, uid).Scan(&convs)
	w.DB.QueryRow(`SELECT COUNT(*) FROM journal_messages WHERE user_id = ?`, uid).Scan(&msgs)
	w.DB.QueryRow(`SELECT annotations FROM journal_messages WHERE user_id = ? AND seq = 2`, uid).Scan(&anns)
	if convs != 1 || msgs != 2 || anns == "" || anns == "[]" {
		t.Errorf("after restore: %d conversations, %d messages, annotations %s", convs, msgs, anns)
	}
}
