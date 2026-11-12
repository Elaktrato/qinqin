package sync_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"qinqin/internal/dict"
	"qinqin/internal/lexicon"
	"qinqin/internal/model"
	"qinqin/internal/sentences"
	chinsync "qinqin/internal/sync"
)

func dictID(t *testing.T, sqlDB *sql.DB, pack string) int64 {
	t.Helper()
	var id int64
	if err := sqlDB.QueryRow(`SELECT id FROM dictionaries WHERE pack_id = ?`, pack).Scan(&id); err != nil {
		t.Fatalf("find dictionary %s: %v", pack, err)
	}
	return id
}

// entryIDs returns the ids of the delta's entries.
func entryIDs(d chinsync.Delta) map[int64]bool {
	ids := map[int64]bool{}
	for _, e := range d.Entries {
		ids[e.ID] = true
	}
	return ids
}

func TestPullAllShipsLexicon(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice, bob := newUser(t, sqlDB, "alice"), newUser(t, sqlDB, "bob")
	seedWorld(t, sqlDB)
	nihao := lexID(t, sqlDB, "zh", "word", "你好")
	hao := lexID(t, sqlDB, "zh", "character", "好")
	gakkou := lexID(t, sqlDB, "ja", "word", "学校")
	if _, err := sentences.AddUser(ctx, sqlDB, alice, nihao, model.Sentence{Hanzi: "好！", Pinyin: "hǎo", Translation: "Good!"}); err != nil {
		t.Fatalf("alice sentence: %v", err)
	}
	if _, err := sentences.AddUser(ctx, sqlDB, bob, nihao, model.Sentence{Hanzi: "很好", Pinyin: "hěn hǎo", Translation: "Very good"}); err != nil {
		t.Fatalf("bob sentence: %v", err)
	}

	d := mustPull(t, sqlDB, alice, time.Time{})

	byID := map[int64]chinsync.Entry{}
	for _, e := range d.Entries {
		byID[e.ID] = e
	}
	if len(d.Entries) != 3 {
		t.Fatalf("entries = %d, want 好, 你好 and 学校", len(d.Entries))
	}
	n := byID[nihao]
	if n.Language != "zh" || n.Kind != "word" || len(n.Forms) == 0 || n.Forms[0].Text != "你好" ||
		len(n.Readings) == 0 || n.Readings[0].Type != "pinyin" || n.Readings[0].Plain == "" || n.DeletedAt != nil {
		t.Errorf("entry 你好 = %+v, want language, kind, forms and readings", n)
	}
	g := byID[gakkou]
	if len(g.Forms) != 1 || g.Forms[0].Text != "学校" || len(g.Readings) != 2 || g.Readings[0].Type != "kana" {
		t.Errorf("entry 学校 = %+v", g)
	}

	// Senses carry POS and xrefs, and point at shipped entries and dictionaries.
	var school *chinsync.Sense
	for i, s := range d.Senses {
		if !inDelta(byID, s.EntryID) {
			t.Errorf("sense %d references entry %d, not in the delta", s.ID, s.EntryID)
		}
		if s.EntryID == gakkou {
			school = &d.Senses[i]
		}
	}
	if school == nil || len(school.POS) != 1 || school.POS[0] != "n" ||
		len(school.Xrefs) != 1 || school.Xrefs[0] != "学園" || len(school.Glosses) != 1 || school.Glosses[0] != "school" {
		t.Fatalf("学校 sense = %+v, want POS, xref and gloss", school)
	}
	if school.DictionaryID != dictID(t, sqlDB, "jm-mini") {
		t.Errorf("sense dictionary = %d, want jm-mini", school.DictionaryID)
	}

	// Variant links ship in both directions.
	if len(d.Links) != 2 {
		t.Fatalf("links = %+v, want the variant pair", d.Links)
	}
	for _, l := range d.Links {
		if l.Type != "variant" || !(l.FromID == nihao && l.ToID == hao || l.FromID == hao && l.ToID == nihao) {
			t.Errorf("link = %+v", l)
		}
	}

	// Level members and sentences reference entries that ship with them.
	if len(d.LevelMembers) == 0 {
		t.Fatal("no level members")
	}
	for _, m := range d.LevelMembers {
		if !inDelta(byID, m.EntryID) {
			t.Errorf("level member %d references entry %d, not in the delta", m.ID, m.EntryID)
		}
	}
	var packSentences, own int
	for _, s := range d.Sentences {
		if !inDelta(byID, s.EntryID) {
			t.Errorf("sentence %d references entry %d, not in the delta", s.ID, s.EntryID)
		}
		if s.UserID == nil {
			packSentences++
		} else if s.Hanzi == "好！" {
			own++
		}
	}
	if packSentences != 2 || own != 1 || len(d.Sentences) != 3 {
		t.Errorf("sentences = %+v, want the two pack ones plus alice's own, never bob's", d.Sentences)
	}
}

func TestPullDeltaWireShape(t *testing.T) {
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	seedWorld(t, sqlDB)
	raw, err := json.Marshal(mustPull(t, sqlDB, alice, time.Time{}))
	if err != nil {
		t.Fatal(err)
	}
	var generic struct {
		Entries []map[string]any `json:"entries"`
		Senses  []map[string]any `json:"senses"`
		Links   []map[string]any `json:"links"`
	}
	if err := json.Unmarshal(raw, &generic); err != nil {
		t.Fatal(err)
	}
	has := func(m map[string]any, keys ...string) {
		t.Helper()
		for _, k := range keys {
			if _, ok := m[k]; !ok {
				t.Errorf("wire object lacks %q: %v", k, m)
			}
		}
	}
	has(generic.Entries[0], "id", "language", "kind", "key", "forms", "readings", "pri", "uk", "attrs", "updatedAt")
	form := generic.Entries[0]["forms"].([]any)[0].(map[string]any)
	has(form, "text", "ord", "flags", "pri")
	reading := generic.Entries[0]["readings"].([]any)[0].(map[string]any)
	has(reading, "type", "value", "plain", "ord", "flags", "pri")
	has(generic.Senses[0], "id", "dictionaryId", "entryId", "ord", "pos", "tags", "glosses", "xrefs", "updatedAt")
	has(generic.Links[0], "fromId", "toId", "type", "updatedAt")
	if strings.Contains(string(raw), `"Forms"`) || strings.Contains(string(raw), `"Text"`) {
		t.Error("wire format leaks Go field names")
	}
}

// Only the rows that changed ship again; a change to one child of an
// entry ships the entry (the store restamps it), unrelated entries stay.
func TestPullIncrementalChildOnlyChanges(t *testing.T) {
	ctx := context.Background()
	st := func(sqlDB *sql.DB) lexicon.Store { return lexicon.Store{DB: sqlDB} }
	mutate := map[string]struct {
		pack string
		edit func(e *lexicon.Entry)
	}{
		"a form":    {"mkgloss", func(e *lexicon.Entry) { e.Forms = append(e.Forms, lexicon.Form{Text: "妳好"}) }},
		"a removed form":    {"mkgloss", func(e *lexicon.Entry) { e.Forms = e.Forms[:len(e.Forms)-1] }},
		"a removed reading": {"mkgloss", func(e *lexicon.Entry) { e.Readings = e.Readings[:len(e.Readings)-1] }},
		"a reading": {"mkgloss", func(e *lexicon.Entry) { e.Readings[0].Plain += "x" }},
		"a sense": {"mkgloss", func(e *lexicon.Entry) {
			for i := range e.Senses {
				e.Senses[i].Glosses = []string{"greetings"}
			}
		}},
	}
	for name, tc := range mutate {
		t.Run(name, func(t *testing.T) {
			sqlDB := newDB(t)
			alice := newUser(t, sqlDB, "alice")
			seedWorld(t, sqlDB)
			backdate(t, sqlDB)
			cursor := time.Now().UTC().Add(-time.Hour)
			nihao := lexID(t, sqlDB, "zh", "word", "你好")
			e, err := st(sqlDB).Get(ctx, nihao)
			if err != nil {
				t.Fatal(err)
			}
			tc.edit(e)
			if _, err := st(sqlDB).Put(ctx, e, dictID(t, sqlDB, tc.pack)); err != nil {
				t.Fatal(err)
			}
			d := mustPull(t, sqlDB, alice, cursor)
			if len(d.Entries) != 1 || d.Entries[0].ID != nihao {
				t.Fatalf("entries = %+v, want only 你好 (%d) after changing %s", d.Entries, nihao, name)
			}
			if len(d.Entries[0].Forms) == 0 || len(d.Entries[0].Readings) == 0 {
				t.Errorf("shipped entry lacks its children: %+v", d.Entries[0])
			}
		})
	}
}

func TestPullIncrementalNewEntryAndLink(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	seedWorld(t, sqlDB)
	backdate(t, sqlDB)
	cursor := time.Now().UTC().Add(-time.Hour)
	store := lexicon.Store{DB: sqlDB}

	id, err := store.Put(ctx, &lexicon.Entry{Language: "zh", Kind: "word", Key: "谢谢",
		Forms:    []lexicon.Form{{Text: "谢谢"}},
		Readings: []lexicon.Reading{{Type: "pinyin", Value: "xiè xie", Plain: "xie xie"}},
		Senses:   []lexicon.Sense{{Glosses: []string{"thanks"}}}}, dictID(t, sqlDB, "mkgloss"))
	if err != nil {
		t.Fatal(err)
	}
	d := mustPull(t, sqlDB, alice, cursor)
	if len(d.Entries) != 1 || d.Entries[0].ID != id || len(d.Senses) != 1 || d.Senses[0].EntryID != id || len(d.Links) != 0 {
		t.Fatalf("delta = %d entries %d senses %d links, want just the new entry and its sense", len(d.Entries), len(d.Senses), len(d.Links))
	}

	// A link-only change ships the link and no entry.
	backdate(t, sqlDB)
	if err := store.Link(ctx, id, lexID(t, sqlDB, "zh", "character", "好"), lexicon.LinkRadical); err != nil {
		t.Fatal(err)
	}
	d = mustPull(t, sqlDB, alice, cursor)
	if len(d.Links) != 1 || d.Links[0].Type != "radical" || len(d.Entries) != 0 {
		t.Errorf("delta = %+v, want only the new link", d)
	}
}

// Re-seeding unchanged packs leaves an up-to-date client nothing to
// download — through the real importers. (The dictionary and scheme
// registry rows themselves are re-stamped: one row each.)
func TestReseedShipsEmptyDelta(t *testing.T) {
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	seedWorld(t, sqlDB)
	backdate(t, sqlDB)
	seedWorld(t, sqlDB)

	d := mustPull(t, sqlDB, alice, time.Now().UTC().Add(-time.Hour))
	if n := len(d.Entries) + len(d.Links) + len(d.Senses) + len(d.LevelMembers) + len(d.Sentences) + len(d.Levels); n != 0 {
		t.Errorf("content re-sent after an unchanged re-seed: %+v", d)
	}
}

func TestPullShipsLexiconTombstones(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	seedWorld(t, sqlDB)
	first := mustPull(t, sqlDB, alice, time.Time{})
	backdate(t, sqlDB)

	if err := dict.Uninstall(ctx, sqlDB, dictID(t, sqlDB, "jm-mini")); err != nil {
		t.Fatal(err)
	}
	second := mustPull(t, sqlDB, alice, first.Cursor)
	if len(second.Senses) != 1 || second.Senses[0].DeletedAt == nil {
		t.Fatalf("senses = %+v, want the uninstalled dictionary's sense as a tombstone", second.Senses)
	}
	if len(second.Entries) != 0 {
		t.Errorf("entries re-sent after uninstall: %+v", second.Entries)
	}
	if len(second.Dictionaries) != 1 || second.Dictionaries[0].DeletedAt == nil {
		t.Errorf("dictionaries = %+v, want a tombstone", second.Dictionaries)
	}
	for _, s := range mustPull(t, sqlDB, alice, time.Time{}).Senses {
		if s.EntryID == lexID(t, sqlDB, "ja", "word", "学校") {
			t.Errorf("fresh pull shipped the uninstalled sense %+v", s)
		}
	}

	// A soft-deleted entry ships as a tombstone — except from the zero cursor.
	gakkou := lexID(t, sqlDB, "ja", "word", "学校")
	if _, err := sqlDB.Exec(`UPDATE lx_entries SET deleted_at = ?, updated_at = ? WHERE id = ?`,
		"2026-11-12T00:00:00Z", time.Now().UTC().Format(time.RFC3339), gakkou); err != nil {
		t.Fatal(err)
	}
	inc := mustPull(t, sqlDB, alice, time.Now().UTC().Add(-time.Hour))
	if len(inc.Entries) != 1 || inc.Entries[0].ID != gakkou || inc.Entries[0].DeletedAt == nil {
		t.Errorf("incremental entries = %+v, want the tombstone", inc.Entries)
	}
	if entryIDs(mustPull(t, sqlDB, alice, time.Time{}))[gakkou] {
		t.Error("fresh pull shipped a deleted entry")
	}
}

// inDelta reports whether the entry id is among the delta entries.
func inDelta(byID map[int64]chinsync.Entry, id int64) bool {
	_, ok := byID[id]
	return ok
}
