package db

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// importLine matches one import path of a Go file (single or grouped form).
var importLine = regexp.MustCompile(`(?m)^\s*(?:import\s+)?(?:[A-Za-z_.]+\s+)?"([^"]+)"\s*$`)

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
		for _, m := range importLine.FindAllStringSubmatch(importBlock(string(src)), -1) {
			path := m[1]
			switch {
			case frozen && strings.HasPrefix(path, "qinqin/"):
				t.Errorf("%s imports %s; a frozen step may not use application code", f, path)
			case !frozen && strings.HasPrefix(path, "qinqin/internal/") && !frozenStep.MatchString(path):
				t.Errorf("%s imports live code %s; copy what the migration needs into a frozen stepNNN package", f, path)
			}
		}
	}
}

// importBlock returns the import declarations of a Go source file: from the
// first import to the first top-level declaration after it.
func importBlock(src string) string {
	i := strings.Index(src, "\nimport")
	if i < 0 {
		return ""
	}
	rest := src[i:]
	for _, end := range []string{"\nfunc ", "\nvar ", "\nconst ", "\ntype "} {
		if j := strings.Index(rest, end); j >= 0 {
			rest = rest[:j]
		}
	}
	return rest
}

// The scan itself: a live import is found, a frozen one is allowed.
func TestImportBlockScan(t *testing.T) {
	src := "package db\n\nimport (\n\t\"fmt\"\n\n\t\"qinqin/internal/db/step038\"\n\tx \"qinqin/internal/model\"\n)\n\nfunc f() { _ = \"qinqin/internal/nope\" }\n"
	var got []string
	for _, m := range importLine.FindAllStringSubmatch(importBlock(src), -1) {
		got = append(got, m[1])
	}
	if strings.Join(got, ",") != "fmt,qinqin/internal/db/step038,qinqin/internal/model" {
		t.Fatalf("imports %v", got)
	}
}
