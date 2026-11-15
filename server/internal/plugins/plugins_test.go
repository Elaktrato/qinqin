// Package plugins_test exercises the plugin platform's server side
// over a real SQLite database: the feature-plugin registry, per-user
// state, and the plugin-owned data store.
package plugins_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/grammar"
	"qinqin/internal/model"
	"qinqin/internal/plugins"
)

// newDB opens a fresh migrated database.
func newDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

// newUser creates a user directly and returns its id.
func newUser(t *testing.T, sqlDB *sql.DB, username string) int64 {
	t.Helper()
	u, err := auth.CreateUser(context.Background(), sqlDB, username, "pw-"+username, false)
	if err != nil {
		t.Fatalf("create user %s: %v", username, err)
	}
	return u.ID
}

// mustRegister registers a feature-plugin manifest.
func mustRegister(t *testing.T, sqlDB *sql.DB, manifest string) {
	t.Helper()
	if err := plugins.Register(context.Background(), sqlDB, []byte(manifest)); err != nil {
		t.Fatalf("register %s: %v", manifest, err)
	}
}

// manifestObject parses one manifest JSON object.
func manifestObject(t *testing.T, manifest json.RawMessage) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(manifest, &m); err != nil {
		t.Fatalf("parse manifest %s: %v", manifest, err)
	}
	return m
}

// find returns the listed plugin with the given id.
func find(t *testing.T, list []model.PluginInfo, id string) model.PluginInfo {
	t.Helper()
	for _, p := range list {
		if p.ID == id {
			return p
		}
	}
	t.Fatalf("plugin %s not in list %+v", id, list)
	return model.PluginInfo{}
}

// heatmapManifest is a feature-plugin manifest: the admin-registered
// kind, identified by its id, shipping no content of its own.
const heatmapManifest = `{"id":"qinqin-heatmap","name":"Study heatmap","version":"1.0","type":"feature","language":"zh"}`

func TestRegisterListState(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	mustRegister(t, sqlDB, heatmapManifest)

	// With no state row the plugin lists enabled at order 0.
	list, err := plugins.ListFor(ctx, sqlDB, alice)
	if err != nil {
		t.Fatalf("ListFor: %v", err)
	}
	heatmap := find(t, list, "qinqin-heatmap")
	if !heatmap.Enabled || heatmap.Order != 0 {
		t.Errorf("default state = enabled %t, order %d, want enabled, 0", heatmap.Enabled, heatmap.Order)
	}
	if m := manifestObject(t, heatmap.Manifest); m["id"] != "qinqin-heatmap" || m["name"] != "Study heatmap" {
		t.Errorf("manifest = %s, want the registered manifest verbatim", heatmap.Manifest)
	}

	// Alice disables the plugin and reorders it; her list reflects it.
	if err := plugins.SetState(ctx, sqlDB, alice, "qinqin-heatmap", false, 3); err != nil {
		t.Fatalf("SetState: %v", err)
	}
	list, err = plugins.ListFor(ctx, sqlDB, alice)
	if err != nil {
		t.Fatalf("ListFor after SetState: %v", err)
	}
	heatmap = find(t, list, "qinqin-heatmap")
	if heatmap.Enabled || heatmap.Order != 3 {
		t.Errorf("state = enabled %t, order %d, want disabled, 3", heatmap.Enabled, heatmap.Order)
	}

	// Plugin state is per-user: bob still sees the default.
	bob := newUser(t, sqlDB, "bob")
	list, err = plugins.ListFor(ctx, sqlDB, bob)
	if err != nil {
		t.Fatalf("ListFor for bob: %v", err)
	}
	heatmap = find(t, list, "qinqin-heatmap")
	if !heatmap.Enabled || heatmap.Order != 0 {
		t.Errorf("bob's state = enabled %t, order %d, want the per-user default", heatmap.Enabled, heatmap.Order)
	}

	// Re-registering the same id replaces the manifest.
	mustRegister(t, sqlDB, `{"id":"qinqin-heatmap","name":"Study heatmap","version":"1.1","type":"feature","language":"zh"}`)
	list, err = plugins.ListFor(ctx, sqlDB, bob)
	if err != nil {
		t.Fatalf("ListFor after re-register: %v", err)
	}
	heatmap = find(t, list, "qinqin-heatmap")
	if m := manifestObject(t, heatmap.Manifest); m["version"] != "1.1" {
		t.Errorf("manifest after re-register = %s, want version 1.1", heatmap.Manifest)
	}
}

func TestRegisterRejectsInvalidManifests(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()

	for name, manifest := range map[string]string{
		"not json":   `{`,
		"not object": `["qinqin-heatmap"]`,
		"json null":  `null`,
		"no id":      `{"name":"Study heatmap"}`,
		"blank id":   `{"id":"   "}`,
	} {
		if err := plugins.Register(ctx, sqlDB, []byte(manifest)); !errors.Is(err, plugins.ErrInvalidManifest) {
			t.Errorf("register %s err = %v, want ErrInvalidManifest", name, err)
		}
	}
	var count int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM plugin_registry`).Scan(&count); err != nil {
		t.Fatalf("count plugin_registry: %v", err)
	}
	if count != 0 {
		t.Errorf("plugin_registry rows = %d, want 0 — rejected manifests store nothing", count)
	}
}

func TestListForIncludesDataPlugins(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")

	// Registry rows as the pack imports leave them: a dictionary, a
	// levels scheme, and a sentences pack — data plugins, registered
	// by their imports, not by the admin.
	stamp := time.Now().UTC().Format(time.RFC3339)
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := sqlDB.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	exec(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES ('mkgloss', 'mkgloss', '1.0', 'MIT', 'test', ?)`, stamp)
	exec(`INSERT INTO schemes (pack_id, name, unit, language, version, license, attribution, updated_at)
		VALUES ('hsk', 'HSK', 'word', 'zh', '1.0', 'CC BY-SA 4.0', 'test', ?)`, stamp)
	exec(`INSERT INTO entries (language, kind, ext_key, updated_at) VALUES ('zh', 'word', '你好', ?)`, stamp)
	exec(`INSERT INTO frequency_packs (pack_id, name, version, language, license, attribution, ord, updated_at)
		VALUES ('zh-freq', 'Zh frequency', '2', 'zh', 'CC0', 'test', 0, ?)`, stamp)
	exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at)
		VALUES ((SELECT id FROM entries WHERE ext_key = '你好'), 'zh-mini', NULL, '你好。', 'nǐ hǎo.', 'Hello.', ?)`, stamp)

	mustRegister(t, sqlDB, `{"id":"qinqin-heatmap","name":"Study heatmap","version":"1.0","type":"feature"}`)

	list, err := plugins.ListFor(ctx, sqlDB, alice)
	if err != nil {
		t.Fatalf("ListFor: %v", err)
	}
	manifests := map[string]map[string]any{}
	for _, p := range list {
		manifests[p.ID] = manifestObject(t, p.Manifest)
		if !p.Enabled || p.Order != 0 {
			t.Errorf("plugin %s = enabled %t, order %d, want the enabled default", p.ID, p.Enabled, p.Order)
		}
	}
	for _, id := range []string{"qinqin-heatmap", "hsk", "mkgloss", "zh-mini", "zh-freq"} {
		if manifests[id] == nil {
			t.Errorf("plugin %s missing from list %+v", id, list)
		}
	}
	if m := manifests["mkgloss"]; m["type"] != "dictionary" || m["name"] != "mkgloss" || m["version"] != "1.0" {
		t.Errorf("mkgloss manifest = %v, want the dictionary registry fields", m)
	}
	if m := manifests["hsk"]; m["type"] != "levels" || m["language"] != "zh" {
		t.Errorf("hsk manifest = %v, want the scheme registry fields", m)
	}
	if m := manifests["zh-mini"]; m["type"] != "sentences" {
		t.Errorf("zh-mini manifest = %v, want a sentences pack manifest", m)
	}

	if m := manifests["zh-freq"]; m["type"] != "frequency" || m["name"] != "Zh frequency" || m["version"] != "2" || m["language"] != "zh" || m["license"] != "CC0" {
		t.Errorf("zh-freq manifest = %v, want the frequency pack registry fields", m)
	}
	for _, id := range []string{"mkgloss", "hsk", "zh-mini", "zh-freq", "qinqin-heatmap"} {
		if ok, err := plugins.Exists(ctx, sqlDB, id); err != nil || !ok {
			t.Errorf("Exists(%s) = %t, %v, want true", id, ok, err)
		}
	}

	// A soft-deleted frequency pack drops out of the list and of Exists.
	exec(`UPDATE frequency_packs SET deleted_at = ? WHERE pack_id = 'zh-freq'`, stamp)
	if ok, _ := plugins.Exists(ctx, sqlDB, "zh-freq"); ok {
		t.Error("Exists(zh-freq) after uninstall = true, want false")
	}
	exec(`UPDATE frequency_packs SET deleted_at = NULL WHERE pack_id = 'zh-freq'`)

	// A soft-deleted pack drops out of the list.
	exec(`UPDATE dictionaries SET deleted_at = ? WHERE pack_id = 'mkgloss'`, stamp)
	list, err = plugins.ListFor(ctx, sqlDB, alice)
	if err != nil {
		t.Fatalf("ListFor after uninstall: %v", err)
	}
	if len(list) != 4 {
		t.Errorf("plugins after uninstall = %+v, want the 4 remaining", list)
	}

	// State left behind by a removed plugin does not leak a phantom
	// entry into the list.
	if err := plugins.SetState(ctx, sqlDB, alice, "uninstalled-pack", false, 0); err != nil {
		t.Fatalf("SetState: %v", err)
	}
	list, err = plugins.ListFor(ctx, sqlDB, alice)
	if err != nil {
		t.Fatalf("ListFor after ghost state: %v", err)
	}
	if len(list) != 4 {
		t.Errorf("plugins after ghost state = %+v, want still 4 — no phantom entry", list)
	}
}

func TestPluginDataVersioning(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")

	version, err := plugins.PutData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks", json.RawMessage(`{"daily":["你好"]}`))
	if err != nil {
		t.Fatalf("first PutData: %v", err)
	}
	if version != 1 {
		t.Errorf("first PutData version = %d, want 1", version)
	}
	version, err = plugins.PutData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks", json.RawMessage(`{"daily":["你好","谢谢"]}`))
	if err != nil {
		t.Fatalf("second PutData: %v", err)
	}
	if version != 2 {
		t.Errorf("second PutData version = %d, want 2", version)
	}

	d, err := plugins.GetData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks")
	if err != nil {
		t.Fatalf("GetData: %v", err)
	}
	if d.PluginID != "qinqin-flashcards" || d.Key != "decks" || d.UserID != alice || d.WorkspaceID != nil {
		t.Errorf("stored data = %+v, want the flashcards deck keyed to alice, user-global", d)
	}
	if d.Version != 2 || string(d.Data) != `{"daily":["你好","谢谢"]}` || d.DeletedAt != nil || d.UpdatedAt.IsZero() {
		t.Errorf("stored data = %+v, want version 2 carrying the second value", d)
	}

	if _, err := plugins.GetData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "missing"); !errors.Is(err, plugins.ErrNotFound) {
		t.Errorf("GetData of missing key err = %v, want ErrNotFound", err)
	}
}

func TestPluginDataTombstone(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")

	if _, err := plugins.PutData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks", json.RawMessage(`{}`)); err != nil {
		t.Fatalf("PutData: %v", err)
	}
	stored, err := plugins.GetData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks")
	if err != nil {
		t.Fatalf("GetData: %v", err)
	}

	// Deleting tombstones the row: the active read is gone...
	if err := plugins.DeleteData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks"); err != nil {
		t.Fatalf("DeleteData: %v", err)
	}
	if _, err := plugins.GetData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks"); !errors.Is(err, plugins.ErrNotFound) {
		t.Errorf("GetData after delete err = %v, want ErrNotFound", err)
	}
	if err := plugins.DeleteData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks"); !errors.Is(err, plugins.ErrNotFound) {
		t.Errorf("second DeleteData err = %v, want ErrNotFound", err)
	}

	// ...and a sync pull since before the delete returns the tombstone.
	pulled, err := plugins.PullData(ctx, sqlDB, alice, stored.UpdatedAt)
	if err != nil {
		t.Fatalf("PullData: %v", err)
	}
	if len(pulled) != 1 {
		t.Fatalf("pulled = %+v, want the one tombstone", pulled)
	}
	row := pulled[0]
	if row.PluginID != "qinqin-flashcards" || row.Key != "decks" || row.DeletedAt == nil {
		t.Errorf("tombstone = %+v, want the decks row with DeletedAt set", row)
	}
	if row.UpdatedAt.Before(stored.UpdatedAt) {
		t.Errorf("tombstone updated at %v, want the delete's stamp at or after %v", row.UpdatedAt, stored.UpdatedAt)
	}

	// Nothing changed after the delete stamp.
	future, err := plugins.PullData(ctx, sqlDB, alice, time.Now().UTC().Add(time.Hour))
	if err != nil {
		t.Fatalf("PullData since future: %v", err)
	}
	if len(future) != 0 {
		t.Errorf("pulled since future = %+v, want nothing", future)
	}
}

func TestPluginDataRevive(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")

	// A row is stored, then tombstoned: the active read is gone.
	if _, err := plugins.PutData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks", json.RawMessage(`{"daily":["你好"]}`)); err != nil {
		t.Fatalf("first PutData: %v", err)
	}
	stored, err := plugins.GetData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks")
	if err != nil {
		t.Fatalf("GetData: %v", err)
	}
	if err := plugins.DeleteData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks"); err != nil {
		t.Fatalf("DeleteData: %v", err)
	}
	if _, err := plugins.GetData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks"); !errors.Is(err, plugins.ErrNotFound) {
		t.Fatalf("GetData after delete err = %v, want ErrNotFound", err)
	}

	// Re-putting the key revives the tombstoned row: the version
	// continues from the deleted row's, not restarting at 1.
	revivedAt := stored.UpdatedAt
	version, err := plugins.PutData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks", json.RawMessage(`{"daily":["你好","谢谢"]}`))
	if err != nil {
		t.Fatalf("reviving PutData: %v", err)
	}
	if version <= stored.Version {
		t.Errorf("revived version = %d, want greater than the deleted row's %d", version, stored.Version)
	}

	// The revived row reads back active, carrying the new value.
	revived, err := plugins.GetData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks")
	if err != nil {
		t.Fatalf("GetData after revive: %v", err)
	}
	if string(revived.Data) != `{"daily":["你好","谢谢"]}` || revived.Version != version || revived.DeletedAt != nil {
		t.Errorf("revived data = %+v, want version %d active with the new value", revived, version)
	}

	// A sync pull since before the revive reports the row as active,
	// not still deleted.
	pulled, err := plugins.PullData(ctx, sqlDB, alice, revivedAt)
	if err != nil {
		t.Fatalf("PullData: %v", err)
	}
	if len(pulled) != 1 {
		t.Fatalf("pulled = %+v, want the one revived row", pulled)
	}
	if pulled[0].DeletedAt != nil || pulled[0].Version != version || string(pulled[0].Data) != `{"daily":["你好","谢谢"]}` {
		t.Errorf("pulled row = %+v, want the revived row active at version %d", pulled[0], version)
	}
}

func TestPluginDataIsolatedBetweenUsers(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	bob := newUser(t, sqlDB, "bob")

	// The same plugin key under two users is two rows, versioning apart.
	if _, err := plugins.PutData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "settings", json.RawMessage(`{"goal":20}`)); err != nil {
		t.Fatalf("put alice's settings: %v", err)
	}
	if _, err := plugins.PutData(ctx, sqlDB, bob, nil, "qinqin-flashcards", "settings", json.RawMessage(`{"goal":50}`)); err != nil {
		t.Fatalf("put bob's settings: %v", err)
	}
	a, err := plugins.GetData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "settings")
	if err != nil {
		t.Fatalf("get alice's settings: %v", err)
	}
	b, err := plugins.GetData(ctx, sqlDB, bob, nil, "qinqin-flashcards", "settings")
	if err != nil {
		t.Fatalf("get bob's settings: %v", err)
	}
	if string(a.Data) != `{"goal":20}` || a.Version != 1 || string(b.Data) != `{"goal":50}` || b.Version != 1 {
		t.Errorf("alice = %s v%d, bob = %s v%d, want each user's own row", a.Data, a.Version, b.Data, b.Version)
	}

	// Bob deletes his row: alice's survives, and each pull sees only its
	// own user's rows.
	if err := plugins.DeleteData(ctx, sqlDB, bob, nil, "qinqin-flashcards", "settings"); err != nil {
		t.Fatalf("delete bob's settings: %v", err)
	}
	if _, err := plugins.GetData(ctx, sqlDB, bob, nil, "qinqin-flashcards", "settings"); !errors.Is(err, plugins.ErrNotFound) {
		t.Errorf("bob's read after his delete err = %v, want ErrNotFound", err)
	}
	if _, err := plugins.GetData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "settings"); err != nil {
		t.Errorf("alice's read after bob's delete: %v", err)
	}
	for _, tc := range []struct {
		user int64
		want int
	}{
		{alice, 1}, // her live row
		{bob, 1},   // his tombstone
	} {
		pulled, err := plugins.PullData(ctx, sqlDB, tc.user, time.Time{})
		if err != nil {
			t.Fatalf("pull user %d: %v", tc.user, err)
		}
		if len(pulled) != tc.want {
			t.Errorf("pull for user %d = %+v, want %d row(s)", tc.user, pulled, tc.want)
		}
	}
}

func TestPluginDataWorkspaceScoped(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")

	var wsID int64
	if err := sqlDB.QueryRowContext(ctx, `
		INSERT INTO workspaces (user_id, language, settings, updated_at)
		VALUES (?, 'zh', '{}', ?) RETURNING id`,
		alice, time.Now().UTC().Format(time.RFC3339)).Scan(&wsID); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	ws := &wsID

	// The user-global row and the workspace row are distinct rows.
	if _, err := plugins.PutData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks", json.RawMessage(`{"goal":20}`)); err != nil {
		t.Fatalf("put user-global: %v", err)
	}
	if _, err := plugins.PutData(ctx, sqlDB, alice, ws, "qinqin-flashcards", "decks", json.RawMessage(`{"goal":30}`)); err != nil {
		t.Fatalf("put workspace: %v", err)
	}
	global, err := plugins.GetData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks")
	if err != nil {
		t.Fatalf("get user-global: %v", err)
	}
	scoped, err := plugins.GetData(ctx, sqlDB, alice, ws, "qinqin-flashcards", "decks")
	if err != nil {
		t.Fatalf("get workspace: %v", err)
	}
	if string(global.Data) != `{"goal":20}` || global.WorkspaceID != nil {
		t.Errorf("user-global row = %+v, want goal 20 with no workspace", global)
	}
	if string(scoped.Data) != `{"goal":30}` || scoped.WorkspaceID == nil || *scoped.WorkspaceID != wsID {
		t.Errorf("workspace row = %+v, want goal 30 in workspace %d", scoped, wsID)
	}

	// The two rows version independently.
	version, err := plugins.PutData(ctx, sqlDB, alice, ws, "qinqin-flashcards", "decks", json.RawMessage(`{"goal":35}`))
	if err != nil {
		t.Fatalf("re-put workspace: %v", err)
	}
	if version != 2 {
		t.Errorf("workspace re-put version = %d, want 2 — versions count per row", version)
	}

	// Deleting the user-global row leaves the workspace row, and the
	// pull carries each row's workspace_id.
	if err := plugins.DeleteData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks"); err != nil {
		t.Fatalf("delete user-global: %v", err)
	}
	if _, err := plugins.GetData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "decks"); !errors.Is(err, plugins.ErrNotFound) {
		t.Errorf("user-global read after delete err = %v, want ErrNotFound", err)
	}
	if _, err := plugins.GetData(ctx, sqlDB, alice, ws, "qinqin-flashcards", "decks"); err != nil {
		t.Errorf("workspace read after user-global delete: %v", err)
	}
	pulled, err := plugins.PullData(ctx, sqlDB, alice, time.Time{})
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	if len(pulled) != 2 {
		t.Fatalf("pulled = %+v, want the workspace row and the tombstone", pulled)
	}
	var sawGlobal, sawWorkspace bool
	for _, row := range pulled {
		if row.WorkspaceID == nil {
			sawGlobal = true
			if row.DeletedAt == nil {
				t.Errorf("user-global pulled row = %+v, want the tombstone", row)
			}
		} else {
			sawWorkspace = true
			if *row.WorkspaceID != wsID || row.DeletedAt != nil || row.Version != 2 {
				t.Errorf("workspace pulled row = %+v, want live version 2 in workspace %d", row, wsID)
			}
		}
	}
	if !sawGlobal || !sawWorkspace {
		t.Errorf("pulled rows = %+v, want one user-global and one workspace row", pulled)
	}
}

func TestListDataPrefixScopeAndTombstones(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	bob := newUser(t, sqlDB, "bob")
	mkWS := func(user int64, name string) *int64 {
		var id int64
		if err := sqlDB.QueryRowContext(ctx, `INSERT INTO workspaces (user_id, language, name, settings, updated_at)
			VALUES (?, 'zh', ?, '{}', ?) RETURNING id`, user, name, time.Now().UTC().Format(time.RFC3339)).Scan(&id); err != nil {
			t.Fatalf("seed workspace: %v", err)
		}
		return &id
	}
	w, v := mkWS(alice, "W"), mkWS(alice, "V")
	put := func(user int64, ws *int64, key string) {
		t.Helper()
		if _, err := plugins.PutData(ctx, sqlDB, user, ws, "qinqin-journal", key, json.RawMessage(`{"k":"`+key+`"}`)); err != nil {
			t.Fatalf("put %s: %v", key, err)
		}
	}
	for _, k := range []string{"entry:2", "entry:1", "review:1", "entry:3"} {
		put(alice, w, k)
	}
	put(alice, v, "entry:9")
	put(bob, w, "entry:1") // another user's row under the same workspace id
	put(alice, nil, "entry:7")
	if err := plugins.DeleteData(ctx, sqlDB, alice, w, "qinqin-journal", "entry:3"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	keys := func(rows []model.PluginData, err error) []string {
		t.Helper()
		if err != nil {
			t.Fatalf("ListData: %v", err)
		}
		out := []string{}
		for _, r := range rows {
			out = append(out, r.Key)
		}
		return out
	}
	eq := func(got []string, want ...string) {
		t.Helper()
		if len(got) != len(want) {
			t.Fatalf("keys = %v, want %v", got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("keys = %v, want %v", got, want)
			}
		}
	}
	eq(keys(plugins.ListData(ctx, sqlDB, alice, w, "qinqin-journal", "entry:")), "entry:1", "entry:2")
	eq(keys(plugins.ListData(ctx, sqlDB, alice, w, "qinqin-journal", "review:")), "review:1")
	eq(keys(plugins.ListData(ctx, sqlDB, alice, w, "qinqin-journal", "")), "entry:1", "entry:2", "review:1")
	eq(keys(plugins.ListData(ctx, sqlDB, alice, v, "qinqin-journal", "entry:")), "entry:9")
	eq(keys(plugins.ListData(ctx, sqlDB, alice, nil, "qinqin-journal", "entry:")), "entry:7")
	eq(keys(plugins.ListData(ctx, sqlDB, alice, w, "qinqin-journal", "en%")))
	eq(keys(plugins.ListData(ctx, sqlDB, alice, w, "qinqin-journal", "ent_y:")))
	eq(keys(plugins.ListData(ctx, sqlDB, alice, w, "other-plugin", "entry:")))
	rows, _ := plugins.ListData(ctx, sqlDB, alice, w, "qinqin-journal", "review:")
	if rows == nil || string(rows[0].Data) != `{"k":"review:1"}` {
		t.Fatalf("rows = %+v", rows)
	}
	empty, err := plugins.ListData(ctx, sqlDB, alice, w, "qinqin-journal", "zzz")
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("empty = %#v %v, want a non-nil empty slice", empty, err)
	}
}

func TestListForIncludesGrammarPacks(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	pack, err := dict.LoadPack("../grammar/testdata/zh-mini")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := grammar.Import(ctx, sqlDB, pack); err != nil {
		t.Fatal(err)
	}
	list, err := plugins.ListFor(ctx, sqlDB, alice)
	if err != nil {
		t.Fatalf("ListFor: %v", err)
	}
	p := find(t, list, "zh-grammar-mini")
	m := manifestObject(t, p.Manifest)
	if m["type"] != "grammar" || m["language"] != "zh" || m["license"] != "CC0-1.0" || m["name"] != "Chinese grammar mini" || !p.Enabled {
		t.Errorf("manifest = %v enabled %t, want the grammar registry fields", m, p.Enabled)
	}
	if ok, err := plugins.Exists(ctx, sqlDB, "zh-grammar-mini"); err != nil || !ok {
		t.Errorf("Exists = %t, %v, want true", ok, err)
	}
	if _, err := sqlDB.Exec(`UPDATE grammar_packs SET deleted_at = '2026-01-01T00:00:00Z'`); err != nil {
		t.Fatal(err)
	}
	if ok, _ := plugins.Exists(ctx, sqlDB, "zh-grammar-mini"); ok {
		t.Error("Exists after removal = true, want false")
	}
	list, _ = plugins.ListFor(ctx, sqlDB, alice)
	for _, p := range list {
		if p.ID == "zh-grammar-mini" {
			t.Error("removed grammar pack still listed")
		}
	}
}
