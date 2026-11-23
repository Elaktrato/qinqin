package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"testing"
	"time"

	"qinqin/internal/dbtest"
	"qinqin/internal/lexicon"
)

// A build of one language (held here by its lock) does not block
// another language's request.
func TestCharactersCacheLocksPerLanguage(t *testing.T) {
	sqlDB := dbtest.Open(t)
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

// A validator the server issued before the payload dropped the pre-2010
// JLPT field ("j") names the same lexicon version, so it must not match
// any more: a browser holding the old body gets the new one, not a 304.
func TestCharactersETagOutlivesOldFormat(t *testing.T) {
	sqlDB := dbtest.Open(t)
	var c charactersCache
	p, err := c.get(context.Background(), lexicon.Store{DB: sqlDB}, "ja")
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(p.version))
	old := fmt.Sprintf(`W/"chars-%s-%d-%s"`, "ja", 0, hex.EncodeToString(sum[:8]))
	if etagMatches(old, p.etag) {
		t.Errorf("ETag %s still matches the old-format validator %s", p.etag, old)
	}
}
