package sync_test

import (
	"testing"
	"time"
)

// The point of diff-based imports: re-seeding packs that did not change
// leaves nothing for an up-to-date client to download. (The dictionary
// and scheme registry rows themselves are re-stamped — one row each.)
func TestReseedOfUnchangedPacksShipsNoContent(t *testing.T) {
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	seedWorld(t, sqlDB)
	backdate(t, sqlDB)

	seedWorld(t, sqlDB) // the same packs again

	d := mustPull(t, sqlDB, alice, time.Now().UTC().Add(-time.Hour))
	if n := len(d.Entries); n != 0 {
		t.Errorf("entries re-sent after an unchanged re-seed: %d", n)
	}
	if n := len(d.Links); n != 0 {
		t.Errorf("links re-sent: %d", n)
	}
	if n := len(d.Senses); n != 0 {
		t.Errorf("senses re-sent: %d", n)
	}
	if n := len(d.LevelMembers); n != 0 {
		t.Errorf("level members re-sent: %d", n)
	}
	if n := len(d.Sentences); n != 0 {
		t.Errorf("sentences re-sent: %d", n)
	}
}
