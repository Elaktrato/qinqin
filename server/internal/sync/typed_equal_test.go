package sync_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	chinsync "qinqin/internal/sync"
)

// Review fix (phases B–D, 3): a typed push item equal to the stored live row
// (two tabs making the same edit, a batch retried after a lost response) is
// counted dataAccepted without a write, whatever its stamp, as on the legacy
// path. A client reads any dataSkipped as "the server holds newer data".
func TestTypedPushOfEqualContentIsAccepted(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	ws := newWorkspace(t, sqlDB, alice)
	item := func(at time.Time) json.RawMessage {
		raw, _ := json.Marshal(map[string]any{"workspaceId": ws, "id": "c-vocab-1", "kind": "vocab", "entryId": 1, "written": nil, "entryKind": nil,
			"sentenceId": nil, "skipKinds": []string{}, "deckIds": []string{"general"}, "createdAt": "t", "extra": map[string]any{}, "updatedAt": at.Format(time.RFC3339Nano)})
		return raw
	}
	push := func(at time.Time) chinsync.PushResult {
		t.Helper()
		res, err := chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{Cards: []json.RawMessage{item(at)}})
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	version := func() (v int) {
		sqlDB.QueryRow(`SELECT version FROM study_cards WHERE id = 'c-vocab-1'`).Scan(&v)
		return v
	}
	t0 := time.Now().UTC().Add(-time.Minute)
	if res := push(t0); res.DataAccepted != 1 {
		t.Fatalf("first push %+v", res)
	}
	for name, at := range map[string]time.Time{"the same edit from another tab": t0.Add(10 * time.Second), "a late retry": t0.Add(-time.Hour)} {
		if res := push(at); res.DataAccepted != 1 || res.DataSkipped != 0 {
			t.Errorf("%s: %+v, want accepted 1 skipped 0", name, res)
		}
		if v := version(); v != 1 {
			t.Errorf("%s: version %d, want 1 (no write)", name, v)
		}
	}
}
