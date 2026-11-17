package sync_test

import (
	"context"
	"testing"
	"time"

	"qinqin/internal/dict"
)

// The lexicon and its registry rows (dictionaries, schemes, levels) moved
// to data packages: with a full lexicon installed, a legacy pull — fresh,
// incremental, after an uninstall — keeps their keys empty and ships no
// pack sentence (B4; the lexicon's delta semantics are the packages' now).
func TestLegacyPullLeavesTheLexiconOut(t *testing.T) {
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	seedWorld(t, sqlDB)
	var dictID int64
	if err := sqlDB.QueryRow(`SELECT id FROM dictionaries WHERE pack_id = 'mkgloss'`).Scan(&dictID); err != nil {
		t.Fatalf("find dictionary: %v", err)
	}
	check := func(name string, cursor time.Time) {
		t.Helper()
		d := mustPull(t, sqlDB, alice, cursor)
		n := len(d.Entries) + len(d.Links) + len(d.Senses) + len(d.LevelMembers) + len(d.Dictionaries) +
			len(d.Schemes) + len(d.Levels) + len(d.Sentences)
		if n != 0 || d.Entries == nil || d.Levels == nil {
			t.Errorf("%s: %d lexicon rows or pack sentences, want none (keys as [])", name, n)
		}
	}
	check("fresh", time.Time{})
	check("incremental", time.Unix(0, 0))
	if err := dict.Uninstall(context.Background(), sqlDB, dictID); err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	check("after an uninstall", time.Now().UTC().Add(-time.Hour))
}
