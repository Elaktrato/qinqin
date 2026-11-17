package sync_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"qinqin/internal/plugins"
	chinsync "qinqin/internal/sync"
)

var allCollections = []string{"entries", "links", "senses", "levelMembers", "sentences",
	"pluginData", "pluginStates", "overlays", "dictionaries", "schemes", "levels",
	"cards", "decks", "deckSettings", "limits", "fsrsSets", "fsrsActive"}

// Plugin data is the caller's: bob's row never reaches alice.
func TestPullIsUserScoped(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice, bob := newUser(t, sqlDB, "alice"), newUser(t, sqlDB, "bob")
	if _, err := plugins.PutData(ctx, sqlDB, alice, nil, "heatmap", "settings", json.RawMessage(`{"a":1}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := plugins.PutData(ctx, sqlDB, bob, nil, "heatmap", "settings", json.RawMessage(`{"b":2}`)); err != nil {
		t.Fatal(err)
	}
	if err := plugins.SetState(ctx, sqlDB, bob, "heatmap", false, 3); err != nil {
		t.Fatal(err)
	}
	d := mustPull(t, sqlDB, alice, time.Time{})
	if len(d.PluginData) != 1 || string(d.PluginData[0].Data) != `{"a":1}` {
		t.Errorf("pluginData = %+v, want only alice's row", d.PluginData)
	}
	if len(d.PluginStates) != 0 {
		t.Errorf("pluginStates = %+v, want none of bob's", d.PluginStates)
	}
}

// Every collection marshals as [] when empty, never null.
func TestEmptyDeltaCollectionsAreArrays(t *testing.T) {
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	for name, only := range map[string]map[string]bool{"all": nil, "none-selected": {"pluginData": true}} {
		d, err := pullDelta(context.Background(), sqlDB, alice, time.Now().UTC().Add(time.Hour), only)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(d)
		var generic map[string]any
		_ = json.Unmarshal(raw, &generic)
		for _, k := range allCollections {
			if arr, ok := generic[k].([]any); !ok || len(arr) != 0 {
				t.Errorf("%s: empty delta %s = %v, want []", name, k, generic[k])
			}
		}
	}
}

func TestPullCollectionsSubset(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	seedWorld(t, sqlDB)
	if _, err := plugins.PutData(ctx, sqlDB, alice, nil, "heatmap", "settings", json.RawMessage(`{"a":1}`)); err != nil {
		t.Fatal(err)
	}
	only, err := chinsync.ParseCollections("pluginData, pluginStates")
	if err != nil {
		t.Fatal(err)
	}
	d, err := pullDelta(ctx, sqlDB, alice, time.Time{}, only)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.PluginData) != 1 {
		t.Errorf("pluginData = %+v, want alice's row", d.PluginData)
	}
	if n := len(d.Entries) + len(d.Senses) + len(d.Links) + len(d.LevelMembers) + len(d.Sentences) +
		len(d.Dictionaries) + len(d.Schemes) + len(d.Levels); n != 0 {
		t.Errorf("unrequested collections loaded: %+v", d)
	}
	if d.Cursor.IsZero() {
		t.Error("cursor missing")
	}
	if all, _ := chinsync.ParseCollections(""); all != nil {
		t.Errorf("empty list = %v, want nil (everything)", all)
	}
	if _, err := chinsync.ParseCollections("pluginData,nope"); !errors.Is(err, chinsync.ErrInvalid) {
		t.Errorf("unknown collection err = %v, want ErrInvalid", err)
	}
	if _, err := chinsync.ParseCollections("pluginData,entries"); !errors.Is(err, chinsync.ErrMoved) {
		t.Errorf("lexicon collection err = %v, want ErrMoved", err)
	}
}

// A write stamped in the same whole second as the cursor is delivered: pulls
// compare updated_at >= cursor, because updated_at is second-truncated and a
// cursor captured just before the write can share its second. The price is a
// harmless redelivery of rows stamped exactly at the cursor.
func TestPullDeliversSameSecondWrite(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	row, err := plugins.PutDataRow(ctx, sqlDB, alice, nil, "heatmap", "settings", json.RawMessage(`{"a":1}`), nil)
	if err != nil {
		t.Fatal(err)
	}
	stamp := row.UpdatedAt.UTC()

	// Cursor in the same second as the write (captured just before it).
	if d := mustPull(t, sqlDB, alice, stamp); len(d.PluginData) != 1 {
		t.Errorf("pull at the write's own second: pluginData = %+v, want the row", d.PluginData)
	}
	// A cursor one second later has seen it.
	if d := mustPull(t, sqlDB, alice, stamp.Add(time.Second)); len(d.PluginData) != 0 {
		t.Errorf("pull a second after the write: pluginData = %+v, want none", d.PluginData)
	}
}
