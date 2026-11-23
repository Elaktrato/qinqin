package dbtest

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The guard of docs/architecture/0005-test-conventions.md: outside
// internal/db (whose tests exercise the migrations themselves) no Go test
// migrates a database of its own; it takes one from Open, OpenPath or File.

func TestOwnMigrationFindings(t *testing.T) {
	for _, tc := range []struct {
		src  string
		want int
	}{
		{"\tsqlDB, err := db.Open(filepath.Join(t.TempDir(), \"test.db\"))\n", 1},
		{"\tsqlDB, err := db.OpenForSeed(filepath.Join(tb.TempDir(), \"x.db\"))\n", 1},
		{"\tpath := filepath.Join(t.TempDir(), \"q.db\")\n\tsqlDB, err := db.Open(path)\n", 1},
		{"\tpath = filepath.Join(t.TempDir(), \"q.db\")\n\tx := 1\n\tsqlDB, err := db.Open(path)\n", 1},
		// Reopening a database that exists already is fine.
		{"\tsqlDB, err := db.Open(filepath.Join(dir, \"qinqin.db\"))\n", 0},
		{"\tcopyPath := filepath.Join(t.TempDir(), \"r.db\")\n\tsqlDB.Exec(`VACUUM INTO ?`, copyPath)\n\trestored, err := db.Open(copyPath)\n", 0},
		{"\tsqlDB, path := dbtest.OpenPath(t)\n\tagain, err := db.Open(path)\n", 0},
		{"\tdbtest.File(t, filepath.Join(data, \"qinqin.db\"))\n\tsqlDB, err := db.Open(filepath.Join(data, \"qinqin.db\"))\n", 0},
	} {
		if got := len(ownMigrationFindings(tc.src)); got != tc.want {
			t.Errorf("%q: %d findings, want %d", tc.src, got, tc.want)
		}
	}
}

func TestNoTestMigratesItsOwnDatabase(t *testing.T) {
	root := filepath.Join("..", "..")
	var found []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		if d.IsDir() {
			if rel == "internal/db" || rel == "internal/dbtest" || (rel != "." && strings.HasPrefix(d.Name(), ".")) || d.Name() == "testdata" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, "_test.go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, f := range ownMigrationFindings(string(src)) {
			found = append(found, rel+": "+f)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range found {
		t.Errorf("a test migrates its own database (use dbtest.Open): %s", f)
	}
}

var (
	// db.Open straight into a new temporary directory.
	openInTempDir = regexp.MustCompile(`db\.Open(?:ForSeed)?\(filepath\.Join\(\w+\.TempDir\(\)`)
	// A path built in a new temporary directory and opened a few lines on.
	tempPathOpened = regexp.MustCompile(`(\w+) :?= filepath\.Join\(\w+\.TempDir\(\)[^\n]*\n(?:[^\n]*\n){0,3}?[^\n]*db\.Open(?:ForSeed)?\(\w+\)`)
)

// ownMigrationFindings returns the places in a Go test source that create
// and migrate a database of their own instead of taking one from Open. It
// only matches a database opened in a new temporary directory, so reopening
// an existing database file is never flagged.
func ownMigrationFindings(src string) []string {
	var out []string
	out = append(out, openInTempDir.FindAllString(src, -1)...)
	for _, m := range tempPathOpened.FindAllStringSubmatch(src, -1) {
		// The opened variable must be the temp path (RE2 has no backreferences).
		opened := regexp.MustCompile(`db\.Open(?:ForSeed)?\(` + regexp.QuoteMeta(m[1]) + `\)`)
		// A path the test fills itself before opening (VACUUM INTO, a copy)
		// is no fresh migration: the variable is used between the two.
		between := opened.ReplaceAllString(m[0][strings.Index(m[0], "\n"):], "")
		used := regexp.MustCompile(`\b` + regexp.QuoteMeta(m[1]) + `\b`)
		if opened.MatchString(m[0]) && !used.MatchString(between) {
			out = append(out, m[0])
		}
	}
	return out
}
