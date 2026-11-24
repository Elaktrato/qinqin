package backup

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

const sampleDir = "../../../docs/contracts/backup/sample-v2"

func strictDecode(t *testing.T, raw []byte, v any) {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		t.Fatalf("decode %T: %v", v, err)
	}
}

func readSample(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(sampleDir, filepath.FromSlash(name)))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func decodeLines[T any](t *testing.T, name string) []T {
	t.Helper()
	var out []T
	sc := bufio.NewScanner(bytes.NewReader(readSample(t, name)))
	for sc.Scan() {
		var v T
		strictDecode(t, sc.Bytes(), &v)
		out = append(out, v)
	}
	return out
}

func TestSampleArchiveDecodesIntoTheRowTypes(t *testing.T) {
	var m Manifest
	strictDecode(t, readSample(t, NameManifest), &m)
	if m.Format != FormatName || m.FormatVersion != FormatVersion || len(m.Files) == 0 {
		t.Errorf("manifest = %+v", m)
	}
	var acc Account
	strictDecode(t, readSample(t, NameAccount), &acc)
	var ents []EntryRef
	strictDecode(t, readSample(t, NameRefEntries), &ents)
	var dicts []DictRef
	strictDecode(t, readSample(t, NameRefDicts), &dicts)
	var sref []SentenceRef
	strictDecode(t, readSample(t, NameRefSentences), &sref)
	var ws []Workspace
	strictDecode(t, readSample(t, NameWorkspaces), &ws)
	var books []Book
	strictDecode(t, readSample(t, NameBooks), &books)
	if len(ws) != 2 || len(books) != 1 || len(ents) != 1 || len(dicts) != 1 || len(sref) != 1 {
		t.Errorf("counts: %d %d %d %d %d", len(ws), len(books), len(ents), len(dicts), len(sref))
	}
	evs := decodeLines[Event](t, EventsName(1))
	rows := decodeLines[Row](t, PartName(NameRows, 1))
	if len(evs) != m.Counts["events"] || len(rows) != m.Counts["rows"] {
		t.Errorf("events %d rows %d vs manifest %v", len(evs), len(rows), m.Counts)
	}
	global := 0
	for _, r := range rows {
		if r.WorkspaceID == nil {
			global++
		}
	}
	if global != 1 {
		t.Errorf("the sample must hold one user-global row (workspaceId null), has %d", global)
	}
	decodeLines[Overlay](t, PartName(NameOverlays, 1))
	decodeLines[OwnSentence](t, PartName(NameSentences, 1))
	decodeLines[Bookmark](t, PartName(NameBookmarks, 1))
	decodeLines[Highlight](t, PartName(NameHighlights, 1))
	if len(readSample(t, BookName(3))) == 0 {
		t.Error("book content missing")
	}
}

func TestKnownName(t *testing.T) {
	good := map[string]string{
		"manifest.json": KindFixed, "events/000001.jsonl": KindPart, "events/123456.jsonl": KindPart,
		"library/books/7.json": KindBook, "rows/000002.jsonl": KindPart, "library/highlights/000001.jsonl": KindPart, "library/books/0.json": KindBook, "refs/entries.json": KindFixed,
	}
	for n, kind := range good {
		if k, _, ok := KnownName(n); !ok || k != kind {
			t.Errorf("KnownName(%q) = %q %v", n, k, ok)
		}
	}
	if _, id, ok := KnownName("library/books/42.json"); !ok || id != 42 {
		t.Errorf("book id = %d %v", id, ok)
	}
	for _, n := range []string{"", "../x", "/abs", "library/books/1a.json", "library/books/-1.json", "library/books/01.json",
		"events/1.jsonl", "events/0000001.jsonl", "library/books/../x.json", "refs/", "refs/../manifest.json",
		"a/manifest.json", "manifest.json/", "library/books/99999999999999999999.json", `events\000001.jsonl`, "EVENTS/000001.jsonl", "plugin-data/000001.jsonl", "rows.jsonl", "overlays.jsonl", "rows/1.jsonl", "rows/0000001.jsonl", "sentences/000001.json", "manifest.json\x00"} {
		if _, _, ok := KnownName(n); ok {
			t.Errorf("KnownName(%q) accepted", n)
		}
	}
}
