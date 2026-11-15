package sync_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"qinqin/internal/dict"
	"qinqin/internal/lexicon"
	"qinqin/internal/plugins"
	chinsync "qinqin/internal/sync"
)

var allCollections = []string{"entries", "links", "senses", "levelMembers", "sentences",
	"pluginData", "pluginStates", "overlays", "dictionaries", "schemes", "levels"}

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
		d, err := chinsync.Pull(context.Background(), sqlDB, alice, time.Now().UTC().Add(time.Hour), only)
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
	d, err := chinsync.Pull(ctx, sqlDB, alice, time.Time{}, only)
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
	if _, err := chinsync.ParseCollections("entries,nope"); !errors.Is(err, chinsync.ErrInvalid) {
		t.Errorf("unknown collection err = %v, want ErrInvalid", err)
	}
}

// putSenses replaces the senses mkgloss gives 你好 with the glosses (one
// sense each) and returns the entry id.
func putSenses(t *testing.T, sqlDB *sql.DB, pack, form string, glosses ...string) int64 {
	t.Helper()
	ctx := context.Background()
	st := lexicon.Store{DB: sqlDB}
	id := lexID(t, sqlDB, "zh", "word", form)
	e, err := st.Get(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	dictionary := dictID(t, sqlDB, pack)
	e.Senses = nil
	for _, g := range glosses {
		e.Senses = append(e.Senses, lexicon.Sense{Glosses: []string{g}})
	}
	if _, err := st.Put(ctx, e, dictionary); err != nil {
		t.Fatal(err)
	}
	return id
}

// sensesOf returns the delta's senses of one entry.
func sensesOf(d chinsync.Delta, entry int64) (live, dead []chinsync.Sense) {
	for _, s := range d.Senses {
		if s.EntryID != entry {
			continue
		}
		if s.DeletedAt != nil {
			dead = append(dead, s)
		} else {
			live = append(live, s)
		}
	}
	return
}

// Put retires and re-inserts a dictionary's senses under one stamp; the
// delta must not carry a tombstone for a sense that has a live
// replacement at the same (entryId, dictionaryId, ord).
func TestPullSenseTombstonesSuperseded(t *testing.T) {
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	seedWorld(t, sqlDB)
	id := putSenses(t, sqlDB, "mkgloss", "你好", "hello", "hi", "hey")
	backdate(t, sqlDB)
	cursor := time.Now().UTC().Add(-time.Hour)

	// A changed re-import: same ords, new text. No tombstones.
	putSenses(t, sqlDB, "mkgloss", "你好", "hello!", "hi!", "hey!")
	live, dead := sensesOf(mustPull(t, sqlDB, alice, cursor), id)
	if len(live) != 3 || len(dead) != 0 {
		t.Fatalf("changed re-import: %d live %d tombstones, want 3 live and none", len(live), len(dead))
	}

	// A re-import with fewer senses: the removed ords ship tombstones,
	// the replaced one does not.
	backdate(t, sqlDB)
	putSenses(t, sqlDB, "mkgloss", "你好", "hello?")
	live, dead = sensesOf(mustPull(t, sqlDB, alice, cursor), id)
	if len(live) != 1 || live[0].Ord != 0 || len(dead) != 2 {
		t.Fatalf("shrunk re-import: live %+v tombstones %+v, want one live and two tombstones", live, dead)
	}
	for _, s := range dead {
		if s.Ord == 0 {
			t.Errorf("tombstone %+v shipped beside the live sense at its key", s)
		}
	}
}

func TestPullUninstallShipsEveryTombstone(t *testing.T) {
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	seedWorld(t, sqlDB)
	id := putSenses(t, sqlDB, "mkgloss", "你好", "hello", "hi")
	backdate(t, sqlDB)
	if err := dict.Uninstall(context.Background(), sqlDB, dictID(t, sqlDB, "mkgloss")); err != nil {
		t.Fatal(err)
	}
	live, dead := sensesOf(mustPull(t, sqlDB, alice, time.Now().UTC().Add(-time.Hour)), id)
	if len(live) != 0 || len(dead) != 2 {
		t.Errorf("uninstall: live %+v tombstones %+v, want two tombstones", live, dead)
	}
}

// A change to one dictionary's senses leaves another dictionary's alone.
func TestPullSenseChangeSparesOtherDictionary(t *testing.T) {
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	seedWorld(t, sqlDB)
	if _, err := sqlDB.Exec(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES ('other', 'Other', '1', 'x', 'x', '2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	id := putSenses(t, sqlDB, "other", "你好", "howdy")
	putSenses(t, sqlDB, "mkgloss", "你好", "hello")
	backdate(t, sqlDB)

	putSenses(t, sqlDB, "mkgloss", "你好", "hello there")
	live, dead := sensesOf(mustPull(t, sqlDB, alice, time.Now().UTC().Add(-time.Hour)), id)
	if len(dead) != 0 || len(live) != 1 || live[0].DictionaryID != dictID(t, sqlDB, "mkgloss") {
		t.Errorf("live %+v tombstones %+v, want only mkgloss's replaced sense", live, dead)
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
