package api

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"qinqin/internal/db"
	"qinqin/internal/lexicon"
)

// A build of one language (held here by its lock) does not block
// another language's request.
func TestCharactersCacheLocksPerLanguage(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	st := lexicon.Store{DB: sqlDB}
	var c charactersCache

	zh := c.slot("zh")
	zh.mu.Lock()
	done := make(chan error, 1)
	go func() {
		_, err := c.get(context.Background(), st, "ja")
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("ja waited for the zh lock")
	}
	zh.mu.Unlock()
	if c.slot("ja") != c.slot("ja") || c.slot("ja") == zh {
		t.Error("slots are not one per language")
	}
}
