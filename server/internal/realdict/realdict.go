// Package realdict imports the dictionaries the repository ships
// (plugins/data/cedict and plugins/data/jmdict) into a test database, cut
// down to the entries that carry one of a list of words, so a test can check
// a rule on real dictionary lines in a fraction of a second. Test helper
// only: nothing outside *_test.go imports it.
package realdict

import (
	"bufio"
	"compress/gzip"
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/lang"
	"qinqin/internal/pack"
)

// Import imports into sqlDB every entry of the shipped dictionary of
// language (zh: CC-CEDICT, ja: JMdict) that carries one of words
// (CC-CEDICT: the simplified form; JMdict: a written form or a kana
// reading), with the real importer and the committed manifest.
func Import(t testing.TB, sqlDB *sql.DB, language string, words ...string) {
	t.Helper()
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
	keep := map[string]bool{}
	for _, w := range words {
		keep[w] = true
	}
	var dir, file string
	switch language {
	case "zh":
		dir, file = "cedict", "dictionary.txt"
	case "ja":
		dir, file = "jmdict", "jmdict.xml"
	default:
		t.Fatalf("realdict: no shipped dictionary for %q", language)
	}
	p, err := pack.LoadPack(filtered(t, dir, file, keep))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dict.ImportLexicon(context.Background(), sqlDB, &p); err != nil {
		t.Fatalf("realdict: import %s: %v", dir, err)
	}
}

// root finds the repository root above the test's working directory.
func root(t testing.TB) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "plugins", "data", "cedict")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("realdict: no plugins/data above the working directory")
		}
		dir = parent
	}
}

var (
	cedictLine = regexp.MustCompile(`^\S+ (\S+) \[`)
	jmdictText = regexp.MustCompile(`<(?:keb|reb)>([^<]+)</(?:keb|reb)>`)
)

// filtered writes a copy of plugins/data/<dir> keeping only the entries
// with one of keep, and returns its directory.
func filtered(t testing.TB, dir, file string, keep map[string]bool) string {
	t.Helper()
	src := filepath.Join(root(t), "plugins", "data", dir)
	manifest, err := os.ReadFile(filepath.Join(src, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(filepath.Join(src, file+".gz"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	if file == "dictionary.txt" {
		err = filterLines(zr, func(line string) bool {
			if strings.HasPrefix(line, "#") {
				return true
			}
			m := cedictLine.FindStringSubmatch(line)
			return m != nil && keep[m[1]]
		}, &out)
	} else {
		err = filterJMdict(zr, keep, &out)
	}
	if err != nil {
		t.Fatalf("realdict: %s: %v", dir, err)
	}
	outDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(outDir, "manifest.json"), manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outDir, file), []byte(out.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	return outDir
}

func filterLines(r io.Reader, keep func(string) bool, out *strings.Builder) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		if line := sc.Text(); keep(line) {
			out.WriteString(line + "\n")
		}
	}
	return sc.Err()
}

// filterJMdict keeps JMdict's header (with the entity declarations), the
// entries that carry one of keep, and the closing tag. JMdict writes one
// element per line, an entry from <entry> to </entry>.
func filterJMdict(r io.Reader, keep map[string]bool, out *strings.Builder) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	var entry []string
	inEntry, kept, entries := false, false, 0
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "<entry>"):
			inEntry, kept, entry = true, false, entry[:0]
			entry = append(entry, line)
		case inEntry:
			entry = append(entry, line)
			if m := jmdictText.FindStringSubmatch(line); m != nil && keep[m[1]] {
				kept = true
			}
			if strings.HasPrefix(line, "</entry>") {
				inEntry = false
				if kept {
					entries++
					out.WriteString(strings.Join(entry, "\n") + "\n")
				}
			}
		default:
			out.WriteString(line + "\n")
		}
	}
	if err := sc.Err(); err != nil {
		return err
	}
	if entries == 0 {
		return fmt.Errorf("no JMdict entry kept")
	}
	return nil
}
