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

// A lock file this user cannot write (created by root, say) still locks:
// flock needs only a read descriptor.
func TestAReadOnlyLockFileStillLocks(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	dir := filepath.Join(t.TempDir(), "packages")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".lock"), nil, 0o444); err != nil {
		t.Fatal(err)
	}
	if _, err := packs.Import(ctx, sqlDB, versionPack(t, "dictionary", "cedict", "zh", "v1")); err != nil {
		t.Fatal(err)
	}
	reg := datapkg.Registry{DB: sqlDB, Dir: dir, AudioDir: t.TempDir()}
	if err := reg.Reconcile(ctx); err != nil {
		t.Fatalf("reconcile with a read-only lock file: %v", err)
	}
}

// A file moved into place whose rows then fail to commit (a cancelled
// build at shutdown, or any error after the rename) is removed again, so no
// revision file exists that the catalogue does not describe.
func TestAMovedFileWhoseRowsFailIsRemoved(t *testing.T) {
	ctx := context.Background()
	clock := &testClock{now: time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)}
	e := newPkgEnv(t, newDB(t), clock)
	importAll(t, e, "cedict/v1")
	restore := datapkg.SetRenameHookForTest(func(from, to string) error {
		if err := os.Rename(from, to); err != nil {
			return err
		}
		return errors.New("injected failure after the rename")
	})
	clock.Add(time.Minute)
	importAll(t, e, "cedict/v2")
	restore()
	if _, err := os.Stat(filepath.Join(e.reg.Dir, "lexicon.zh", "r2.qqpkg")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("r2 file after its rows failed: %v, want it removed", err)
	}
	if f, _, err := e.reg.Open(ctx, "lexicon.zh", 1); err != nil {
		t.Fatalf("r1 after the failure: %v", err)
	} else {
		f.Close()
	}
}
