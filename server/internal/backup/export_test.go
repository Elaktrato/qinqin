package backup

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

var testMeta = Meta{AppVersion: "0.3.0", SchemaVersion: "035_user_time_zones", Now: time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)}

// exportBytes exports a user into memory.
func exportBytes(t *testing.T, w *baseWorld, uid int64) ([]byte, Manifest) {
	t.Helper()
	var buf bytes.Buffer
	man, err := WriteUser(context.Background(), w.DB, w.Data, uid, &buf, testMeta)
	if err != nil {
		t.Fatalf("WriteUser: %v", err)
	}
	return buf.Bytes(), man
}

func unzipAll(t *testing.T, data []byte) (map[string][]byte, []string) {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string][]byte{}
	var order []string
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		out[f.Name] = b
		order = append(order, f.Name)
	}
	return out, order
}

func lines(b []byte) []string {
	var out []string
	sc := bufio.NewScanner(bytes.NewReader(b))
	sc.Buffer(nil, 1<<20)
	for sc.Scan() {
		out = append(out, sc.Text())
	}
	return out
}

func TestWriteUserLayoutAndContent(t *testing.T) {
	w := newWorld(t)
	data, man := exportBytes(t, w, w.AliceUID)
	files, order := unzipAll(t, data)
	if order[len(order)-1] != NameManifest {
		t.Errorf("manifest is not last: %v", order)
	}
	// manifest hashes and byte counts match the bytes
	var m Manifest
	strictDecode(t, files[NameManifest], &m)
	if m.Format != FormatName || m.FormatVersion != 1 || m.User.Username != "alice" || m.User.ID != w.AliceUID {
		t.Errorf("manifest %+v", m)
	}
	if len(m.Files) != len(order)-1 {
		t.Errorf("manifest lists %d files, archive has %d", len(m.Files), len(order)-1)
	}
	for _, f := range m.Files {
		sum := sha256.Sum256(files[f.Name])
		if hex.EncodeToString(sum[:]) != f.SHA256 || int64(len(files[f.Name])) != f.Bytes {
			t.Errorf("%s: hash or size differs from the manifest", f.Name)
		}
	}
	if man.Counts["workspaces"] != 2 || man.Counts["events"] != 4 || man.Counts["pluginData"] != 5 ||
		man.Counts["overlays"] != 1 || man.Counts["sentences"] != 1 || man.Counts["books"] != 1 ||
		man.Counts["bookmarks"] != 1 || man.Counts["highlights"] != 1 {
		t.Errorf("counts = %v", man.Counts)
	}
	for _, n := range order {
		if _, _, ok := KnownName(n); !ok {
			t.Errorf("writer produced the unknown name %q", n)
		}
	}
	// plugin data: tombstone absent, user-global rows present with null workspace, NULL modified_at kept null
	rows := lines(files[PartName(NamePluginData, 1)])
	global, nullModified := 0, 0
	for _, l := range rows {
		var r PluginRow
		strictDecode(t, []byte(l), &r)
		if r.Key == "card:TOMBSTONE" || r.Key == "deck:GONE" {
			t.Error("tombstoned row exported")
		}
		if r.Key == "card:LEFTOVER" {
			t.Error("a leftover typed-family plugin row was exported")
		}
		if r.WorkspaceID == nil {
			global++
		}
		if r.ModifiedAt == nil {
			nullModified++
		}
	}
	if len(rows) != 5 || global != 2 || nullModified != 1 {
		t.Errorf("plugin rows %d global %d nullModified %d", len(rows), global, nullModified)
	}
	// typed cards travel as their legacy qinqin-flashcards rows (rows.ToLegacy)
	cards := map[string]PluginRow{}
	for _, l := range rows {
		var r PluginRow
		strictDecode(t, []byte(l), &r)
		if strings.HasPrefix(r.Key, "card:") {
			cards[r.Key] = r
		}
	}
	rev := cards["card:c-reverse-"+strconv.FormatInt(w.E1, 10)]
	if len(cards) != 3 || rev.PluginID != FlashcardsPlugin || rev.WorkspaceID == nil || *rev.WorkspaceID != w.Alice.WS1 ||
		rev.Version != 2 || rev.UpdatedAt != "2026-11-10T08:00:00Z" || rev.ModifiedAt == nil || *rev.ModifiedAt != "2026-11-10T08:00:00Z" {
		t.Errorf("exported cards %+v", cards)
	}
	if want := fmt.Sprintf(`{"createdAt":"2026-11-10T08:00:00Z","deckIds":["general"],"entryId":%d,"id":"c-reverse-%d","kind":"reverse","x-unknown":{"b":1,"a":2}}`, w.E1, w.E1); string(rev.Data) != want {
		t.Errorf("reverse card data %s, want %s", rev.Data, want)
	}
	if strings.Contains(strings.Join(order, ","), "deletion") || m.FormatVersion != 1 {
		t.Errorf("archive names %v format %d", order, m.FormatVersion)
	}
	// own sentences only, none tombstoned
	var s OwnSentence
	if sl := lines(files[PartName(NameSentences, 1)]); len(sl) != 1 {
		t.Fatalf("sentences = %v", sl)
	} else {
		strictDecode(t, []byte(sl[0]), &s)
	}
	if s.Hanzi != "你好吗" {
		t.Errorf("sentence %+v", s)
	}
	// refs: exactly the entries referenced by overlays, own sentences, cards, derived card ids, view events
	var ents []EntryRef
	strictDecode(t, files[NameRefEntries], &ents)
	got := map[int64]string{}
	for _, e := range ents {
		got[e.ID] = e.ExtKey + "|" + e.Written
	}
	if len(got) != 2 || got[w.E1] != "cc-1|你好" || got[w.E2] != "cc-2|世界" {
		t.Errorf("entry refs = %v (424242 does not exist and must not appear)", got)
	}
	var srefs []SentenceRef
	strictDecode(t, files[NameRefSentences], &srefs)
	if len(srefs) != 1 || srefs[0].ID != w.Alice.PackSent || srefs[0].Own || srefs[0].SourcePack != "tatoeba" || srefs[0].Hanzi != "packsatz" {
		t.Errorf("sentence refs = %+v", srefs)
	}
	var drefs []DictRef
	strictDecode(t, files[NameRefDicts], &drefs)
	if len(drefs) != 1 || drefs[0].PackID != "cc-cedict" {
		t.Errorf("dict refs = %+v", drefs)
	}
	// account
	var acc Account
	strictDecode(t, files[NameAccount], &acc)
	if acc.Username != "alice" || len(acc.TimeZones) != 2 || acc.TimeZones[0].From != nil || len(acc.PluginStates) != 1 {
		t.Errorf("account %+v", acc)
	}
	// book content is byte-identical
	if string(files[BookName(w.Alice.Book)]) != `[{"title":"One","paragraphs":[[{"text":"你好"}]]}]` {
		t.Errorf("book content %q", files[BookName(w.Alice.Book)])
	}
}

func TestWriteUserIsolationAndSecrets(t *testing.T) {
	w := newWorld(t)
	data, _ := exportBytes(t, w, w.AliceUID)
	files, _ := unzipAll(t, data)
	// every byte of every entry, plus the compressed archive itself
	hay := string(data)
	for _, b := range files {
		hay += string(b)
	}
	for _, secret := range []string{secretToken, secretCT, secretTOTP, secretPhoto, "SECRET-RECOVERY", "HASH-alice", "HASH-bobby"} {
		if strings.Contains(hay, secret) {
			t.Errorf("archive contains %q", secret)
		}
	}
	if strings.Contains(hay, "bobby") || strings.Contains(string(files[NameWorkspaces]), "JP-bob") {
		t.Error("the second user's data leaked")
	}
	var ws []Workspace
	strictDecode(t, files[NameWorkspaces], &ws)
	for _, x := range ws {
		if x.ID == w.Bob.WS1 || x.ID == w.Bob.WS2 {
			t.Error("workspace of another user exported")
		}
	}
	for _, l := range lines(files[EventsName(1)]) {
		var e Event
		strictDecode(t, []byte(l), &e)
		if e.WorkspaceID == w.Bob.WS1 || e.WorkspaceID == w.Bob.WS2 {
			t.Error("event of another user exported")
		}
	}
}

func TestWriteUserSplitsEventsIntoFiles(t *testing.T) {
	w := newWorld(t)
	old := eventsPerFile
	eventsPerFile = 3
	t.Cleanup(func() { eventsPerFile = old })
	data, man := exportBytes(t, w, w.AliceUID)
	files, _ := unzipAll(t, data)
	if len(lines(files[EventsName(1)])) != 3 || len(lines(files[EventsName(2)])) != 1 || files[EventsName(3)] != nil {
		t.Errorf("split: %d/%d", len(lines(files[EventsName(1)])), len(lines(files[EventsName(2)])))
	}
	if man.Counts["events"] != 4 {
		t.Errorf("events count %d", man.Counts["events"])
	}
}

func TestWriteUserEmptyUser(t *testing.T) {
	w := newWorld(t)
	carol := mkUser(t, w.DB, "carol")
	data, man := exportBytes(t, w, carol)
	files, _ := unzipAll(t, data)
	if man.Counts["events"] != 0 || files[NameWorkspaces] == nil || files[PartName(NamePluginData, 1)] != nil {
		t.Errorf("empty export: %v", man.Counts)
	}
}

func TestWriteUserSplitsEveryFamilyByBytesAndTheArchiveStillOpens(t *testing.T) {
	w := newWorld(t)
	old := partBytes
	partBytes = 150 // every part closes after about one line
	t.Cleanup(func() { partBytes = old })
	data, man := exportBytes(t, w, w.AliceUID)
	files, order := unzipAll(t, data)
	for _, fam := range []string{FamEvents, NamePluginData} {
		n := 0
		for _, name := range order {
			if FamilyOf(name) == fam {
				n++
				if len(lines(files[name])) != 1 {
					t.Errorf("%s holds %d lines with a 150 byte part size", name, len(lines(files[name])))
				}
			}
		}
		want := man.Counts["events"]
		if fam == NamePluginData {
			want = man.Counts["pluginData"]
		}
		if n != want {
			t.Errorf("%s: %d parts, want %d", fam, n, want)
		}
	}
	if files["plugin-data.jsonl"] != nil || files["overlays.jsonl"] != nil {
		t.Error("an unnumbered JSONL entry was written")
	}
	p := filepath.Join(t.TempDir(), "s.zip")
	os.WriteFile(p, data, 0o644)
	a, err := Open(p)
	if err != nil {
		t.Fatalf("a split archive does not open: %v", err)
	}
	defer a.Close()
	rows := 0
	a.PluginRows(func(PluginRow) error { rows++; return nil })
	if rows != man.Counts["pluginData"] {
		t.Errorf("read back %d plugin rows", rows)
	}
}

func TestWriteUserRefusesToProduceWhatARestoreWouldRefuse(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	// compressed size above the upload cap
	var buf bytes.Buffer
	m := testMeta
	m.MaxBytes = 300
	if _, err := WriteUser(ctx, w.DB, w.Data, w.AliceUID, &buf, m); !errors.Is(err, ErrTooLargeToRestore) {
		t.Errorf("MaxBytes: %v", err)
	}
	// expanded size above the total cap
	old := capTotal
	capTotal = 500
	if _, err := WriteUser(ctx, w.DB, w.Data, w.AliceUID, io.Discard, testMeta); !errors.Is(err, ErrTooLargeToRestore) {
		t.Errorf("capTotal: %v", err)
	}
	capTotal = old
	// a book file above the book cap
	oldB := capBook
	capBook = 10
	if _, err := WriteUser(ctx, w.DB, w.Data, w.AliceUID, io.Discard, testMeta); !errors.Is(err, ErrTooLargeToRestore) {
		t.Errorf("capBook: %v", err)
	}
	capBook = oldB
	if _, err := WriteUser(ctx, w.DB, w.Data, w.AliceUID, io.Discard, testMeta); err != nil {
		t.Errorf("a normal export failed: %v", err)
	}
}

// A typed-family plugin row is exported only while it carries a readable
// study row no typed row shadows; the counts the dry run shows agree.
func TestExportTypedFamilyLeftovers(t *testing.T) {
	w := newWorld(t)
	uid := w.AliceUID
	e1 := strconv.FormatInt(w.E1, 10)
	ins := func(ws int64, key, data string) {
		exec(t, w.DB, `INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at)
			VALUES ('qinqin-flashcards', ?, ?, ?, ?, 1, '2026-11-10T08:00:00Z', '2026-11-10T08:00:00Z')`, uid, ws, key, data)
	}
	// readable and unshadowed: exported
	ins(w.Alice.WS2, "deck:PLAIN", `{"id":"PLAIN","name":"n","createdAt":"t"}`)
	// readable but a typed row holds the key: only the typed row goes
	ins(w.Alice.WS1, "card:c-vocab-"+e1, `{"id":"c-vocab-`+e1+`","kind":"vocab","entryId":`+e1+`,"deckIds":["SHADOWED"],"createdAt":"t"}`)
	// readable but in another user's workspace: never
	ins(w.Bob.WS1, "deck:FOREIGN", `{"id":"FOREIGN","name":"n","createdAt":"t"}`)
	data, man := exportBytes(t, w, uid)
	files, _ := unzipAll(t, data)
	keys := map[string]int{}
	for _, l := range lines(files[PartName(NamePluginData, 1)]) {
		var r PluginRow
		strictDecode(t, []byte(l), &r)
		keys[r.Key]++
		if strings.Contains(string(r.Data), "SHADOWED") {
			t.Error("a shadowed leftover was exported")
		}
	}
	if keys["deck:PLAIN"] != 1 || keys["card:c-vocab-"+e1] != 1 || keys["deck:FOREIGN"] != 0 || keys["card:LEFTOVER"] != 0 {
		t.Errorf("exported keys %v", keys)
	}
	c, err := CurrentCounts(context.Background(), w.DB, uid)
	if err != nil {
		t.Fatal(err)
	}
	if c.PluginData != man.Counts["pluginData"] || c.PluginData != 6 || c.Cards != 3 {
		t.Errorf("CurrentCounts %+v, export counts %v", c, man.Counts)
	}
}

// Every typed study family travels as its legacy qinqin-flashcards row
// (rows.ToLegacy): key, data, version, updatedAt and modifiedAt of the
// typed row; the archive opens (no duplicate keys) and stays format v1.
func TestExportEveryTypedFamilyAsItsLegacyRow(t *testing.T) {
	w := newWorld(t)
	uid := w.AliceUID
	legacy := map[string]string{
		"deck:d-1":         `{"id":"d-1","name":"Words","createdAt":"2026-11-01T00:00:00Z","source":{"type":"frequency","packId":"zh-freq","size":500}}`,
		"deckcfg:d-1":      `{"deckId":"d-1","cardTypes":["reverse"],"newOrder":{"by":"level","packId":"hsk"},"x-keep":1}`,
		"limits:workspace": `{"version":1,"new":{"limit":10},"reviews":{"limit":null}}`,
		"limits:deck:d-1":  `{"version":1,"new":{"limit":0}}`,
		"fsrs:set:s-1":     `{"id":"s-1","w":[0.2,1.2,3.1,15.6,7.2,0.5,1.4,0.005,1.5,0.1,1,1.9,0.1,0.3,2.3,0.2,3,0.5,0.6,0.1,0.5],"createdAt":"2026-11-01T00:00:00Z","source":"optimized","labelled":120,"logLoss":0.31,"baselineLogLoss":0.35}`,
		"fsrs:active":      `{"setId":"s-1","changedAt":"2026-11-02T00:00:00Z"}`,
	}
	want := map[string]rows.Row{}
	for key, data := range legacy {
		r, err := rows.FromLegacy(key, json.RawMessage(data))
		if err != nil {
			t.Fatalf("%s: %v", key, err)
		}
		r.M().WorkspaceID = w.Alice.WS2
		if err := study.InsertStored(context.Background(), w.DB, uid, r, 7, "2026-11-12T10:00:00Z", "2026-11-12T09:59:58Z", nil); err != nil {
			t.Fatal(err)
		}
		r.M().ModifiedAt = time.Date(2026, 11, 12, 9, 59, 58, 0, time.UTC) // what ToLegacy writes into deckcfg
		want[key] = r
	}
	data, man := exportBytes(t, w, uid)
	if man.FormatVersion != 1 {
		t.Errorf("formatVersion %d", man.FormatVersion)
	}
	files, _ := unzipAll(t, data)
	got := map[string]PluginRow{}
	for _, l := range lines(files[PartName(NamePluginData, 1)]) {
		var r PluginRow
		strictDecode(t, []byte(l), &r)
		if r.WorkspaceID != nil && *r.WorkspaceID == w.Alice.WS2 {
			got[r.Key] = r
		}
	}
	for key, r := range want {
		g, ok := got[key]
		if !ok {
			t.Errorf("%s not exported", key)
			continue
		}
		wantKey, wantData := rows.ToLegacy(r)
		var a, b any
		json.Unmarshal(g.Data, &a)
		json.Unmarshal(wantData, &b)
		if wantKey != key || fmt.Sprint(a) != fmt.Sprint(b) || g.PluginID != FlashcardsPlugin || g.Version != 7 ||
			g.UpdatedAt != "2026-11-12T10:00:00Z" || g.ModifiedAt == nil || *g.ModifiedAt != "2026-11-12T09:59:58Z" {
			t.Errorf("%s exported %+v %s, want %s", key, g, g.Data, wantData)
		}
	}
	// deckcfg's inner updatedAt is the row's edit time; unknown members are kept.
	var cfg map[string]any
	json.Unmarshal(got["deckcfg:d-1"].Data, &cfg)
	if cfg["updatedAt"] != "2026-11-12T09:59:58Z" || cfg["x-keep"] != float64(1) {
		t.Errorf("deckcfg data %s", got["deckcfg:d-1"].Data)
	}
	p := filepath.Join(t.TempDir(), "a.zip")
	os.WriteFile(p, data, 0o644)
	a, err := Open(p)
	if err != nil {
		t.Fatalf("the archive does not open: %v", err)
	}
	a.Close()
}
