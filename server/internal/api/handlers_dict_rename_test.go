package api_test

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/lang"
)

// A committed import whose files cannot be moved into place is still an
// installed dictionary: the answer is 201, not a 500 for rows that exist.
func TestInstallDictionarySurvivesFileMoveFailure(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, sqlDB, dataDir := newServerWithDir(t)
	admin := registerUser(t, ts.URL, "admin", "")

	packs := filepath.Join(dataDir, "packs")
	if err := os.MkdirAll(packs, 0o755); err != nil {
		t.Fatal(err)
	}
	// A regular file where the type directory belongs: the move cannot happen.
	if err := os.WriteFile(filepath.Join(packs, "dictionary"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	resp := postPack(t, ts.URL, admin, "pack", zipDirToBytes(t, dictFixture))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST with a failing file move: status = %d, want %d", resp.StatusCode, http.StatusCreated)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM dictionaries WHERE pack_id = 'mkgloss' AND deleted_at IS NULL`).Scan(&n); err != nil || n != 1 {
		t.Errorf("installed dictionary rows = %d, %v; want 1", n, err)
	}
}
