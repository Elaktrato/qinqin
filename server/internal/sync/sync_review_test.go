package sync_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"qinqin/internal/dict"
	"qinqin/internal/lexicon"
	"qinqin/internal/model"
	"qinqin/internal/overlay"
	"qinqin/internal/plugins"
	chinsync "qinqin/internal/sync"
)

// A writer stamps its row before it commits, so a pull's cursor must lag
// the server clock by more than any write can take; otherwise a row that
// commits after the pull but carries an earlier stamp is never delivered.
func TestPullCursorLagsBehindNow(t *testing.T) {
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	d := mustPull(t, sqlDB, alice, time.Time{})
	if lag := time.Since(d.Cursor); lag < 20*time.Second || lag > 5*time.Minute {
		t.Errorf("cursor lags now by %v, want a safety margin of at least 20s", lag)
	}
}

// A fresh client has nothing to delete, so a pull from the zero cursor
// ships live rows only; a cursor-based pull still ships tombstones.
func TestPullFreshCursorOmitsTombstones(t *testing.T) {
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	seedWorld(t, sqlDB)
	var dictID int64
	if err := sqlDB.QueryRow(`SELECT id FROM dictionaries WHERE pack_id = 'mkgloss'`).Scan(&dictID); err != nil {
		t.Fatalf("find dictionary: %v", err)
	}
	if err := dict.Uninstall(context.Background(), sqlDB, dictID); err != nil {
		t.Fatalf("uninstall: %v", err)
	}

	fresh := mustPull(t, sqlDB, alice, time.Time{})
	for _, s := range fresh.Senses {
		if s.DeletedAt != nil {
			t.Fatalf("fresh pull shipped tombstoned sense %d", s.ID)
		}
	}
	incremental := mustPull(t, sqlDB, alice, time.Now().UTC().Add(-time.Hour))
	if len(incremental.Senses) == 0 {
		t.Error("incremental pull shipped no tombstones")
	}
}

// The delta carries the caller's own overlays (and only theirs), so an
// offline client shows the user's edit, not the shared entry.
func TestPullShipsOwnOverlays(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice, bob := newUser(t, sqlDB, "alice"), newUser(t, sqlDB, "bob")
	seedWorld(t, sqlDB)
	hao, err := lexicon.Store{DB: sqlDB}.Best(ctx, "zh", "character", "好")
	if err != nil {
		t.Fatalf("get 好: %v", err)
	}
	mine := "好!"
	if err := overlay.Put(ctx, sqlDB, alice, hao.ID, model.EntryPatch{Written: &mine}); err != nil {
		t.Fatalf("alice overlay: %v", err)
	}

	d := mustPull(t, sqlDB, alice, time.Time{})
	if len(d.Overlays) != 1 || d.Overlays[0].EntryID != hao.ID || d.Overlays[0].Written == nil || *d.Overlays[0].Written != mine {
		t.Fatalf("alice overlays = %+v, want her edit of entry %d", d.Overlays, hao.ID)
	}
	if other := mustPull(t, sqlDB, bob, time.Time{}); len(other.Overlays) != 0 {
		t.Errorf("bob received overlays %+v, want none", other.Overlays)
	}
}

// Last-write-wins compares edit times, not arrival times: an edit made
// later on another device wins even when it syncs after an earlier edit
// that reached the server more recently.
func TestPushLWWUsesClientEditTime(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	if err := plugins.Register(ctx, sqlDB, []byte(`{"id":"flashcards","name":"Flashcards","version":"1.0","type":"feature"}`)); err != nil {
		t.Fatalf("register plugin: %v", err)
	}
	now := time.Now().UTC()
	push := func(val string, edited time.Time) chinsync.PushResult {
		t.Helper()
		res, err := chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{PluginData: []model.PluginData{
			{PluginID: "flashcards", Key: "deck", Data: json.RawMessage(val), UpdatedAt: edited}}})
		if err != nil {
			t.Fatalf("push %s: %v", val, err)
		}
		return res
	}

	// Device A edited 10 minutes ago but syncs only now; device B edited
	// 5 minutes ago and syncs after A.
	if res := push(`"A"`, now.Add(-10*time.Minute)); res.DataAccepted != 1 {
		t.Fatalf("A = %+v, want accepted", res)
	}
	if res := push(`"B"`, now.Add(-5*time.Minute)); res.DataAccepted != 1 {
		t.Fatalf("B (edited later than A) = %+v, want accepted despite A arriving later", res)
	}
	if res := push(`"C"`, now.Add(-7*time.Minute)); res.DataSkipped != 1 {
		t.Fatalf("C (edited before B) = %+v, want skipped", res)
	}
	got, err := plugins.GetData(ctx, sqlDB, alice, nil, "flashcards", "deck")
	if err != nil || string(got.Data) != `"B"` {
		t.Fatalf("stored = %+v, %v; want B", got, err)
	}

	// A client clock running ahead cannot pin the row: the edit time is
	// clamped to the server clock.
	push(`"future"`, now.Add(24*time.Hour))
	var modified string
	if err := sqlDB.QueryRow(`SELECT modified_at FROM plugin_data WHERE pack_id = 'flashcards'`).Scan(&modified); err != nil {
		t.Fatalf("read modified_at: %v", err)
	}
	if at, _ := time.Parse(time.RFC3339, modified); at.After(time.Now().UTC().Add(time.Second)) {
		t.Errorf("modified_at = %s, want clamped to the server clock", modified)
	}

	// A deletion that sets only deletedAt still counts, at that time.
	gone := time.Now().UTC().Add(time.Minute)
	res, err := chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{PluginData: []model.PluginData{
		{PluginID: "flashcards", Key: "deck", DeletedAt: &gone}}})
	if err != nil || res.DataAccepted != 1 {
		t.Fatalf("deletedAt-only tombstone = %+v, %v; want accepted", res, err)
	}
	if _, err := plugins.GetData(ctx, sqlDB, alice, nil, "flashcards", "deck"); !errors.Is(err, plugins.ErrNotFound) {
		t.Errorf("after tombstone GetData err = %v, want ErrNotFound", err)
	}

	// A row with no timestamp at all cannot be ordered: rejected.
	_, err = chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{PluginData: []model.PluginData{
		{PluginID: "flashcards", Key: "deck", Data: json.RawMessage(`1`)}}})
	if !errors.Is(err, chinsync.ErrInvalid) {
		t.Errorf("zero-timestamp push err = %v, want ErrInvalid", err)
	}
}
