package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"testing"
)

// putKnown stores a qinqin-flashcards known mark known:<entry> for uid in ws.
func putKnown(t *testing.T, w *baseWorld, uid, ws, entry int64, deleted bool) {
	t.Helper()
	var del any
	if deleted {
		del = "2026-11-12T00:00:00Z"
	}
	data, _ := json.Marshal(map[string]any{"version": 1, "entryId": entry, "createdAt": "2026-11-11T07:59:00.000Z"})
	exec(t, w.DB, `INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at, deleted_at)
		VALUES ('qinqin-flashcards', ?, ?, ?, ?, 1, '2026-11-11T08:00:00Z', '2026-11-11T07:59:00Z', ?)`,
		uid, ws, fmt.Sprintf("known:%d", entry), string(data), del)
}

func flashRow(ws int64, key, data, updated string) PluginRow {
	w := ws
	return PluginRow{PluginID: FlashcardsPlugin, WorkspaceID: &w, Key: key, Data: json.RawMessage(data), Version: 1, UpdatedAt: updated}
}

// A live mark names its entry in refs/entries.json; a tombstoned one is not
// exported and adds no ref.
func TestExportKnownMarksAndTheirEntryRefs(t *testing.T) {
	w := newWorld(t)
	horse := mkEntry(t, w.DB, "zh", "word", "cc-ma", "马")
	gone := mkEntry(t, w.DB, "zh", "word", "cc-gone", "去")
	putKnown(t, w, w.AliceUID, w.Alice.WS1, horse, false)
	putKnown(t, w, w.AliceUID, w.Alice.WS1, gone, true)
	data, _ := exportBytes(t, w, w.AliceUID)
	files, _ := unzipAll(t, data)
	refs := refEntryIDs(t, files)
	if !refs[horse] {
		t.Errorf("the mark's entry %d is not in refs/entries.json: %v", horse, refs)
	}
	if refs[gone] {
		t.Errorf("a tombstoned mark added a ref: %v", refs)
	}
}

// The dry run counts a mark of a word the target lacks as dropped; the
// restore leaves it out; a mark of a resolved word follows its entry.
func TestPlanAndRestoreKnownMarks(t *testing.T) {
	src := newWorld(t)
	tg := newTarget(t, nil) // has 你好 and 世界, not 马
	baseRep, _, err := Plan(context.Background(), tg.DB, openExport(t, src, src.AliceUID), tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	horse := mkEntry(t, src.DB, "zh", "word", "cc-ma", "马")
	putKnown(t, src, src.AliceUID, src.Alice.WS1, horse, false)
	putKnown(t, src, src.AliceUID, src.Alice.WS1, src.E2, false)
	a := openExport(t, src, src.AliceUID)
	rep, _, err := Plan(context.Background(), tg.DB, a, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Unresolved.DroppedRows != baseRep.Unresolved.DroppedRows+1 {
		t.Errorf("dropped rows %d, want %d + 1", rep.Unresolved.DroppedRows, baseRep.Unresolved.DroppedRows)
	}
	if rep.Restores.PluginData != baseRep.Restores.PluginData+1 || len(rep.Blocking) != 0 {
		t.Errorf("restores %+v (base %+v) blocking %v", rep.Restores, baseRep.Restores, rep.Blocking)
	}
	if tg.E2 == src.E2 {
		t.Fatal("ids not shifted")
	}
	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{DropUnresolved: true}); err != nil {
		t.Fatal(err)
	}
	rs, err := tg.DB.Query(`SELECT key, data FROM plugin_data WHERE user_id = ? AND pack_id = 'qinqin-flashcards' AND key LIKE 'known:%'`, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Close()
	var keys []string
	for rs.Next() {
		var k, d string
		rs.Scan(&k, &d)
		keys = append(keys, k)
		if id, _ := intMember(json.RawMessage(d), "entryId"); "known:"+strconv.FormatInt(id, 10) != k {
			t.Errorf("row %s data %s", k, d)
		}
	}
	if len(keys) != 1 || keys[0] != "known:"+strconv.FormatInt(tg.E2, 10) {
		t.Errorf("restored marks %v, want [known:%d]", keys, tg.E2)
	}
}

// An invalid known: row is dropped on restore and counted, never kept verbatim.
func TestInvalidKnownRowIsDroppedAndCounted(t *testing.T) {
	src := newWorld(t)
	tg := newTarget(t, nil)
	base, _, err := Plan(context.Background(), tg.DB, openExport(t, src, src.AliceUID), tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	exec(t, src.DB, `INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at)
		VALUES ('qinqin-flashcards', ?, ?, ?, ?, 1, '2026-11-11T08:00:00Z', NULL)`,
		src.AliceUID, src.Alice.WS2, fmt.Sprintf("known:%d", src.E1), fmt.Sprintf(`{"version":1,"entryId":"%d"}`, src.E1))
	a := openExport(t, src, src.AliceUID)
	rep, _, err := Plan(context.Background(), tg.DB, a, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Unresolved.DroppedRows != base.Unresolved.DroppedRows+1 {
		t.Errorf("dry run dropped %d, want %d + 1", rep.Unresolved.DroppedRows, base.Unresolved.DroppedRows)
	}
	res, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{DropUnresolved: true})
	if err != nil {
		t.Fatal(err)
	}
	var n int
	tg.DB.QueryRow(`SELECT COUNT(*) FROM plugin_data WHERE user_id = ? AND key LIKE 'known:%'`, tg.UID).Scan(&n)
	if n != 0 {
		t.Errorf("%d known rows restored, want 0", n)
	}
	if res.DroppedRows < 1 {
		t.Errorf("restore dropped %d rows", res.DroppedRows)
	}
}

// Two archive marks landing on one target keep one row (the newest), never
// a blocking collision; a note and a mark on the same entry never compete.
func TestKnownMarkCollisionKeepsOne(t *testing.T) {
	m := NewMaps()
	m.Workspaces[7] = 70
	m.Entries[1], m.Entries[2] = 500, 500
	a := flashRow(7, "known:1", `{"version":1,"entryId":1}`, "2026-11-05T00:00:00Z")
	b := flashRow(7, "known:2", `{"version":1,"entryId":2}`, "2026-11-06T00:00:00Z")
	n := coreNote(7, "note:1", `{"version":1,"entryId":1,"text":"a"}`, "2026-11-07T00:00:00Z", nil)
	for _, r := range []PluginRow{a, b, n} {
		m.RegisterNote(r)
	}
	if _, drop := m.PluginRow(a); !drop {
		t.Error("the older mark was kept")
	}
	if nr, drop := m.PluginRow(b); drop || nr.Key != "known:500" {
		t.Errorf("newest mark: drop=%v key=%s", drop, nr.Key)
	}
	if nr, drop := m.PluginRow(n); drop || nr.Key != "note:500" {
		t.Errorf("note: drop=%v key=%s", drop, nr.Key)
	}
}
