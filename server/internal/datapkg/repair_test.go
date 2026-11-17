package datapkg_test

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"qinqin/internal/datapkg"
	"qinqin/internal/packs"
)

// A current file whose size is not its row's is replaced under its own
// revision by the next reconcile, once; the reconcile after it builds
// nothing.
func TestAWrongSizeCurrentFileIsReplacedOnce(t *testing.T) {
	ctx := context.Background()
	clock := &testClock{now: time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)}
	e := newPkgEnv(t, newDB(t), clock)
	if _, err := packs.Import(ctx, e.db, versionPack(t, "dictionary", "cedict", "zh", "v1"), e.onChange()); err != nil {
		t.Fatal(err)
	}
	e.drain()
	path := filepath.Join(e.reg.Dir, "lexicon.zh", "r1.qqpkg")
	if err := os.Truncate(path, 10); err != nil {
		t.Fatal(err)
	}
	var builds atomic.Int32
	restore := datapkg.SetBuildHookForTest(func(string) error { builds.Add(1); return nil })
	defer restore()
	e.b.KickReconcile()
	e.drain()
	if n := builds.Load(); n != 1 {
		t.Fatalf("first reconcile: %d builds, want 1", n)
	}
	cat, err := e.reg.Catalogue(ctx, []string{"zh"}, true)
	if err != nil {
		t.Fatal(err)
	}
	row := cat.Packages[0]
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if row.Revision != 1 || row.Error != "" || sha(body) != row.SHA256 || int64(len(body)) != row.Bytes {
		t.Fatalf("row r%d error %q sha %s bytes %d; file sha %s bytes %d", row.Revision, row.Error, row.SHA256, row.Bytes, sha(body), len(body))
	}
	if got := revisionFiles(t, e.reg.Dir, "lexicon.zh"); len(got) != 1 || got[0] != 1 {
		t.Fatalf("files %v, want [1]", got)
	}
	e.b.KickReconcile()
	e.drain()
	if n := builds.Load(); n != 1 {
		t.Fatalf("second reconcile built again: %d builds", n)
	}
}
