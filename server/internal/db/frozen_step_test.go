package db

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Migration Go steps must not depend on live application code (review fix,
// phase A, 3): migration 038 uses its frozen copy (step038), so changing the
// study package or its tables can never change how an old database upgrades.
func TestMigrationCodeImportsNoLiveStudyCode(t *testing.T) {
	files, _ := filepath.Glob("*.go")
	more, _ := filepath.Glob("step038/*.go")
	for _, f := range append(files, more...) {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(src), `"qinqin/internal/study`) {
			t.Errorf("%s imports live study code", f)
		}
		// The frozen copy depends on nothing of the application at all.
		if strings.HasPrefix(f, "step038/") && strings.Contains(string(src), `"qinqin/`) {
			t.Errorf("%s imports application code; a frozen step may use the standard library only", f)
		}
	}
}
