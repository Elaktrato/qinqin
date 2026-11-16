package backup

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

// putLookups stores a qinqin-core lookups row for uid in ws.
func putLookups(t *testing.T, w *baseWorld, uid, ws int64, data string, deleted bool) {
	t.Helper()
	var del any
	if deleted {
		del = "2026-11-12T00:00:00Z"
	}
	exec(t, w.DB, `INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at, deleted_at)
		VALUES ('qinqin-core', ?, ?, 'lookups', ?, 1, '2026-11-11T08:00:00Z', NULL, ?)`, uid, ws, data, del)
}

func lookupsJSON(items ...string) string {
	return `{"version":1,"clearedAt":null,"items":[` + joinComma(items) + `]}`
}

func joinComma(s []string) string {
	out := ""
	for i, x := range s {
		if i > 0 {
			out += ","
		}
		out += x
	}
	return out
}

func lookupItemJSON(entry, book int64, lastAt string) string {
	books := "[]"
	if book > 0 {
		books = fmt.Sprintf("[%d]", book)
	}
	return fmt.Sprintf(`{"entryId":%d,"count":3,"firstAt":"2026-11-01T09:00:00Z","lastAt":%q,"sources":{"reader":3},"books":%s}`, entry, lastAt, books)
}

// The history's entries are named in refs/entries.json; a tombstoned row is
// not exported and adds no ref; another user's row never appears.
func TestExportLookupsAndTheirEntryRefs(t *testing.T) {
	w := newWorld(t)
	horse := mkEntry(t, w.DB, "zh", "word", "cc-ma", "马")
	gone := mkEntry(t, w.DB, "zh", "word", "cc-gone", "去")
	bobs := mkEntry(t, w.DB, "zh", "word", "cc-bob", "鲍")
	putLookups(t, w, w.AliceUID, w.Alice.WS1, lookupsJSON(lookupItemJSON(horse, 0, "2026-11-10T09:00:00Z"), lookupItemJSON(w.E2, 0, "2026-11-09T09:00:00Z")), false)
	putLookups(t, w, w.AliceUID, w.Alice.WS2, lookupsJSON(lookupItemJSON(gone, 0, "2026-11-10T09:00:00Z")), true)
	putLookups(t, w, w.BobID, w.Bob.WS1, lookupsJSON(lookupItemJSON(bobs, 0, "2026-11-10T09:00:00Z")), false)

	data, _ := exportBytes(t, w, w.AliceUID)
	files, _ := unzipAll(t, data)
	refs := refEntryIDs(t, files)
	if !refs[horse] || !refs[w.E2] {
		t.Errorf("the history's entries are not in refs/entries.json: %v", refs)
	}
	if refs[gone] || refs[bobs] {
		t.Errorf("a tombstoned or foreign history added a ref: %v", refs)
	}
	n := 0
	for _, l := range lines(files[PartName(NamePluginData, 1)]) {
		var r PluginRow
		strictDecode(t, []byte(l), &r)
		if r.PluginID == CorePlugin && r.Key == "lookups" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("%d lookups rows exported, want 1", n)
	}
}

// Restored onto a server with other ids, the items name the same words and
// the book id follows the restored book.
func TestRestoreLookupsOntoShiftedIds(t *testing.T) {
	src := newWorld(t)
	putLookups(t, src, src.AliceUID, src.Alice.WS1,
		lookupsJSON(lookupItemJSON(src.E2, src.Alice.Book, "2026-11-10T09:00:00Z"), lookupItemJSON(src.E1, 0, "2026-11-09T09:00:00Z")), false)
	a := openExport(t, src, src.AliceUID)
	tg := newTarget(t, nil)
	if tg.E2 == src.E2 {
		t.Fatal("ids not shifted")
	}
	// shift the target's book ids too
	other := mkUser(t, tg.DB, "carol")
	exec(t, tg.DB, `INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (?, 'zh', '', '{}', 't')`, other)
	exec(t, tg.DB, `INSERT INTO library_books (user_id, workspace_id, language, title, source, source_id, chapter_count, position, created_at)
		SELECT ?, id, 'zh', 'Other', 'upload', 'o', 1, '0:0', 't' FROM workspaces WHERE user_id = ?`, other, other)
	if _, _, err := Restore(context.Background(), deps(tg.baseWorld), tg.UID, 0, a, Options{DropUnresolved: true}); err != nil {
		t.Fatal(err)
	}
	var data string
	if err := tg.DB.QueryRow(`SELECT data FROM plugin_data WHERE user_id = ? AND pack_id = 'qinqin-core' AND key = 'lookups'`, tg.UID).Scan(&data); err != nil {
		t.Fatal(err)
	}
	var book int64
	if err := tg.DB.QueryRow(`SELECT id FROM library_books WHERE user_id = ? AND title = 'Book'`, tg.UID).Scan(&book); err != nil {
		t.Fatal(err)
	}
	var got struct {
		Items []struct {
			EntryID int64   `json:"entryId"`
			Books   []int64 `json:"books"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(data), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 2 || got.Items[0].EntryID != tg.E2 || got.Items[1].EntryID != tg.E1 {
		t.Fatalf("items %s, want entries %d, %d", data, tg.E2, tg.E1)
	}
	if len(got.Items[0].Books) != 1 || got.Items[0].Books[0] != book || book == src.Alice.Book {
		t.Errorf("books %v, want [%d] (source %d)", got.Items[0].Books, book, src.Alice.Book)
	}
}

// An unparseable lookups row is dropped and counted, in the dry run and the restore.
func TestInvalidLookupsRowIsDroppedAndCounted(t *testing.T) {
	src := newWorld(t)
	tg := newTarget(t, nil)
	base, _, err := Plan(context.Background(), tg.DB, openExport(t, src, src.AliceUID), tg.UID)
	if err != nil {
		t.Fatal(err)
	}
	putLookups(t, src, src.AliceUID, src.Alice.WS1, `{"version":2,"items":[]}`, false)
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
	tg.DB.QueryRow(`SELECT COUNT(*) FROM plugin_data WHERE user_id = ? AND key = 'lookups'`, tg.UID).Scan(&n)
	if n != 0 || res.DroppedRows < 1 {
		t.Errorf("%d lookups rows restored (want 0), %d dropped", n, res.DroppedRows)
	}
}

// More than 500 items after the remap keep the 500 most recent.
func TestLookupsRemapCaps(t *testing.T) {
	m := NewMaps()
	m.Workspaces[1] = 1
	from := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	var items []string
	for i := int64(1); i <= 520; i++ {
		m.Entries[i] = i + 1000
		items = append(items, lookupItemJSON(i, 0, from.Add(time.Duration(i)*time.Minute).Format(time.RFC3339)))
	}
	ws := int64(1)
	r, drop := m.PluginRow(PluginRow{PluginID: CorePlugin, WorkspaceID: &ws, Key: "lookups", Data: json.RawMessage(lookupsJSON(items...))})
	if drop {
		t.Fatal("dropped")
	}
	var got struct {
		Items []struct {
			EntryID int64 `json:"entryId"`
		} `json:"items"`
	}
	json.Unmarshal(r.Data, &got)
	if len(got.Items) != 500 || got.Items[0].EntryID != 1520 || got.Items[499].EntryID != 1021 {
		t.Errorf("%d items, first %d last %d", len(got.Items), got.Items[0].EntryID, got.Items[len(got.Items)-1].EntryID)
	}
}

// Counts and sources summed past the limit are clamped to 1 000 000.
func TestLookupsRemapClampsSums(t *testing.T) {
	m := NewMaps()
	m.Entries[1], m.Entries[2] = 9, 9
	ws := int64(1)
	m.Workspaces[1] = 1
	data := lookupsJSON(
		`{"entryId":1,"count":900000,"firstAt":"2026-11-01T09:00:00Z","lastAt":"2026-11-01T09:00:00Z","sources":{"reader":900000},"books":[]}`,
		`{"entryId":2,"count":900000,"firstAt":"2026-11-02T09:00:00Z","lastAt":"2026-11-02T09:00:00Z","sources":{"reader":900000},"books":[]}`)
	r, _ := m.PluginRow(PluginRow{PluginID: CorePlugin, WorkspaceID: &ws, Key: "lookups", Data: json.RawMessage(data)})
	want := `{"version":1,"clearedAt":null,"items":[{"entryId":9,"count":1000000,"firstAt":"2026-11-01T09:00:00Z","lastAt":"2026-11-02T09:00:00Z","sources":{"reader":1000000},"books":[]}]}`
	if string(r.Data) != want {
		t.Errorf("got %s\nwant %s", r.Data, want)
	}
}

// Source keys are capped as the parse rule says (docs/contracts/lookups,
// lookup-rows.json): known keys always stay, at most 13 others of at most 32
// characters, also when two items merge.
func TestLookupsRemapCapsSourceKeys(t *testing.T) {
	m := NewMaps()
	m.Entries[1], m.Entries[2] = 9, 9
	ws := int64(1)
	m.Workspaces[1] = 1
	src := func(prefix string) string {
		out := `"reader":1`
		for i := 0; i < 10; i++ {
			out += fmt.Sprintf(`,"%s%02d":1`, prefix, i)
		}
		return out + `,"` + strings.Repeat("x", 33) + `":1`
	}
	data := lookupsJSON(
		`{"entryId":1,"count":1,"firstAt":"2026-11-01T09:00:00Z","lastAt":"2026-11-01T09:00:00Z","sources":{`+src("a")+`},"books":[]}`,
		`{"entryId":2,"count":1,"firstAt":"2026-11-02T09:00:00Z","lastAt":"2026-11-02T09:00:00Z","sources":{`+src("b")+`,"search":2},"books":[]}`)
	r, _ := m.PluginRow(PluginRow{PluginID: CorePlugin, WorkspaceID: &ws, Key: "lookups", Data: json.RawMessage(data)})
	var got struct {
		Items []struct {
			Sources map[string]int64 `json:"sources"`
		} `json:"items"`
	}
	if err := json.Unmarshal(r.Data, &got); err != nil || len(got.Items) != 1 {
		t.Fatalf("%s", r.Data)
	}
	s := got.Items[0].Sources
	if len(s) != 15 || s["reader"] != 2 || s["search"] != 2 || s["a00"] != 1 || s["b02"] != 1 || s["b03"] != 0 {
		t.Errorf("sources %v (%d keys), want reader, search, a00..a09, b00..b02", s, len(s))
	}
}
