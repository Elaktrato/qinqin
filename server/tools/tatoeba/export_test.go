package main

import (
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const (
	fixtureExport = "testdata/export"
	fixturePin    = "testdata/pin.json"
)

// TestFixtureArchivesMatchSources: the committed fixture archives hold
// exactly the hand-made files of testdata/export-src (make-export.sh), in
// the three kinds the reader accepts (.tar.bz2, .bz2, plain), and the
// fixture pin carries their real hashes.
func TestFixtureArchivesMatchSources(t *testing.T) {
	p, err := loadPin(fixturePin)
	if err != nil {
		t.Fatal(err)
	}
	if err := p.requirePinned(); err != nil {
		t.Fatalf("fixture pin: %v", err)
	}
	kinds := map[string]bool{}
	for _, a := range p.Archives {
		if err := a.verify(fixtureExport); err != nil {
			t.Errorf("%v", err)
		}
		kinds[archiveKind(a.file())] = true
		rc, err := openMember(fixtureExport, a)
		if err != nil {
			t.Fatalf("open %s: %v", a.Name, err)
		}
		got, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatalf("read %s: %v", a.Name, err)
		}
		want, err := os.ReadFile(filepath.Join("testdata/export-src", a.Member))
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != string(want) {
			t.Errorf("%s: archive member differs from export-src/%s; run testdata/make-export.sh", a.Name, a.Member)
		}
	}
	for _, k := range []string{"tar.bz2", "bz2", "plain"} {
		if !kinds[k] {
			t.Errorf("no fixture archive of kind %s", k)
		}
	}
}

func TestOpenMemberRefusesAMissingMember(t *testing.T) {
	a := Archive{Name: "tags", URL: "https://x/tags.tar.bz2", Member: "nope.csv"}
	if _, err := openMember(fixtureExport, a); err == nil || !strings.Contains(err.Error(), "nope.csv") {
		t.Errorf("openMember = %v, want an error naming the member", err)
	}
}

func TestReadRowsIsStrict(t *testing.T) {
	var got [][]string
	err := readRows(strings.NewReader("1\tcmn\t好\t\\N\n2\teng\tGood\temma\n"), "test", 4, func(cols []string) error {
		got = append(got, cols)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0][3] != "" || got[1][3] != "emma" {
		t.Errorf("rows = %q (\\N must read as empty)", got)
	}
	// A line with another column count is a format change: refuse.
	err = readRows(strings.NewReader("1\tcmn\t好\tlin\n2\tcmn\t好\tlin\tCC0\n"), "sentences", 4, func([]string) error { return nil })
	if err == nil || !strings.Contains(err.Error(), "line 2") || !strings.Contains(err.Error(), "licence") {
		t.Errorf("extra column = %v, want a refusal naming line 2 and the licence re-check", err)
	}
	// A final line without a newline still counts; a CR is stripped.
	got = nil
	if err := readRows(strings.NewReader("1\t2\r\n3\t4"), "links", 2, func(c []string) error { got = append(got, c); return nil }); err != nil || len(got) != 2 || got[0][1] != "2" {
		t.Errorf("rows = %q, %v", got, err)
	}
}

// TestReadRowsUnescapes: the export is written MySQL-style (\N for NULL,
// backslash escapes); a field is unescaped once.
func TestReadRowsUnescapes(t *testing.T) {
	var got []string
	in := "1\t" + `a\\b` + "\n2\t" + `tab\there` + "\n3\t" + `line\nbreak` + "\n4\t" + `\N` + "\n5\t" + `x\Ny` + "\n6\t" + `quote\'s` + "\n"
	if err := readRows(strings.NewReader(in), "test", 2, func(c []string) error { got = append(got, c[1]); return nil }); err != nil {
		t.Fatal(err)
	}
	want := []string{`a\b`, "tab\there", "line\nbreak", "", "xNy", "quote's"}
	if !slices.Equal(got, want) {
		t.Errorf("fields %q, want %q", got, want)
	}
}
