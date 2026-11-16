package backup

import (
	"context"
	"database/sql"
	"strings"
	"testing"
)

// A personal restore keeps access tokens but gives the workspace-limited
// ones the new id of their workspace (restore gives workspaces new ids); a
// token limited to a workspace the archive does not hold is deleted and the
// revocation audited. Other users' tokens are untouched.
func TestRestoreRemapsWorkspaceLimitedTokens(t *testing.T) {
	w := newWorld(t)
	uid := w.AliceUID
	a := openExport(t, w, uid)
	extraWS, _ := scramble(t, w)
	tok := func(name string, ws any, user int64) {
		exec(t, w.DB, `INSERT INTO access_tokens (user_id, name, token_hash, hint, scope, workspace_id, created_at, expires_at) VALUES (?, ?, ?, 'abcdef', 'read', ?, 't', '9999')`, user, name, "h-"+name, ws)
	}
	tok("ws1", w.Alice.WS1, uid)
	tok("ws2", w.Alice.WS2, uid)
	tok("extra", extraWS, uid)
	tok("bob", w.Bob.WS1, w.BobID)
	var keep int64
	w.DB.QueryRow(`SELECT id FROM sessions WHERE token_hash = 'keep'`).Scan(&keep)
	if _, rep, err := Restore(context.Background(), deps(w), uid, keep, a, Options{}); err != nil {
		t.Fatalf("Restore: %v (%+v)", err, rep)
	}
	wsOf := func(name string) (sql.NullInt64, bool) {
		var ws sql.NullInt64
		err := w.DB.QueryRow(`SELECT workspace_id FROM access_tokens WHERE name = ?`, name).Scan(&ws)
		return ws, err == nil
	}
	ws1, ok1 := wsOf("ws1")
	ws2, ok2 := wsOf("ws2")
	if !ok1 || !ok2 || !ws1.Valid || !ws2.Valid {
		t.Fatalf("limited tokens of archived workspaces lost: %v %v", ws1, ws2)
	}
	for _, id := range []int64{ws1.Int64, ws2.Int64} {
		var owner int64
		if err := w.DB.QueryRow(`SELECT user_id FROM workspaces WHERE id = ?`, id).Scan(&owner); err != nil || owner != uid {
			t.Errorf("token bound to workspace %d, which is not a live workspace of the user (%v)", id, err)
		}
		if id == w.Alice.WS1 || id == w.Alice.WS2 || id == extraWS {
			t.Errorf("token still bound to the replaced workspace id %d", id)
		}
	}
	if ws1.Int64 >= ws2.Int64 {
		t.Errorf("ws1 -> %d, ws2 -> %d: the mapping follows the archive order", ws1.Int64, ws2.Int64)
	}
	if _, ok := wsOf("extra"); ok {
		t.Error("the token limited to a workspace outside the archive survived")
	}
	if ws, ok := wsOf("bob"); !ok || ws.Int64 != w.Bob.WS1 {
		t.Errorf("bob's token changed: %v %v", ws, ok)
	}
	var global int
	w.DB.QueryRow(`SELECT COUNT(*) FROM access_tokens WHERE user_id = ? AND workspace_id IS NULL`, uid).Scan(&global)
	if global != 1 {
		t.Errorf("%d all-workspace tokens, want the seeded one kept", global)
	}
	var detail string
	if err := w.DB.QueryRow(`SELECT detail FROM auth_audit WHERE action = 'token_revoked'`).Scan(&detail); err != nil ||
		!strings.Contains(detail, `"scope":"restore"`) || !strings.Contains(detail, `"count":1`) {
		t.Errorf("token_revoked audit %q, %v", detail, err)
	}
}
