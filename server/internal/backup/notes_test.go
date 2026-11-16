package backup

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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

// The sample archive (with its own manifest, verbatim) carries a note on
// 1201 / 你好; restored onto a server where 你好 has another id, the note
// lands on that id.
func TestSampleArchiveNoteFollowsItsEntry(t *testing.T) {
	files := sampleFiles(t)
	files[NameManifest] = readSample(t, NameManifest)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, b := range files {
		if name == NameManifest {
			continue
		}
		w, _ := zw.Create(name)
		w.Write(b)
	}
	w, _ := zw.Create(NameManifest)
	w.Write(files[NameManifest])
	zw.Close()
	p := filepath.Join(t.TempDir(), "sample.zip")
	os.WriteFile(p, buf.Bytes(), 0o644)
	a, err := Open(p)
	if err != nil {
		t.Fatalf("the sample archive with its manifest does not open: %v", err)
	}
	defer a.Close()
	var tgE int64
	tg := newTarget(t, func(b *baseWorld) { tgE = mkEntry(t, b.DB, "zh", "word", "cc-1201", "你好") })
	if tgE == 1201 {
		t.Fatal("ids not shifted")
	}
	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{DropUnresolved: true}); err != nil {
		t.Fatal(err)
	}
	var key, data string
	if err := tg.DB.QueryRow(`SELECT key, data FROM plugin_data WHERE user_id = ? AND pack_id = 'qinqin-core' AND key LIKE 'note:%'`, tg.UID).Scan(&key, &data); err != nil {
		t.Fatalf("no restored note: %v", err)
	}
	if key != "note:"+strconv.FormatInt(tgE, 10) {
		t.Errorf("key %s, want note:%d", key, tgE)
	}
	if id, _ := intMember(json.RawMessage(data), "entryId"); id != tgE {
		t.Errorf("data %s", data)
	}
	// the sample's lookup history follows the entry and the restored book (#72)
	var book int64
	if err := tg.DB.QueryRow(`SELECT id FROM library_books WHERE user_id = ?`, tg.UID).Scan(&book); err != nil {
		t.Fatal(err)
	}
	if err := tg.DB.QueryRow(`SELECT data FROM plugin_data WHERE user_id = ? AND pack_id = 'qinqin-core' AND key = 'lookups'`, tg.UID).Scan(&data); err != nil {
		t.Fatalf("no restored lookup history: %v", err)
	}
	want := fmt.Sprintf(`{"version":1,"clearedAt":null,"items":[{"entryId":%d,"count":4,"firstAt":"2026-11-10T09:00:00Z","lastAt":"2026-11-14T08:00:00Z","sources":{"reader":3,"search":1},"books":[%d]}]}`, tgE, book)
	if data != want {
		t.Errorf("lookups %s\nwant %s", data, want)
	}
}

// docs/contracts/notes/note-rows.json: restoreKeeps says which note: rows a
// restore remaps (noteEntryID accepts them); the rest are dropped.
func TestNoteRowsFixtureRestoreKeeps(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/notes/note-rows.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Cases []struct {
			Name  string `json:"name"`
			Op    string `json:"op"`
			Input struct {
				Key  string          `json:"key"`
				Data json.RawMessage `json:"data"`
			} `json:"input"`
			Expect       json.RawMessage `json:"expect"`
			RestoreKeeps *bool           `json:"restoreKeeps"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, c := range fx.Cases {
		if c.Op != "note" || !strings.HasPrefix(c.Input.Key, noteKeyPrefix) {
			continue
		}
		if c.RestoreKeeps == nil {
			t.Errorf("%s: no restoreKeeps", c.Name)
			continue
		}
		n++
		r := PluginRow{PluginID: CorePlugin, Key: c.Input.Key, Data: c.Input.Data}
		id, ok := noteEntryID(r)
		if ok != *c.RestoreKeeps {
			t.Errorf("%s: noteEntryID ok=%v, fixture restoreKeeps=%v", c.Name, ok, *c.RestoreKeeps)
		}
		// every note the web reads is one a restore keeps, on the same entry
		if string(c.Expect) != "null" {
			var want struct {
				EntryID int64 `json:"entryId"`
			}
			json.Unmarshal(c.Expect, &want)
			if !*c.RestoreKeeps || id != want.EntryID {
				if c.Name != "data a JSON string of a valid object is decoded" {
					t.Errorf("%s: a readable note is not kept on its entry (id %d, want %d)", c.Name, id, want.EntryID)
				}
			}
		}
		// a kept row is dropped exactly when its entry is unresolved
		m := NewMaps()
		// with no entry map every note: row is dropped: a kept row because its
		// entry is unresolved, any other because it is not a note
		if _, drop := m.PluginRow(r); !drop {
			t.Errorf("%s: row kept without a resolvable entry", c.Name)
		}
		if *c.RestoreKeeps {
			m.Entries[id] = id + 1000
			if nr, drop := m.PluginRow(r); drop || nr.Key != "note:"+strconv.FormatInt(id+1000, 10) {
				t.Errorf("%s: kept row not remapped: drop=%v key=%s", c.Name, drop, nr.Key)
			}
		}
	}
	if n < 15 {
		t.Fatalf("only %d note: cases", n)
	}
}

// An invalid note row whose key names the target id of a valid note no
// longer collides with it: the dry run and the restore agree, the invalid
// row is dropped and counted (review finding).
func TestInvalidNoteCannotCollideWithARemappedNote(t *testing.T) {
	src := newWorld(t)
	tg := newTarget(t, nil)
	putNote(t, src, src.AliceUID, src.Alice.WS2, src.E2, "valid", false)
	exec(t, src.DB, `INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at)
		VALUES ('qinqin-core', ?, ?, ?, '{"version":1,"entryId":999999,"text":"evil"}', 1, '2026-11-11T08:00:00Z', NULL)`,
		src.AliceUID, src.Alice.WS2, fmt.Sprintf("note:%d", tg.E2))
	base, _, err := Plan(context.Background(), newTarget(t, nil).DB, openExport(t, newWorld(t), src.AliceUID), tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	a := openExport(t, src, src.AliceUID)
	rep, _, err := Plan(context.Background(), tg.DB, a, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Blocking) != 0 {
		t.Errorf("blocking %v", rep.Blocking)
	}
	// +1 valid note restored, +1 invalid row dropped
	if rep.Restores.PluginData != base.Restores.PluginData+1 || rep.Unresolved.DroppedRows != base.Unresolved.DroppedRows+1 {
		t.Errorf("restores %d (base %d), dropped %d (base %d)", rep.Restores.PluginData, base.Restores.PluginData, rep.Unresolved.DroppedRows, base.Unresolved.DroppedRows)
	}
	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{DropUnresolved: true}); err != nil {
		t.Fatalf("restore: %v", err)
	}
	var key, data string
	if err := tg.DB.QueryRow(`SELECT key, data FROM plugin_data WHERE user_id = ? AND pack_id = 'qinqin-core' AND key LIKE 'note:%'`, tg.UID).Scan(&key, &data); err != nil {
		t.Fatal(err)
	}
	if key != fmt.Sprintf("note:%d", tg.E2) || !strings.Contains(data, `"valid"`) {
		t.Errorf("restored %s %s", key, data)
	}
}

// A note: row without entryId is not restored verbatim onto whatever entry
// its key number names on the target (review finding).
func TestNoteWithoutEntryIDIsNotRestoredVerbatim(t *testing.T) {
	src := newWorld(t)
	tg := newTarget(t, nil)
	exec(t, src.DB, `INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at)
		VALUES ('qinqin-core', ?, ?, ?, '{"version":1,"text":"no entryId"}', 1, '2026-11-11T08:00:00Z', NULL)`,
		src.AliceUID, src.Alice.WS2, fmt.Sprintf("note:%d", src.E1))
	a := openExport(t, src, src.AliceUID)
	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{DropUnresolved: true}); err != nil {
		t.Fatal(err)
	}
	var n int
	tg.DB.QueryRow(`SELECT COUNT(*) FROM plugin_data WHERE user_id = ? AND pack_id = 'qinqin-core' AND key LIKE 'note:%'`, tg.UID).Scan(&n)
	if n != 0 {
		t.Errorf("%d note rows restored, want 0", n)
	}
}
