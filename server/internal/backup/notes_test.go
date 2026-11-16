package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"testing"
	"time"
)

// putNote stores a qinqin-core note row note:<entry> for uid in ws.
func putNote(t *testing.T, w *baseWorld, uid, ws, entry int64, text string, deleted bool) {
	t.Helper()
	var del any
	if deleted {
		del = "2026-11-12T00:00:00Z"
	}
	data, _ := json.Marshal(map[string]any{"version": 1, "entryId": entry, "text": text})
	exec(t, w.DB, `INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at, deleted_at)
		VALUES ('qinqin-core', ?, ?, ?, ?, 1, '2026-11-11T08:00:00Z', '2026-11-11T07:59:00Z', ?)`,
		uid, ws, fmt.Sprintf("note:%d", entry), string(data), del)
}

func refEntryIDs(t *testing.T, files map[string][]byte) map[int64]bool {
	t.Helper()
	var refs []EntryRef
	strictDecode(t, files[NameRefEntries], &refs)
	out := map[int64]bool{}
	for _, r := range refs {
		out[r.ID] = true
	}
	return out
}

// A note names its entry in refs/entries.json even when no card or overlay
// does; a tombstoned note is not exported and adds no ref; another user's
// note never appears.
func TestExportNotesAndTheirEntryRefs(t *testing.T) {
	w := newWorld(t)
	horse := mkEntry(t, w.DB, "zh", "word", "cc-ma", "马")
	gone := mkEntry(t, w.DB, "zh", "word", "cc-gone", "去")
	bobs := mkEntry(t, w.DB, "zh", "word", "cc-bob", "鲍")
	putNote(t, w, w.AliceUID, w.Alice.WS1, horse, "Horse: four dots.\n<b>x</b>", false)
	putNote(t, w, w.AliceUID, w.Alice.WS1, gone, "deleted", true)
	putNote(t, w, w.BobID, w.Bob.WS1, bobs, "bob's", false)

	data, man := exportBytes(t, w, w.AliceUID)
	files, _ := unzipAll(t, data)
	refs := refEntryIDs(t, files)
	if !refs[horse] {
		t.Errorf("the note's entry %d is not in refs/entries.json: %v", horse, refs)
	}
	if refs[gone] || refs[bobs] {
		t.Errorf("a tombstoned or foreign note added a ref: %v", refs)
	}
	var notes []PluginRow
	for _, l := range lines(files[PartName(NamePluginData, 1)]) {
		var r PluginRow
		strictDecode(t, []byte(l), &r)
		if r.PluginID == CorePlugin {
			notes = append(notes, r)
		}
	}
	if len(notes) != 1 || notes[0].Key != "note:"+strconv.FormatInt(horse, 10) || *notes[0].WorkspaceID != w.Alice.WS1 {
		t.Fatalf("exported core rows %+v", notes)
	}
	if id, _ := intMember(notes[0].Data, "entryId"); id != horse {
		t.Errorf("entryId %d", id)
	}
	if man.Counts["pluginData"] != 6 {
		t.Errorf("pluginData count %d, want 6", man.Counts["pluginData"])
	}
}

// The dry run reports a note of a word the target lacks under that entry's
// notes and counts it as dropped; the restore leaves it out.
func TestPlanReportsNotesOfUnresolvedEntries(t *testing.T) {
	w := newWorld(t)
	tg := newTarget(t, nil) // has 你好 and 世界, not 马
	baseRep, _, err := Plan(context.Background(), tg.DB, openExport(t, w, w.AliceUID), tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	horse := mkEntry(t, w.DB, "zh", "word", "cc-ma", "马")
	putNote(t, w, w.AliceUID, w.Alice.WS1, horse, "Horse", false)
	a := openExport(t, w, w.AliceUID)
	rep, _, err := Plan(context.Background(), tg.DB, a, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	var found *UnresolvedEntry
	for i := range rep.Unresolved.Entries {
		if rep.Unresolved.Entries[i].Written == "马" {
			found = &rep.Unresolved.Entries[i]
		}
	}
	if found == nil || found.Notes != 1 || found.Cards != 0 || found.Overlays != 0 {
		t.Fatalf("unresolved entries %+v", rep.Unresolved.Entries)
	}
	if rep.Unresolved.DroppedRows != baseRep.Unresolved.DroppedRows+1 {
		t.Errorf("dropped rows %d, want %d + 1", rep.Unresolved.DroppedRows, baseRep.Unresolved.DroppedRows)
	}
	if rep.Restores.PluginData != baseRep.Restores.PluginData || len(rep.Blocking) != 0 {
		t.Errorf("restores %+v blocking %v", rep.Restores, rep.Blocking)
	}
	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{DropUnresolved: true}); err != nil {
		t.Fatal(err)
	}
	var n int
	tg.DB.QueryRow(`SELECT COUNT(*) FROM plugin_data WHERE user_id = ? AND pack_id = 'qinqin-core'`, tg.UID).Scan(&n)
	if n != 0 {
		t.Errorf("%d core rows restored, want 0", n)
	}
}

// A restored note follows its entry onto a server with other entry ids:
// new key and entryId, updated_at = now, modified_at kept; the text and the
// workspace (by name) are the same.
func TestRestoreNoteOntoShiftedEntryIds(t *testing.T) {
	src := newWorld(t)
	putNote(t, src, src.AliceUID, src.Alice.WS2, src.E2, "World\nline two", false)
	a := openExport(t, src, src.AliceUID)
	tg := newTarget(t, nil)
	if tg.E2 == src.E2 {
		t.Fatal("ids not shifted")
	}
	exec(t, tg.DB, `INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (?, 'tatoeba', NULL, 'packsatz', 'p', 't', 't')`, tg.E2)
	before := time.Now().UTC().Add(-time.Minute)
	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{}); err != nil {
		t.Fatal(err)
	}
	var key, data, updated, wsName string
	var modified *string
	if err := tg.DB.QueryRow(`SELECT p.key, p.data, p.updated_at, p.modified_at, w.name FROM plugin_data p JOIN workspaces w ON w.id = p.workspace_id
		WHERE p.user_id = ? AND p.pack_id = 'qinqin-core'`, tg.UID).Scan(&key, &data, &updated, &modified, &wsName); err != nil {
		t.Fatal(err)
	}
	if key != "note:"+strconv.FormatInt(tg.E2, 10) || wsName != "JP" {
		t.Errorf("key %s workspace %q", key, wsName)
	}
	var got struct {
		Version int    `json:"version"`
		EntryID int64  `json:"entryId"`
		Text    string `json:"text"`
	}
	json.Unmarshal([]byte(data), &got)
	if got.Version != 1 || got.EntryID != tg.E2 || got.Text != "World\nline two" {
		t.Errorf("data %s", data)
	}
	if modified == nil || *modified != "2026-11-11T07:59:00Z" {
		t.Errorf("modified_at %v", modified)
	}
	if ts, err := time.Parse(time.RFC3339Nano, updated); err != nil || ts.Before(before) {
		t.Errorf("updated_at %q is not now", updated)
	}
}
