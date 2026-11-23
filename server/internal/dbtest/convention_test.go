package dbtest

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The guard of docs/architecture/0005-test-conventions.md: outside
// internal/db (whose tests exercise the migrations themselves) no Go test
// migrates a database of its own; it takes one from Open, OpenPath or File.

// fn wraps a function body into a test file source.
func fn(body string) string {
	return "package p\n\nfunc TestX(t *testing.T) {\n" + body + "}\n"
}

func TestOwnMigrationFindings(t *testing.T) {
	for _, tc := range []struct {
		name string
		src  string
		want int
	}{
		{"open in t.TempDir()", fn("\tsqlDB, err := db.Open(filepath.Join(t.TempDir(), \"test.db\"))\n"), 1},
		{"OpenForSeed", fn("\tsqlDB, err := db.OpenForSeed(filepath.Join(tb.TempDir(), \"x.db\"))\n"), 1},
		{"temp path variable", fn("\tpath := filepath.Join(t.TempDir(), \"q.db\")\n\tx := 1\n\tsqlDB, err := db.Open(path)\n"), 1},
		{"dir := t.TempDir()", fn("\tdir := t.TempDir()\n\tsqlDB, err := db.Open(filepath.Join(dir, \"qinqin.db\"))\n"), 1},
		{"string concatenation", fn("\tsqlDB, err := db.Open(t.TempDir() + \"/x.db\")\n"), 1},
		{"local helper", "package p\n\nfunc open(t *testing.T, path string) *sql.DB {\n\ts, _ := db.Open(path)\n\treturn s\n}\n", 1},
		{"File in another function", "package p\n\nfunc a(t *testing.T) { dbtest.File(t, p) }\n\nfunc b(t *testing.T) { db.Open(p) }\n", 1},
		{"a closure", fn("\tf := func() { db.Open(p) }\n\tf()\n"), 1},
		// A database that exists already (dbtest wrote it, or a copy) may be opened again.
		{"after File", fn("\tdbtest.File(t, filepath.Join(data, \"qinqin.db\"))\n\tsqlDB, err := db.Open(filepath.Join(data, \"qinqin.db\"))\n"), 0},
		{"after OpenPath", fn("\tsqlDB, path := dbtest.OpenPath(t)\n\tagain, err := db.Open(path)\n"), 0},
		{"after VACUUM INTO", fn("\tcopyPath := filepath.Join(t.TempDir(), \"r.db\")\n\tsqlDB.Exec(`VACUUM INTO ?`, copyPath)\n\trestored, err := db.Open(copyPath)\n"), 0},
		{"reopen marker above", fn("\t// reopen: serve wrote it\n\tsqlDB, err := db.Open(filepath.Join(dir, \"qinqin.db\"))\n"), 0},
		{"reopen marker on the line", fn("\tsqlDB, err := db.Open(filepath.Join(dir, \"qinqin.db\")) // reopen\n"), 0},
		{"other packages' Open", fn("\tf, err := os.Open(p)\n\tr, err := zip.Open(p)\n"), 0},
	} {
		got, err := ownMigrationFindings(tc.src)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if len(got) != tc.want {
			t.Errorf("%s: %d findings %v, want %d", tc.name, len(got), got, tc.want)
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
		findings, err := ownMigrationFindings(string(src))
		if err != nil {
			return fmt.Errorf("%s: %w", rel, err)
		}
		for _, f := range findings {
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

// ownMigrationFindings returns the db.Open / db.OpenForSeed calls of a Go
// test source that are not known to open an existing database: in the same
// top-level function, no dbtest.File, dbtest.OpenPath or VACUUM INTO comes
// before the call, and no "// reopen" comment sits on the call's line or
// the line above it. A test that opens a file a command under test wrote
// marks the call "// reopen".
func ownMigrationFindings(src string) ([]string, error) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "x_test.go", src, parser.ParseComments)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(src, "\n")
	reopen := func(line int) bool { // 1-based
		for _, l := range []int{line, line - 1} {
			if l >= 1 && l <= len(lines) && strings.Contains(lines[l-1], "// reopen") {
				return true
			}
		}
		return false
	}
	var out []string
	for _, decl := range file.Decls {
		fd, ok := decl.(*ast.FuncDecl)
		if !ok || fd.Body == nil {
			continue
		}
		bodyStart := fset.Position(fd.Body.Pos()).Offset
		ast.Inspect(fd.Body, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || (sel.Sel.Name != "Open" && sel.Sel.Name != "OpenForSeed") {
				return true
			}
			if pkg, ok := sel.X.(*ast.Ident); !ok || pkg.Name != "db" {
				return true
			}
			pos := fset.Position(call.Pos())
			before := src[bodyStart:pos.Offset]
			if strings.Contains(before, "dbtest.File(") || strings.Contains(before, "dbtest.OpenPath(") ||
				strings.Contains(before, "VACUUM INTO") || reopen(pos.Line) {
				return true
			}
			out = append(out, fmt.Sprintf("line %d: %s", pos.Line, strings.TrimSpace(lines[pos.Line-1])))
			return true
		})
	}
	return out, nil
}
