package dbtest

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/db"
)

// schema lists every schema object and the applied migration versions, so
// two databases can be compared for "same schema, same migrations".
func schema(t *testing.T, sqlDB *sql.DB) []string {
	t.Helper()
	var out []string
	for _, q := range []string{
		`SELECT type || ' ' || name || ' ' || COALESCE(sql, '') FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex%' ORDER BY type, name`,
		`SELECT 'migration ' || version FROM schema_migrations ORDER BY version`,
	} {
		rows, err := sqlDB.Query(q)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			var s string
			if err := rows.Scan(&s); err != nil {
				t.Fatal(err)
			}
			out = append(out, s)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
	}
	return out
}

// rowCounts is the number of rows of every table: migrations seed some rows,
// and a copy must carry them.
func rowCounts(t *testing.T, sqlDB *sql.DB) map[string]int {
	t.Helper()
	rows, err := sqlDB.Query(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
		names = append(names, n)
	}
	rows.Close()
	counts := map[string]int{}
	for _, n := range names {
		var c int
		if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM "` + n + `"`).Scan(&c); err != nil {
			t.Fatal(err)
		}
		counts[n] = c
	}
	return counts
}

func TestOpenIsAFullyMigratedDatabase(t *testing.T) {
	fresh, err := db.Open(filepath.Join(t.TempDir(), "fresh.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	copied := Open(t)
	if got, want := schema(t, copied), schema(t, fresh); !slices.Equal(got, want) {
		t.Errorf("schema of the copy differs from a fresh migration:\n got %d objects\nwant %d objects", len(got), len(want))
	}
	got, want := rowCounts(t, copied), rowCounts(t, fresh)
	delete(got, "sqlite_sequence")
	delete(want, "sqlite_sequence")
	gj, _ := json.Marshal(got)
	wj, _ := json.Marshal(want)
	if string(gj) != string(wj) {
		t.Errorf("row counts differ:\n got %s\nwant %s", gj, wj)
	}
}

func TestOpenGivesEachTestItsOwnDatabase(t *testing.T) {
	a, pathA := OpenPath(t)
	b, pathB := OpenPath(t)
	if pathA == pathB {
		t.Fatalf("both databases at %s", pathA)
	}
	User(t, a, "alice")
	var n int
	if err := b.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("a user written to one database shows in another (%d users)", n)
	}
	// The second Open did not run the migrations again.
	if templateBuilds != 1 {
		t.Errorf("template built %d times, want once per test process", templateBuilds)
	}
}

func TestOpenPathCanBeReopened(t *testing.T) {
	sqlDB, path := OpenPath(t)
	User(t, sqlDB, "alice")
	if err := sqlDB.Close(); err != nil {
		t.Fatal(err)
	}
	again, err := db.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	var name string
	if err := again.QueryRow(`SELECT username FROM users`).Scan(&name); err != nil || name != "alice" {
		t.Errorf("reopened: %q, %v", name, err)
	}
}

func TestFileWritesAMigratedDatabaseAtAPath(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "qinqin.db")
	File(t, path)
	ro, err := db.OpenReadOnly(path)
	if err != nil {
		t.Fatal(err)
	}
	defer ro.Close()
	var n int
	if err := ro.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&n); err != nil || n == 0 {
		t.Errorf("schema_migrations: %d rows, %v", n, err)
	}
}

func TestUserAndWorkspaceFixtures(t *testing.T) {
	sqlDB := Open(t)
	alice := User(t, sqlDB, "Alice")
	bob := User(t, sqlDB, "bob")
	if alice == bob || alice == 0 {
		t.Fatalf("ids %d, %d", alice, bob)
	}
	var key string
	var admin bool
	if err := sqlDB.QueryRow(`SELECT username_key, admin FROM users WHERE id = ?`, alice).Scan(&key, &admin); err != nil {
		t.Fatal(err)
	}
	if key != "alice" || admin {
		t.Errorf("username_key %q, admin %v", key, admin)
	}
	ws := Workspace(t, sqlDB, alice, "zh")
	other := Workspace(t, sqlDB, alice, "ja")
	if ws == other {
		t.Fatalf("one id %d for two workspaces", ws)
	}
	var user int64
	var language, settings string
	if err := sqlDB.QueryRow(`SELECT user_id, language, settings FROM workspaces WHERE id = ?`, ws).Scan(&user, &language, &settings); err != nil {
		t.Fatal(err)
	}
	if user != alice || language != "zh" || settings != "{}" {
		t.Errorf("workspace: user %d, language %q, settings %q", user, language, settings)
	}
}

func TestDictPackIsATinyValidPack(t *testing.T) {
	dir := DictPack(t)
	raw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"id", "name", "version", "license", "attribution"} {
		if s, _ := m[k].(string); s == "" {
			t.Errorf("manifest %s missing", k)
		}
	}
	if m["type"] != "dictionary" || m["language"] != "zh" || m["format"] != "json" {
		t.Errorf("manifest %v", m)
	}
	data, err := os.ReadFile(filepath.Join(dir, "dictionary.json"))
	if err != nil {
		t.Fatal(err)
	}
	var d struct {
		Entries []struct {
			Written string `json:"written"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		t.Fatal(err)
	}
	if len(d.Entries) != len(DictWords) {
		t.Fatalf("%d entries, want %d", len(d.Entries), len(DictWords))
	}
	for i, e := range d.Entries {
		if e.Written != DictWords[i] {
			t.Errorf("entry %d: %q, want %q", i, e.Written, DictWords[i])
		}
	}
}

func TestWritePackWritesManifestAndFiles(t *testing.T) {
	dir := WritePack(t, map[string]any{"id": "x"}, map[string]string{"data.txt": "hello"})
	if raw, err := os.ReadFile(filepath.Join(dir, "manifest.json")); err != nil || string(raw) != `{"id":"x"}` {
		t.Errorf("manifest %q, %v", raw, err)
	}
	if raw, err := os.ReadFile(filepath.Join(dir, "data.txt")); err != nil || string(raw) != "hello" {
		t.Errorf("data %q, %v", raw, err)
	}
}
