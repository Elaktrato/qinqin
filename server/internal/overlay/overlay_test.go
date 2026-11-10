package overlay_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/model"
	"qinqin/internal/overlay"
)

// The zh pack registers for these tests the same way main.go registers it
// for the server; entries normalize and derive readings through it.
func init() {
	lang.Register(lang.Zh{})
}

// newDB opens a fresh migrated database for overlay tests.
func newDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

// createUser creates a user directly in the database, failing the test
// on error.
func createUser(t *testing.T, sqlDB *sql.DB, username string) model.User {
	t.Helper()
	u, err := auth.CreateUser(context.Background(), sqlDB, username, "pw-"+username, false)
	if err != nil {
		t.Fatalf("create user %s: %v", username, err)
	}
	return u
}

// view returns the entry as userID sees it: the shared entry with that
// user's patch applied.
func view(t *testing.T, sqlDB *sql.DB, userID, entryID int64) model.Entry {
	t.Helper()
	ctx := context.Background()
	e, err := entries.Store{DB: sqlDB}.GetByID(ctx, entryID)
	if err != nil {
		t.Fatalf("GetByID(%d): %v", entryID, err)
	}
	if err := overlay.Apply(ctx, sqlDB, userID, e); err != nil {
		t.Fatalf("Apply(user %d, entry %d): %v", userID, entryID, err)
	}
	return *e
}

// mustGet fetches the entry (written, kind, language), failing the test
// when it is missing.
func mustGet(t *testing.T, sqlDB *sql.DB, written, kind, language string) model.Entry {
	t.Helper()
	e, err := entries.Store{DB: sqlDB}.GetByWritten(context.Background(), written, kind, language)
	if err != nil {
		t.Fatalf("GetByWritten(%s, %s, %s): %v", written, kind, language, err)
	}
	return *e
}

// importPack writes a JSON dictionary pack carrying the given data file
// and imports it, failing the test on error.
func importPack(t *testing.T, ctx context.Context, sqlDB *sql.DB, m dict.Manifest, dictionary string) dict.Result {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	for name, data := range map[string]string{
		"manifest.json":   string(manifest),
		"dictionary.json": dictionary,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(data), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	res, err := dict.Import(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("Import: %v", err)
	}
	return res
}

// activeGlosses returns the entry's active glosses under the dictionary
// installed from packID, in ord order.
func activeGlosses(t *testing.T, sqlDB *sql.DB, packID string, entryID int64) []string {
	t.Helper()
	rows, err := sqlDB.Query(`SELECT gloss FROM senses
		WHERE dictionary_id = (SELECT id FROM dictionaries WHERE pack_id = ?)
			AND entry_id = ? AND deleted_at IS NULL
		ORDER BY ord`, packID, entryID)
	if err != nil {
		t.Fatalf("load glosses of entry %d: %v", entryID, err)
	}
	defer rows.Close()
	glosses := []string{}
	for rows.Next() {
		var g string
		if err := rows.Scan(&g); err != nil {
			t.Fatalf("scan gloss of entry %d: %v", entryID, err)
		}
		glosses = append(glosses, g)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("load glosses of entry %d: %v", entryID, err)
	}
	return glosses
}

// findReading returns e's reading of the given type, or nil.
func findReading(e model.Entry, readType string) *model.Reading {
	for i := range e.Readings {
		if e.Readings[i].Type == readType {
			return &e.Readings[i]
		}
	}
	return nil
}

func TestPatchMergesForOwnerOnly(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	st := entries.Store{DB: sqlDB}

	// 发 carries its shared pinyin reading plus the bopomofo the zh
	// pack derives from it.
	fa, err := st.Upsert(ctx, &model.Entry{
		Language: "zh", Kind: "character", Written: "发",
		Readings: []model.Reading{{Type: "pinyin", Value: "fā"}},
	})
	if err != nil {
		t.Fatalf("upsert 发: %v", err)
	}
	alice := createUser(t, sqlDB, "alice")
	bob := createUser(t, sqlDB, "bob")

	// Alice patches both fields: she prefers the traditional written
	// form and a tone-numbered pinyin.
	written := "發"
	patch := model.EntryPatch{
		Written:  &written,
		Readings: []model.Reading{{Type: "pinyin", Value: "fa4"}},
	}
	if err := overlay.Put(ctx, sqlDB, alice.ID, fa, patch); err != nil {
		t.Fatalf("Put alice's patch of 发: %v", err)
	}

	// Alice sees her patch: her written form and her readings exactly
	// as saved — nothing re-derived, no plain form, no bopomofo.
	a := view(t, sqlDB, alice.ID, fa)
	if a.Written != written {
		t.Errorf("alice's written = %q, want her patched %q", a.Written, written)
	}
	if !slices.Equal(a.Readings, patch.Readings) {
		t.Errorf("alice's readings = %+v, want exactly her saved %+v", a.Readings, patch.Readings)
	}

	// Bob, with no patch of his own, sees the shared entry: his view is
	// untouched by alice's patch.
	b := view(t, sqlDB, bob.ID, fa)
	if b.Written != "发" {
		t.Errorf("bob's written = %q, want the shared 发", b.Written)
	}
	if py := findReading(b, "pinyin"); py == nil || py.Value != "fā" || py.Plain != "fa" {
		t.Errorf("bob's readings = %+v, want the shared pinyin fā/fa", b.Readings)
	}
	if bm := findReading(b, "bopomofo"); bm == nil || bm.Value != "ㄈㄚ" {
		t.Errorf("bob's readings = %+v, want the shared derived bopomofo ㄈㄚ", b.Readings)
	}

	// A patch with a nil field leaves that field shared: bob patches
	// only his readings.
	if err := overlay.Put(ctx, sqlDB, bob.ID, fa, model.EntryPatch{
		Readings: []model.Reading{{Type: "pinyin", Value: "fa1"}},
	}); err != nil {
		t.Fatalf("Put bob's patch of 发: %v", err)
	}
	b = view(t, sqlDB, bob.ID, fa)
	if b.Written != "发" {
		t.Errorf("bob's written after readings-only patch = %q, want the shared 发", b.Written)
	}
	if len(b.Readings) != 1 || b.Readings[0].Value != "fa1" {
		t.Errorf("bob's readings after readings-only patch = %+v, want exactly his pinyin fa1", b.Readings)
	}

	// Alice's view is untouched by bob's patch, and vice versa.
	a = view(t, sqlDB, alice.ID, fa)
	if a.Written != written || len(a.Readings) != 1 || a.Readings[0].Value != "fa4" {
		t.Errorf("alice's view after bob's patch = %q/%+v, want her own patch unchanged", a.Written, a.Readings)
	}

	// A second Put replaces the user's patch wholesale: alice patches
	// readings only, and her written form falls back to the shared one.
	if err := overlay.Put(ctx, sqlDB, alice.ID, fa, model.EntryPatch{
		Readings: []model.Reading{{Type: "pinyin", Value: "fa5"}},
	}); err != nil {
		t.Fatalf("Put alice's replacement patch of 发: %v", err)
	}
	a = view(t, sqlDB, alice.ID, fa)
	if a.Written != "发" {
		t.Errorf("alice's written after replacement patch = %q, want the shared 发", a.Written)
	}
	if len(a.Readings) != 1 || a.Readings[0].Value != "fa5" {
		t.Errorf("alice's readings after replacement patch = %+v, want exactly her pinyin fa5", a.Readings)
	}

	// An empty readings list is non-nil and still a replacement: the
	// user's view shows no readings, not the shared ones.
	if err := overlay.Put(ctx, sqlDB, alice.ID, fa, model.EntryPatch{
		Readings: []model.Reading{},
	}); err != nil {
		t.Fatalf("Put alice's empty readings of 发: %v", err)
	}
	if a = view(t, sqlDB, alice.ID, fa); len(a.Readings) != 0 || a.Readings == nil {
		t.Errorf("alice's readings after empty patch = %+v, want an empty list, not the shared readings", a.Readings)
	}
}

func TestReimportPreservesOverlay(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)

	// Import a pack carrying 发 with the gloss "to issue".
	m := dict.Manifest{
		ID: "overlay-demo", Name: "Overlay demo dictionary", Version: "1.0",
		Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "Qinqin test fixtures",
		Format: "json",
	}
	faJSON := func(gloss string) string {
		return `{"entries": [{"written": "发", "kind": "character",
			"readings": [{"type": "pinyin", "value": "fā"}],
			"glosses": ["` + gloss + `"]}]}`
	}
	if res := importPack(t, ctx, sqlDB, m, faJSON("to issue")); res.Entries != 1 || res.Senses != 1 {
		t.Fatalf("import = %+v, want 1 entry and 1 sense", res)
	}

	fa := mustGet(t, sqlDB, "发", "character", "zh")
	alice := createUser(t, sqlDB, "alice")

	// Alice patches the entry's readings; the shared rows are never
	// written.
	patch := model.EntryPatch{Readings: []model.Reading{{Type: "pinyin", Value: "fa4"}}}
	if err := overlay.Put(ctx, sqlDB, alice.ID, fa.ID, patch); err != nil {
		t.Fatalf("Put alice's patch of 发: %v", err)
	}

	// Re-import the same pack id with the gloss changed to "to send".
	if res := importPack(t, ctx, sqlDB, m, faJSON("to send")); res.Entries != 1 || res.Senses != 1 {
		t.Fatalf("re-import = %+v, want 1 entry and 1 sense", res)
	}

	// The gloss was replaced; the entry row survived with its id.
	if got := activeGlosses(t, sqlDB, "overlay-demo", fa.ID); !slices.Equal(got, []string{"to send"}) {
		t.Errorf("glosses of 发 after re-import = %v, want [to send]", got)
	}
	after := mustGet(t, sqlDB, "发", "character", "zh")
	if after.ID != fa.ID {
		t.Errorf("id of 发 after re-import = %d, want %d", after.ID, fa.ID)
	}

	// Alice's patch survived the re-import: her view still shows her
	// saved reading exactly, not the re-imported shared one.
	a := view(t, sqlDB, alice.ID, fa.ID)
	if a.Written != "发" {
		t.Errorf("alice's written after re-import = %q, want the shared 发", a.Written)
	}
	if !slices.Equal(a.Readings, patch.Readings) {
		t.Errorf("alice's readings after re-import = %+v, want her saved %+v", a.Readings, patch.Readings)
	}

	// The shared entry underneath is untouched by the patch: another
	// user sees the re-imported pinyin and its derived bopomofo.
	bob := createUser(t, sqlDB, "bob")
	shared := view(t, sqlDB, bob.ID, fa.ID)
	if py := findReading(shared, "pinyin"); py == nil || py.Value != "fā" || py.Plain != "fa" {
		t.Errorf("shared readings after re-import = %+v, want pinyin fā/fa", shared.Readings)
	}
	if bm := findReading(shared, "bopomofo"); bm == nil || bm.Value != "ㄈㄚ" {
		t.Errorf("shared readings after re-import = %+v, want derived bopomofo ㄈㄚ", shared.Readings)
	}
}
