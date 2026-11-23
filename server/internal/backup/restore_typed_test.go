package backup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

// The committed sample-v1 manifest lists every file with its exact size
// and SHA-256 (the files were extended by hand for the typed families).
func TestSampleManifestMatchesItsFiles(t *testing.T) {
	var m Manifest
	strictDecode(t, readSample(t, NameManifest), &m)
	files := sampleFiles(t)
	if len(m.Files) != len(files) {
		t.Errorf("manifest lists %d files, the sample has %d", len(m.Files), len(files))
	}
	for _, f := range m.Files {
		b, ok := files[f.Name]
		if !ok {
			t.Errorf("%s listed but missing", f.Name)
			continue
		}
		sum := sha256.Sum256(b)
		if int64(len(b)) != f.Bytes || hex.EncodeToString(sum[:]) != f.SHA256 {
			t.Errorf("%s: %d bytes %s, manifest %d %s", f.Name, len(b), hex.EncodeToString(sum[:]), f.Bytes, f.SHA256)
		}
	}
}

// sampleTarget is a server holding the sample's dictionary entry under a
// different id, and a user to restore into.
func sampleTarget(t *testing.T) (*targetWorld, int64) {
	t.Helper()
	tg := newTarget(t, func(b *baseWorld) {})
	entry := mkEntry(t, tg.DB, "zh", "word", "cc-1201", "你好")
	if entry == 1201 {
		t.Fatal("entry ids not shifted")
	}
	return tg, entry
}

// Restoring the v1 sample lands every typed family in its table: workspace
// ids and derived card ids remapped (remap.json), version and modifiedAt
// kept, review events following their cards; plugin_data keeps only the
// keyed rows.
func TestRestoreSampleV1IntoTypedTables(t *testing.T) {
	a, err := Open(writeZip(t, sampleFiles(t), zopts{}))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	tg, entry := sampleTarget(t)
	res, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{})
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}
	var zh, ja int64
	tg.DB.QueryRow(`SELECT id FROM workspaces WHERE user_id = ? AND language = 'zh'`, tg.UID).Scan(&zh)
	tg.DB.QueryRow(`SELECT id FROM workspaces WHERE user_id = ? AND language = 'ja'`, tg.UID).Scan(&ja)
	if zh == 0 || zh == 7 {
		t.Fatalf("zh workspace %d", zh)
	}
	e := func(s string) string { return strings.ReplaceAll(s, "E", itoa(int(entry))) }
	count := func(q string, args ...any) int {
		var n int
		if err := tg.DB.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		return n
	}
	// cards: derived ids follow the entry; the sentence card keeps its ULID id
	for _, c := range []struct {
		id      string
		ws      int64
		version int
		mod     string
	}{
		{e("c-vocab-E"), zh, 1, "2026-11-10T08:00:00Z"},
		{e("c-reverse-E"), zh, 1, "2026-11-10T08:00:00Z"}, // modifiedAt null in the archive: the row's updatedAt
		{"s-01JD0000000000000000000S1", ja, 2, "2026-11-12T07:00:00Z"},
	} {
		var ws, entryID int64
		var version int
		var mod, upd string
		if err := tg.DB.QueryRow(`SELECT workspace_id, entry_id, version, modified_at, updated_at FROM study_cards WHERE user_id = ? AND id = ?`, tg.UID, c.id).
			Scan(&ws, &entryID, &version, &mod, &upd); err != nil {
			t.Errorf("card %s: %v", c.id, err)
			continue
		}
		if ws != c.ws || entryID != entry || version != c.version || mod != c.mod || upd < "2026-11-16" {
			t.Errorf("card %s: ws %d entry %d version %d modified %s updated %s", c.id, ws, entryID, version, mod, upd)
		}
	}
	// the other five families, each once, in the zh workspace
	for table, want := range map[string]int{"study_decks": 1, "study_deck_settings": 1, "study_limits": 2, "study_fsrs_sets": 1, "study_fsrs_active": 1} {
		if n := count(`SELECT COUNT(*) FROM `+table+` WHERE user_id = ? AND workspace_id = ? AND deleted_at IS NULL`, tg.UID, zh); n != want {
			t.Errorf("%s: %d rows, want %d", table, n, want)
		}
	}
	var newOrder, cardTypes, mod string
	var version int
	tg.DB.QueryRow(`SELECT new_order, card_types, version, modified_at FROM study_deck_settings WHERE user_id = ?`, tg.UID).Scan(&newOrder, &cardTypes, &version, &mod)
	if newOrder != `{"by":"frequency"}` || cardTypes != `["reverse"]` || version != 2 || mod != "2026-11-10T08:05:00Z" {
		t.Errorf("deck settings: newOrder %s cardTypes %s version %d modified %s", newOrder, cardTypes, version, mod)
	}
	var setID string
	tg.DB.QueryRow(`SELECT set_id FROM study_fsrs_active WHERE user_id = ?`, tg.UID).Scan(&setID)
	if setID != "01JD00000000000000000FS01" {
		t.Errorf("active set %q", setID)
	}
	var limits []string
	rs, _ := tg.DB.Query(`SELECT deck_id || ' ' || new_set || ' ' || IFNULL(new_limit, 'null') || ' ' || reviews_set || ' ' || IFNULL(reviews_limit, 'null') FROM study_limits WHERE user_id = ? ORDER BY deck_id`, tg.UID)
	for rs.Next() {
		var l string
		rs.Scan(&l)
		limits = append(limits, l)
	}
	rs.Close()
	if strings.Join(limits, ",") != " 1 15 1 null,general 1 5 0 null" {
		t.Errorf("limits rows %q", limits)
	}
	// plugin_data holds no typed family; the keyed rows are there
	if n := count(`SELECT COUNT(*) FROM plugin_data WHERE user_id = ? AND pack_id = 'qinqin-flashcards' AND key NOT LIKE 'vacation:%'`, tg.UID); n != 0 {
		t.Errorf("%d typed-family rows in plugin_data", n)
	}
	if n := count(`SELECT COUNT(*) FROM plugin_data WHERE user_id = ?`, tg.UID); n != 3 {
		t.Errorf("plugin_data rows %d, want the lookups, note and vacation rows", n)
	}
	// review events follow the remapped card ids
	if n := count(`SELECT COUNT(*) FROM study_events WHERE user_id = ? AND payload LIKE ?`, tg.UID, `%"cardId":"`+e("c-reverse-E")+`"%`); n != 1 {
		t.Errorf("review of the reverse card: %d", n)
	}
	if res.Restored.PluginData != 12 || res.Restored.Cards != 3 || res.DroppedRows != 0 {
		t.Errorf("restored %+v dropped %d", res.Restored, res.DroppedRows)
	}
}

// A typed-family row the codec cannot read is dropped and counted, in the
// dry-run report and in the restore; the rest restores.
func TestRestoreDropsUnreadableTypedRows(t *testing.T) {
	files := sampleFiles(t)
	bad := []string{
		`{"pluginId":"qinqin-flashcards","workspaceId":7,"key":"card:c-bad","data":{"id":"c-bad","kind":"vocab","entryId":1201,"deckIds":[]},"version":1,"updatedAt":"2026-11-10T08:00:00Z","modifiedAt":null}`,
		`{"pluginId":"qinqin-flashcards","workspaceId":8,"key":"limits:workspace","data":{"version":2},"version":1,"updatedAt":"2026-11-10T08:00:00Z","modifiedAt":null}`,
		`{"pluginId":"qinqin-flashcards","workspaceId":null,"key":"deck:global","data":{"id":"global","name":"x","createdAt":"t"},"version":1,"updatedAt":"2026-11-10T08:00:00Z","modifiedAt":null}`,
	}
	name := PartName(NamePluginData, 1)
	files[name] = append(files[name], []byte(strings.Join(bad, "\n")+"\n")...)
	a, err := Open(writeZip(t, files, zopts{manifest: func(m map[string]any) {
		m["counts"].(map[string]any)["pluginData"] = 12 + len(bad)
	}}))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	tg, _ := sampleTarget(t)
	rep, _, err := Plan(context.Background(), tg.DB, a, tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Unresolved.DroppedRows != len(bad) || rep.Restores.PluginData != 12 || rep.Restores.Cards != 3 {
		t.Errorf("dry run: dropped %d, restores %+v", rep.Unresolved.DroppedRows, rep.Restores)
	}
	res, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if res.DroppedRows != len(bad) || res.Restored.PluginData != 12 {
		t.Errorf("restore: dropped %d, restored %+v", res.DroppedRows, res.Restored)
	}
	var n int
	tg.DB.QueryRow(`SELECT (SELECT COUNT(*) FROM study_cards WHERE id = 'c-bad') + (SELECT COUNT(*) FROM plugin_data WHERE key IN ('card:c-bad', 'deck:global', 'limits:workspace'))
		+ (SELECT COUNT(*) FROM study_decks WHERE id = 'global')`).Scan(&n)
	if n != 0 {
		t.Errorf("%d unreadable rows were stored", n)
	}
}

// Ruling (#198 review, N1): plugin states and plugin data under a data
// pack's id (left from when packs had synthesized plugin rows) are inert
// rows; an archive carrying them restores, and the report lists the id
// among the plugins not installed, as for any unknown plugin.
func TestRestoreKeepsDataPackPluginRowsInert(t *testing.T) {
	files := sampleFiles(t)
	var acc map[string]any
	if err := json.Unmarshal(files[NameAccount], &acc); err != nil {
		t.Fatal(err)
	}
	acc["pluginStates"] = append(acc["pluginStates"].([]any), map[string]any{"pluginId": "zh-grammar", "enabled": false, "order": 3})
	files[NameAccount], _ = json.Marshal(acc)
	part := PartName(NamePluginData, 1)
	files[part] = append(files[part], []byte(`{"pluginId":"zh-grammar","workspaceId":null,"key":"k","data":{},"version":1,"updatedAt":"2026-11-10T08:00:00Z","modifiedAt":null}`+"\n")...)
	a, err := Open(writeZip(t, files, zopts{manifest: func(m map[string]any) {
		c := m["counts"].(map[string]any)
		c["pluginData"] = c["pluginData"].(float64) + 1
	}}))
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	tg, _ := sampleTarget(t)
	res, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{})
	if err != nil {
		t.Fatalf("Restore: %v (%+v)", err, res)
	}
	var n int
	tg.DB.QueryRow(`SELECT (SELECT COUNT(*) FROM plugin_states WHERE user_id = ?1 AND pack_id = 'zh-grammar') +
		(SELECT COUNT(*) FROM plugin_data WHERE user_id = ?1 AND pack_id = 'zh-grammar')`, tg.UID).Scan(&n)
	if n != 2 {
		t.Errorf("data-pack plugin rows restored: %d, want 2 (inert)", n)
	}
}
