package db

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// frozenStep is the import path of a frozen migration step package.
var frozenStep = regexp.MustCompile(`^qinqin/internal/db/step[0-9]{3}$`)

// Migration Go steps must not depend on live application code (review fix,
// phase A, 3; #171): a migration uses a frozen copy (step032, step038) of
// whatever application rule it applies, so changing the live code can never
// change how an old database upgrades. Migration code may import the
// standard library, module dependencies and frozen stepNNN packages; a
// frozen package may import nothing of the application at all.
func TestMigrationCodeImportsNoLiveCode(t *testing.T) {
	files, _ := filepath.Glob("*.go")
	steps, _ := filepath.Glob("step[0-9][0-9][0-9]/*.go")
	if len(steps) == 0 {
		t.Fatal("no frozen step packages found")
	}
	for _, f := range append(files, steps...) {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		frozen := strings.HasPrefix(f, "step")
		paths, err := importsOf(f, src)
		if err != nil {
			t.Fatal(err)
		}
		for _, path := range paths {
			switch {
			case frozen && strings.HasPrefix(path, "qinqin/"):
				t.Errorf("%s imports %s; a frozen step may not use application code", f, path)
			case !frozen && strings.HasPrefix(path, "qinqin/internal/") && !frozenStep.MatchString(path):
				t.Errorf("%s imports live code %s; copy what the migration needs into a frozen stepNNN package", f, path)
			}
		}
	}
}

// importsOf lists the import paths of a Go source file.
func importsOf(name string, src []byte) ([]string, error) {
	f, err := parser.ParseFile(token.NewFileSet(), name, src, parser.ImportsOnly)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, imp := range f.Imports {
		path, err := strconv.Unquote(imp.Path.Value)
		if err != nil {
			return nil, err
		}
		out = append(out, path)
	}
	return out, nil
}

// The scan finds every import form: grouped, aliased, with a trailing
// comment, and a one-line group (the forms a regex scan missed).
func TestImportsOfFindsEveryForm(t *testing.T) {
	for name, src := range map[string]string{
		"grouped":  "package db\n\nimport (\n\t\"fmt\"\n\n\t\"qinqin/internal/db/step038\"\n\tx \"qinqin/internal/model\"\n)\n\nfunc f() { _ = \"qinqin/internal/nope\" }\n",
		"comment":  "package db\n\nimport (\n\t\"fmt\"\n\t\"qinqin/internal/db/step038\" // frozen\n\t\"qinqin/internal/model\" // live\n)\n",
		"one-line": "package db\n\nimport (\"fmt\"; \"qinqin/internal/db/step038\"; \"qinqin/internal/model\")\n",
		"single":   "package db\n\nimport \"fmt\"\nimport \"qinqin/internal/db/step038\"\nimport m \"qinqin/internal/model\" // x\n",
	} {
		got, err := importsOf(name+".go", []byte(src))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if strings.Join(got, ",") != "fmt,qinqin/internal/db/step038,qinqin/internal/model" {
			t.Errorf("%s: imports %v", name, got)
		}
	}
}
