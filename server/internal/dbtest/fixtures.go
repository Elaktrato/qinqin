package dbtest

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/model"
)

// fixtureTime is the updated_at/created_at stamp of fixture rows.
const fixtureTime = "2026-01-01T00:00:00Z"

// User inserts a non-admin user named name and returns its id. The stored
// hash is no password hash, so the user cannot sign in: a test that signs
// in creates its user with auth.CreateUser instead.
func User(t testing.TB, sqlDB *sql.DB, name string) int64 {
	t.Helper()
	res, err := sqlDB.Exec(`INSERT INTO users (username, hash, admin, updated_at, created_at, username_key)
		VALUES (?, 'dbtest-no-password', 0, ?, ?, ?)`, name, fixtureTime, fixtureTime, model.UsernameKey(name))
	if err != nil {
		t.Fatalf("dbtest: insert user %q: %v", name, err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// Workspace inserts an unnamed workspace of userID for language with empty
// settings and returns its id.
func Workspace(t testing.TB, sqlDB *sql.DB, userID int64, language string) int64 {
	t.Helper()
	res, err := sqlDB.Exec(`INSERT INTO workspaces (user_id, language, name, settings, updated_at)
		VALUES (?, ?, '', '{}', ?)`, userID, language, fixtureTime)
	if err != nil {
		t.Fatalf("dbtest: insert workspace %s of user %d: %v", language, userID, err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// WritePack writes a pack directory: manifest (marshalled as JSON into
// manifest.json) plus files by name. It returns the directory, which a test
// loads and imports with the real importer of the pack's type.
func WritePack(t testing.TB, manifest any, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	for name, body := range files {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// DictWords are the written forms of DictPack's entries, in order.
var DictWords = []string{"学习", "你好", "好"}

// DictPack writes the tiny zh dictionary pack "dbtest-dict" (JSON format,
// CC0) with the three entries of DictWords and returns its directory.
func DictPack(t testing.TB) string {
	t.Helper()
	return WritePack(t, map[string]string{
		"id": "dbtest-dict", "name": "dbtest dictionary", "version": "1", "type": "dictionary",
		"language": "zh", "license": "CC0-1.0", "attribution": "qinqin tests", "format": "json",
	}, map[string]string{"dictionary.json": `{"entries": [
	{"written": "学习", "kind": "word", "readings": [{"type": "pinyin", "value": "xué xí"}], "glosses": ["to study"]},
	{"written": "你好", "kind": "word", "readings": [{"type": "pinyin", "value": "nǐ hǎo"}], "glosses": ["hello"]},
	{"written": "好", "kind": "character", "readings": [{"type": "pinyin", "value": "hǎo"}], "glosses": ["good"]}]}`})
}
