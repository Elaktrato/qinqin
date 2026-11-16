package api_test

import (
	"context"
	"strings"
	"testing"

	"qinqin/internal/auth"
)

// Matrix 15: deleting a workspace deletes the tokens limited to it (in the
// deletion transaction); the owner's other tokens and other users' stay.
func TestDeleteWorkspaceRevokesItsTokens(t *testing.T) {
	ts, sqlDB, _ := newServerWithDir(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	aliceID, bobID := userID(t, sqlDB, "alice"), userID(t, sqlDB, "bob")
	gone := createWorkspace(t, ts.URL, alice, "zh", "throwaway")
	kept := createWorkspace(t, ts.URL, alice, "zh", "")
	bobs := createWorkspace(t, ts.URL, bob, "zh", "")
	ctx := context.Background()
	mint := func(u int64, ws *int64) int64 {
		_, info, err := auth.CreateToken(ctx, sqlDB, u, auth.TokenRequest{Name: "n", Scope: "write", ExpiresInDays: 30, WorkspaceID: ws})
		if err != nil {
			t.Fatal(err)
		}
		return info.ID
	}
	bound := mint(aliceID, &gone)
	other := mint(aliceID, &kept)
	global := mint(aliceID, nil)
	bobTok := mint(bobID, &bobs)
	if status := deleteWorkspace(t, ts.URL, alice, gone); status != 204 {
		t.Fatalf("delete status %d", status)
	}
	left := map[int64]bool{}
	rows, _ := sqlDB.Query(`SELECT id FROM access_tokens`)
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		left[id] = true
	}
	rows.Close()
	if left[bound] || !left[other] || !left[global] || !left[bobTok] {
		t.Errorf("tokens left %v: want %d gone, %d %d %d kept", left, bound, other, global, bobTok)
	}
	// The revocation is audited like every other containment path.
	var detail string
	if err := sqlDB.QueryRow(`SELECT detail FROM auth_audit WHERE action = 'token_revoked'`).Scan(&detail); err != nil ||
		!strings.Contains(detail, `"scope":"workspace"`) || !strings.Contains(detail, `"count":1`) {
		t.Errorf("token_revoked audit %q, %v", detail, err)
	}
	// A workspace without tokens writes no token row.
	spare := createWorkspace(t, ts.URL, alice, "zh", "spare")
	if status := deleteWorkspace(t, ts.URL, alice, spare); status != 204 {
		t.Fatalf("delete spare: %d", status)
	}
	var n int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM auth_audit WHERE action = 'token_revoked'`).Scan(&n)
	if n != 1 {
		t.Errorf("%d token_revoked rows, want 1", n)
	}
}
