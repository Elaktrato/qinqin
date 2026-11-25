package auth_test

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/auth"
)

// The production parameters are what Hash uses unless a test lowers them.
func TestHashUsesTheProductionParameters(t *testing.T) {
	h := auth.Hash("secret-pass-1")
	if !strings.Contains(h, "$m=65536,t=3,p=4$") {
		t.Fatalf("hash %q, want m=65536,t=3,p=4", h)
	}
	if !auth.Verify(h, "secret-pass-1") {
		t.Error("the hash does not verify")
	}
}

// A test binary may lower the cost; the hash records it, verifies, and the
// restore brings the production parameters back.
func TestSetHashCostForTests(t *testing.T) {
	restore := auth.SetHashCostForTests(64, 1)
	h := auth.Hash("secret-pass-1")
	restore()
	if !strings.Contains(h, "$m=64,t=1,p=4$") {
		t.Fatalf("hash %q, want m=64,t=1,p=4", h)
	}
	if !auth.Verify(h, "secret-pass-1") || auth.Verify(h, "wrong") {
		t.Error("a low-cost hash does not verify as it should")
	}
	if h := auth.Hash("x"); !strings.Contains(h, "$m=65536,t=3,p=4$") {
		t.Errorf("after restore: %q", h)
	}
	// Zero means the production parameters.
	restore = auth.SetHashCostForTests(0, 0)
	defer restore()
	if h := auth.Hash("x"); !strings.Contains(h, "$m=65536,t=3,p=4$") {
		t.Errorf("SetHashCostForTests(0, 0): %q", h)
	}
}

// Only tests lower the cost: no non-test source calls the hook (it would
// also panic there, outside a test binary).
func TestNoServingCodeLowersTheHashCost(t *testing.T) {
	root := filepath.Join("..", "..")
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if strings.Contains(string(src), "SetHashCostForTests(") && !strings.HasSuffix(filepath.ToSlash(path), "internal/auth/auth.go") {
			t.Errorf("%s calls SetHashCostForTests", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
