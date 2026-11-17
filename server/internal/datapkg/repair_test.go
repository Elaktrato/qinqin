package datapkg_test

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
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

// A build whose file cannot be moved into place is a recorded failure:
// the previous revision stays the served one, and the next reconcile
// retries.
func TestAFailedRenameKeepsThePreviousRevision(t *testing.T) {
	ctx := context.Background()
	clock := &testClock{now: time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)}
	e := newPkgEnv(t, newDB(t), clock)
	importAll(t, e, "cedict/v1")
	restore := datapkg.SetRenameHookForTest(func(string, string) error { return errors.New("injected rename failure") })
	clock.Add(time.Minute)
	importAll(t, e, "cedict/v2")
	restore()
	cat, err := e.reg.Catalogue(ctx, []string{"zh"}, true)
	if err != nil {
		t.Fatal(err)
	}
	row := cat.Packages[0]
	if row.State != "ready" || row.Revision != 1 || !strings.Contains(row.Error, "injected rename failure") {
		t.Fatalf("after a failed rename: %s r%d error %q, want ready r1 with the error", row.State, row.Revision, row.Error)
	}
	f, info, err := e.reg.Open(ctx, "lexicon.zh", 1)
	if err != nil {
		t.Fatalf("r1 after a failed rename: %v", err)
	}
	body, _ := io.ReadAll(f)
	f.Close()
	if sha(body) != row.SHA256 || info.SHA256 != row.SHA256 {
		t.Fatalf("r1 file %s, row %s, package_files %s", sha(body), row.SHA256, info.SHA256)
	}
	if _, _, err := e.reg.Open(ctx, "lexicon.zh", 2); !errors.Is(err, datapkg.ErrNotFound) {
		t.Fatalf("r2 after a failed rename: %v, want ErrNotFound", err)
	}
	e.b.KickReconcile()
	e.drain()
	cat, _ = e.reg.Catalogue(ctx, []string{"zh"}, true)
	if row := cat.Packages[0]; row.State != "ready" || row.Revision != 2 || row.Error != "" {
		t.Fatalf("after the retry: %s r%d error %q, want ready r2", row.State, row.Revision, row.Error)
	}
}
