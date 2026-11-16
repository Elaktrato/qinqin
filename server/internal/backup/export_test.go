package backup

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"strings"
	"testing"
	"time"
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
	rows := lines(files[NamePluginData])
	global, nullModified := 0, 0
	for _, l := range rows {
		var r PluginRow
		strictDecode(t, []byte(l), &r)
		if r.Key == "card:TOMBSTONE" {
			t.Error("tombstoned row exported")
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
	// own sentences only, none tombstoned
	var s OwnSentence
	if sl := lines(files[NameSentences]); len(sl) != 1 {
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
	if man.Counts["events"] != 0 || files[NameWorkspaces] == nil || files[NamePluginData] == nil {
		t.Errorf("empty export: %v", man.Counts)
	}
}
