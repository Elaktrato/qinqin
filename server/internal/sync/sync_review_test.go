package sync_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"qinqin/internal/dbtest"
	"qinqin/internal/model"
	"qinqin/internal/plugins"
	chinsync "qinqin/internal/sync"
)

// Last-write-wins compares edit times, not arrival times: an edit made
// later on another device wins even when it syncs after an earlier edit
// that reached the server more recently.
func TestPushLWWUsesClientEditTime(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	if err := plugins.Register(ctx, sqlDB, []byte(validManifest("flashcards", ""))); err != nil {
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
