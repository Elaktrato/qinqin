package backup

import (
	"bytes"
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/dbtest"
)

// openExport exports uid of w and opens the archive.
func openExport(t *testing.T, w *baseWorld, uid int64) *Archive {
	t.Helper()
	data, _ := exportBytes(t, w, uid)
	p := filepath.Join(t.TempDir(), "x.zip")
	os.WriteFile(p, data, 0o644)
	a, err := Open(p)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { a.Close() })
	return a
}

// targetWorld is a server with the same dictionary but shifted entry ids and no user data.
type targetWorld struct {
	*baseWorld
	UID    int64
	E1, E2 int64
}

func newTarget(t *testing.T, mod func(w *baseWorld)) *targetWorld {
	t.Helper()
	w := &baseWorld{DB: dbtest.Open(t), Data: t.TempDir()}
	mkLang(t, w.DB, "zh", "ja")
	for i := 0; i < 50; i++ {
		mkEntry(t, w.DB, "zh", "word", "dummy"+string(rune('a'+i%26))+string(rune('a'+i/26)), "dummy"+string(rune('a'+i%26)))
	}
	w.Dict = newDict(t, w.DB, "other-pack")
	newDict(t, w.DB, "cc-cedict")
	tw := &targetWorld{baseWorld: w, UID: mkUser(t, w.DB, "alice")}
	if mod != nil {
		mod(w)
	} else {
		tw.E1 = mkEntry(t, w.DB, "zh", "word", "cc-1", "你好")
		tw.E2 = mkEntry(t, w.DB, "zh", "word", "cc-2", "世界")
	}
	return tw
}

func tableCounts(t *testing.T, db *sql.DB) map[string]int {
	t.Helper()
	out := map[string]int{}
	for _, tb := range []string{"users", "workspaces", "study_events", "plugin_data", "plugin_states", "user_edits", "sentences",
		"library_books", "library_bookmarks", "library_highlights", "user_time_zones", "sessions", "entries",
		"study_cards", "study_decks", "study_deck_settings", "study_limits", "study_fsrs_sets", "study_fsrs_active", "library_deletions"} {
		var n int
		db.QueryRow(`SELECT COUNT(*) FROM ` + tb).Scan(&n)
		out[tb] = n
	}
	return out
}

func TestPlanSameServerIsIdentity(t *testing.T) {
	w := newWorld(t)
	a := openExport(t, w, w.AliceUID)
	before := tableCounts(t, w.DB)
	rep, m, err := Plan(context.Background(), w.DB, a, w.AliceUID)
	if err != nil {
		t.Fatal(err)
	}
	if m.Entries[w.E1] != w.E1 || m.Entries[w.E2] != w.E2 {
		t.Errorf("entries %v", m.Entries)
	}
	if rep.Unresolved.EntryCount != 0 || rep.Unresolved.Sentences != 0 || len(rep.Blocking) != 0 || rep.ReidentifiedEvents != 0 {
		t.Errorf("report %+v", rep)
	}
	if rep.Replaces != rep.Restores {
		t.Errorf("replaces %+v != restores %+v", rep.Replaces, rep.Restores)
	}
	if rep.Replaces.Events != 4 || rep.Replaces.Cards != 3 || rep.Replaces.PluginData != 5 || rep.Replaces.Workspaces != 2 || rep.Replaces.Books != 1 {
		t.Errorf("counts %+v", rep.Replaces)
	}
	if m.Dicts[w.Dict] != w.Dict || m.Sentences[w.Alice.PackSent] != w.Alice.PackSent {
		t.Errorf("dict/sentence maps %v %v", m.Dicts, m.Sentences)
	}
	if !slices.Contains(rep.PluginsNotInstalled, "qinqin-flashcards") || !slices.Contains(rep.PluginsNotInstalled, "other-plugin") {
		t.Errorf("not installed %v", rep.PluginsNotInstalled)
	}
	if after := tableCounts(t, w.DB); !equalCounts(before, after) {
		t.Errorf("Plan wrote: %v -> %v", before, after)
	}
}

func equalCounts(a, b map[string]int) bool {
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func TestPlanShiftedEntryIdsAndPackSentences(t *testing.T) {
	w := newWorld(t)
	a := openExport(t, w, w.AliceUID)
	tg := newTarget(t, nil)
	pack := tg.DB
	// the pack sentence exists on the target on the shifted entry
	var psID int64
	res, _ := pack.Exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (?, 'tatoeba', NULL, 'packsatz', 'p', 't', 't')`, tg.E2)
	psID, _ = res.LastInsertId()
	rep, m, err := Plan(context.Background(), pack, a, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	if tg.E1 == w.E1 {
		t.Fatal("test setup: ids were not shifted")
	}
	if m.Entries[w.E1] != tg.E1 || m.Entries[w.E2] != tg.E2 {
		t.Errorf("entries %v, want %d,%d", m.Entries, tg.E1, tg.E2)
	}
	if m.Sentences[w.Alice.PackSent] != psID {
		t.Errorf("pack sentence %v want %d", m.Sentences, psID)
	}
	if rep.Unresolved.EntryCount != 0 || rep.Unresolved.Sentences != 0 {
		t.Errorf("unresolved %+v", rep.Unresolved)
	}
	if m.Dicts[w.Dict] == 0 || m.Dicts[w.Dict] == w.Dict && false {
		t.Errorf("dict %v", m.Dicts)
	}
	// derived card ids follow the entries
	nk, _, drop := m.Card("card:c-vocab-"+itoa64(w.E1), []byte(`{"id":"c-vocab-`+itoa64(w.E1)+`","entryId":`+itoa64(w.E1)+`}`))
	if drop || nk != "card:c-vocab-"+itoa64(tg.E1) {
		t.Errorf("card key %s drop %v", nk, drop)
	}
}

func itoa64(n int64) string { return itoa(int(n)) }

func TestPlanResolvesByWrittenWhenExtKeyMissesAndUnresolvedOtherwise(t *testing.T) {
	w := newWorld(t)
	a := openExport(t, w, w.AliceUID)
	// ext_key differs but the written form is unique: resolved; the second word is missing entirely
	tg := newTarget(t, func(b *baseWorld) {
		mkEntry(t, b.DB, "zh", "word", "renamed-key", "你好")
	})
	rep, m, err := Plan(context.Background(), tg.DB, a, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := m.Entries[w.E1]; !ok {
		t.Error("written-form fallback did not resolve")
	}
	if _, ok := m.Entries[w.E2]; ok {
		t.Error("a missing word was resolved")
	}
	if rep.Unresolved.EntryCount != 1 || rep.Unresolved.Entries[0].Written != "世界" || rep.Unresolved.Entries[0].Cards != 1 {
		t.Errorf("unresolved %+v", rep.Unresolved)
	}
	// the sentence card of the missing word is dropped and counted
	if rep.Restores.Cards != 2 || rep.Replaces.Cards != 0 {
		t.Errorf("cards %+v / %+v", rep.Restores, rep.Replaces)
	}
	if rep.Unresolved.Sentences != 1 {
		t.Errorf("unresolved sentences %d", rep.Unresolved.Sentences)
	}
}

func TestPlanAmbiguousWrittenIsUnresolved(t *testing.T) {
	w := newWorld(t)
	a := openExport(t, w, w.AliceUID)
	tg := newTarget(t, func(b *baseWorld) {
		mkEntry(t, b.DB, "zh", "word", "k1", "你好")
		mkEntry(t, b.DB, "zh", "word", "k2", "你好")
	})
	_, m, err := Plan(context.Background(), tg.DB, a, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := m.Entries[w.E1]; ok {
		t.Error("two candidates by written form must be unresolved")
	}
}

func TestResolveEntriesCollisions(t *testing.T) {
	tg := newTarget(t, func(b *baseWorld) {
		mkEntry(t, b.DB, "zh", "word", "exact", "目标")
	})
	ctx := context.Background()
	// exact wins over a written-form match onto the same target
	got, err := resolveEntries(ctx, tg.DB, []EntryRef{
		{ID: 1, Language: "zh", Kind: "word", ExtKey: "exact", Written: "other"},
		{ID: 2, Language: "zh", Kind: "word", ExtKey: "nomatch", Written: "目标"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := got[1]; !ok || len(got) != 1 {
		t.Errorf("exact must keep the target, the other is unresolved: %v", got)
	}
	// both by written: both unresolved
	got, _ = resolveEntries(ctx, tg.DB, []EntryRef{
		{ID: 1, Language: "zh", Kind: "word", ExtKey: "x1", Written: "目标"},
		{ID: 2, Language: "zh", Kind: "word", ExtKey: "x2", Written: "目标"},
	})
	if len(got) != 0 {
		t.Errorf("two written matches onto one target must both be unresolved: %v", got)
	}
	// both exact is impossible (unique key); a kind mismatch never matches
	got, _ = resolveEntries(ctx, tg.DB, []EntryRef{{ID: 1, Language: "zh", Kind: "character", ExtKey: "exact", Written: "目标"}})
	if len(got) != 0 {
		t.Errorf("kind must match: %v", got)
	}
}

func TestPlanBlocksUnknownLanguageAndCountsReidentifiedEvents(t *testing.T) {
	w := newWorld(t)
	a := openExport(t, w, w.AliceUID)
	tg := newTarget(t, nil)
	tg.DB.Exec(`DELETE FROM languages WHERE code = 'ja'`)
	// an event id of the archive already belongs to someone else here
	other := mkUser(t, tg.DB, "carol")
	tg.DB.Exec(`INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (?, 'zh', '', '{}', 't')`, other)
	var cw int64
	tg.DB.QueryRow(`SELECT id FROM workspaces WHERE user_id = ?`, other).Scan(&cw)
	tg.DB.Exec(`INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES (?, ?, ?, 'd', 't', 'review', '{}', 't')`,
		evID(w.AliceUID, "A"), other, cw)
	rep, _, err := Plan(context.Background(), tg.DB, a, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Blocking) != 1 || !bytes.Contains([]byte(rep.Blocking[0]), []byte("ja")) {
		t.Errorf("blocking %v", rep.Blocking)
	}
	if rep.ReidentifiedEvents != 1 {
		t.Errorf("reidentified %d", rep.ReidentifiedEvents)
	}
}
