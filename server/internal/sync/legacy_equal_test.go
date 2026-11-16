package sync_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"qinqin/internal/model"
	chinsync "qinqin/internal/sync"
)

// Review fix (phase A, 2): a v0.3.0 shell throws PartialPushError on any
// dataSkipped, and it re-sends a row unchanged (a retry, or a save that
// changes nothing). On the legacy view such an item, equal to the stored live
// typed row after the codec's normalisation, is accepted without a rewrite
// (no version bump), as the v0.3.0 server accepted it. A really older edit of
// other content is still skipped.
func TestLegacyPushOfEqualContentIsAccepted(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	ws := newWorkspace(t, sqlDB, alice)
	registerReserved(t, sqlDB)
	push := func(at time.Time, data string) chinsync.PushResult {
		t.Helper()
		res, err := chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{PluginData: []model.PluginData{{
			PluginID: "qinqin-flashcards", WorkspaceID: &ws, Key: "card:c-vocab-1", Data: json.RawMessage(data), UpdatedAt: at,
		}}})
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	version := func() (v int) {
		sqlDB.QueryRow(`SELECT version FROM study_cards WHERE id = 'c-vocab-1'`).Scan(&v)
		return v
	}
	card := `{"id":"c-vocab-1","kind":"vocab","entryId":1,"deckIds":["general"],"createdAt":"2026-11-10T08:00:00Z"}`
	t0 := time.Now().UTC().Add(-time.Minute)
	if res := push(t0, card); res.DataAccepted != 1 || version() != 1 {
		t.Fatalf("first push %+v, version %d", res, version())
	}
	for name, c := range map[string]struct {
		at   time.Time
		data string
	}{
		"an identical retry":                        {t0.Add(10 * time.Second), card},
		"duplicate deck ids and an empty skipKinds": {t0.Add(20 * time.Second), `{"id":"c-vocab-1","kind":"vocab","entryId":1,"deckIds":["general","general"],"createdAt":"2026-11-10T08:00:00Z","skipKinds":[]}`},
		"an equal retry stamped earlier":            {t0.Add(-time.Hour), card},
	} {
		res := push(c.at, c.data)
		if res.DataAccepted != 1 || res.DataSkipped != 0 || res.DataRefused != 0 {
			t.Errorf("%s: %+v, want accepted 1", name, res)
		}
		if v := version(); v != 1 {
			t.Errorf("%s: version %d, want 1 (no rewrite)", name, v)
		}
	}
	// Other content, older than the stored edit: skipped as before.
	if res := push(t0.Add(-time.Hour), `{"id":"c-vocab-1","kind":"vocab","entryId":1,"deckIds":["d2"],"createdAt":"2026-11-10T08:00:00Z"}`); res.DataSkipped != 1 {
		t.Errorf("older other content: %+v, want skipped 1", res)
	}
}
