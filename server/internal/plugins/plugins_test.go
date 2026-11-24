// Package plugins_test exercises the plugin platform's server side
// over a real SQLite database: the feature-plugin registry, per-user
// state, and the plugin-owned data store.
package plugins_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/dbtest"
	"qinqin/internal/model"
	"qinqin/internal/plugins"
)

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
var heatmapManifest = validManifest("qinqin-heatmap", `"name":"Study heatmap"`)

// validManifest is a feature manifest that passes ParseManifest: sdk 1,
// owns-data, no surfaces or events. extra is a comma-free list of JSON
// members appended last, so a repeated key overrides the default (the
// decoder keeps the last).
func validManifest(id, extra string) string {
	if extra != "" {
		extra = "," + extra
	}
	return `{"id":"` + id + `","name":"X","version":"1.0","type":"feature","sdk":1,"surfaces":[],"permissions":["owns-data"],"hooks":[],"events":[]` + extra + `}`
}

func TestRegisterListState(t *testing.T) {
	sqlDB := dbtest.Open(t)
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
	mustRegister(t, sqlDB, validManifest("qinqin-heatmap", `"name":"Study heatmap","version":"1.1"`))
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
	sqlDB := dbtest.Open(t)
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

func TestUnparsableRegistryRows(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	for _, raw := range plugins.Builtin() {
		if _, err := plugins.RegisterBuiltin(ctx, sqlDB, raw); err != nil {
			t.Fatal(err)
		}
	}
	for id, raw := range map[string]string{
		"zz-old":    `{"id":"zz-old","name":"Old","events":"x"}`,
		"aa-broken": `not json`,
		"mm-fine":   `{"id":"mm-fine","name":"X","version":"1.0","type":"feature","sdk":1,"surfaces":[],"permissions":["owns-data"],"hooks":[],"events":[]}`,
	} {
		if _, err := sqlDB.Exec(`INSERT INTO plugin_registry (pack_id, manifest_json, updated_at) VALUES (?, ?, '2026-01-01T00:00:00Z')`, id, raw); err != nil {
			t.Fatal(err)
		}
	}
	got, err := plugins.UnparsableRows(ctx, sqlDB)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"aa-broken", "zz-old"}; !reflect.DeepEqual(got, want) {
		t.Errorf("UnparsableRows = %v, want %v", got, want)
	}
}

// Data packs are no plugins (#198): GET /api/plugins lists registry rows
// only, whatever is installed and whatever state rows exist, and a pack id
// takes no plugin state or data.
func TestDataPacksAreNoPlugins(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	stamp := "2026-01-01T00:00:00Z"
	for _, q := range []string{
		`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at) VALUES ('d1', 'D', '1', 'MIT', 'x', '` + stamp + `')`,
		`INSERT INTO schemes (pack_id, name, unit, language, version, license, attribution, updated_at) VALUES ('l1', 'L', 'word', 'zh', '1', 'MIT', 'x', '` + stamp + `')`,
		`INSERT INTO frequency_packs (pack_id, name, version, language, license, attribution, ord, updated_at) VALUES ('f1', 'F', '1', 'zh', 'CC0', 'x', 0, '` + stamp + `')`,
		`INSERT INTO entries (language, kind, ext_key, updated_at) VALUES ('zh', 'word', '你好', '` + stamp + `')`,
		`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES ((SELECT id FROM entries WHERE ext_key = '你好'), 's1', NULL, '你好。', 'nǐ hǎo.', 'Hello.', '` + stamp + `')`,
		`INSERT INTO grammar_packs (pack_id, name, version, language, license, attribution, levels_json, updated_at) VALUES ('g1', 'G', '1', 'zh', 'CC0', 'x', '[]', '` + stamp + `')`,
		`INSERT INTO audio_packs (pack_id, language, name, version, license, attribution, created_at, updated_at) VALUES ('a1', 'ja', 'A', '1', 'CC BY 4.0', 'x', '` + stamp + `', '` + stamp + `')`,
	} {
		if _, err := sqlDB.ExecContext(ctx, q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	mustRegister(t, sqlDB, heatmapManifest)
	if err := plugins.SetState(ctx, sqlDB, alice, "g1", false, 3); err != nil {
		t.Fatal(err)
	}
	list, err := plugins.ListFor(ctx, sqlDB, alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != "qinqin-heatmap" {
		t.Errorf("ListFor = %+v, want the registry plugin only", list)
	}
	for _, id := range []string{"d1", "l1", "f1", "s1", "g1", "a1"} {
		if ok, err := plugins.Exists(ctx, sqlDB, id); ok || err != nil {
			t.Errorf("Exists(%s) = %t, %v; want false", id, ok, err)
		}
	}
}
