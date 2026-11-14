package sync_test

import (
	"context"
	"testing"
	"time"

	"qinqin/internal/dict"
)

// Senses reference a dictionary id and level members a level id; a
// client holding only the delta can resolve neither unless the pull also
// carries the dictionaries, schemes, and levels themselves.
func TestPullShipsRegistryRows(t *testing.T) {
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	seedWorld(t, sqlDB)

	d := mustPull(t, sqlDB, alice, time.Time{})
	if len(d.Dictionaries) != 2 || d.Dictionaries[0].PackID != "mkgloss" || d.Dictionaries[1].PackID != "jm-mini" {
		t.Errorf("dictionaries = %+v, want mkgloss and jm-mini", d.Dictionaries)
	}
	if len(d.Schemes) != 1 || d.Schemes[0].PackID != "hsk-mini" || d.Schemes[0].Unit != "word" {
		t.Errorf("schemes = %+v, want hsk-mini", d.Schemes)
	}
	if len(d.Levels) != 2 || d.Levels[0].SchemeID != d.Schemes[0].ID || d.Levels[0].Name != "1" {
		t.Errorf("levels = %+v, want hsk-mini levels 1 and 2", d.Levels)
	}
	// Every shipped sense and member resolves against the shipped rows.
	dictIDs := map[int64]bool{}
	for _, x := range d.Dictionaries {
		dictIDs[x.ID] = true
	}
	for _, s := range d.Senses {
		if !dictIDs[s.DictionaryID] {
			t.Fatalf("sense %d references dictionary %d, not in the delta", s.ID, s.DictionaryID)
		}
	}
	levelIDs := map[int64]bool{}
	for _, l := range d.Levels {
		levelIDs[l.ID] = true
	}
	for _, m := range d.LevelMembers {
		if !levelIDs[m.LevelID] {
			t.Fatalf("level member %d references level %d, not in the delta", m.ID, m.LevelID)
		}
	}

	// Uninstalling a dictionary reaches clients as a tombstoned row.
	var dictID int64
	if err := sqlDB.QueryRow(`SELECT id FROM dictionaries WHERE pack_id = 'mkgloss'`).Scan(&dictID); err != nil {
		t.Fatalf("find dictionary: %v", err)
	}
	if err := dict.Uninstall(context.Background(), sqlDB, dictID); err != nil {
		t.Fatalf("uninstall: %v", err)
	}
	inc := mustPull(t, sqlDB, alice, time.Now().UTC().Add(-time.Hour))
	if len(inc.Dictionaries) < 1 || inc.Dictionaries[0].PackID != "mkgloss" || inc.Dictionaries[0].DeletedAt == nil {
		t.Errorf("incremental dictionaries = %+v, want a tombstone", inc.Dictionaries)
	}
	if fresh := mustPull(t, sqlDB, alice, time.Time{}); len(fresh.Dictionaries) != 1 || fresh.Dictionaries[0].PackID != "jm-mini" {
		t.Errorf("fresh pull shipped uninstalled dictionary %+v", fresh.Dictionaries)
	}
}
