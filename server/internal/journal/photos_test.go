package journal

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"qinqin/internal/dbtest"
)

func newPhotos(t *testing.T, now *time.Time) Photos {
	t.Helper()
	sqlDB := dbtest.Open(t)
	return Photos{DB: sqlDB, Dir: filepath.Join(t.TempDir(), "journal"), Now: func() time.Time { return *now }}
}

func fileOf(p Photos, user int64, id string) string {
	return filepath.Join(p.Dir, itoa(user), id+".jpg")
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func exists(path string) bool { _, err := os.Stat(path); return err == nil }

func TestPhotosLifecycle(t *testing.T) {
	now := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	p := newPhotos(t, &now)
	ctx := context.Background()
	ph, err := p.Create(ctx, 1, 5, []byte("jpegdata"))
	if err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(fileOf(p, 1, ph.ID))
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("file: %v %v", err, st)
	}
	now = now.Add(20 * time.Minute)
	got, data, err := p.Get(ctx, 1, ph.ID)
	if err != nil || string(data) != "jpegdata" || got.WorkspaceID != 5 {
		t.Fatalf("Get: %v %q %+v", err, data, got)
	}
	var seen string
	p.DB.QueryRow(`SELECT last_seen_at FROM journal_photos WHERE id = ?`, ph.ID).Scan(&seen)
	if seen != now.Format(time.RFC3339) {
		t.Fatalf("last_seen_at = %s, want %s", seen, now.Format(time.RFC3339))
	}
	if _, _, err := p.Get(ctx, 2, ph.ID); !errors.Is(err, ErrPhotoNotFound) {
		t.Fatalf("foreign Get: %v", err)
	}
	if err := p.Touch(ctx, 2, ph.ID); !errors.Is(err, ErrPhotoNotFound) {
		t.Fatalf("foreign Touch: %v", err)
	}
	if err := p.Delete(ctx, 2, ph.ID); !errors.Is(err, ErrPhotoNotFound) || !exists(fileOf(p, 1, ph.ID)) {
		t.Fatalf("foreign Delete: %v", err)
	}
	if err := p.Delete(ctx, 1, ph.ID); err != nil {
		t.Fatal(err)
	}
	if exists(fileOf(p, 1, ph.ID)) {
		t.Fatal("file survived Delete")
	}
	if err := p.Delete(ctx, 1, ph.ID); !errors.Is(err, ErrPhotoNotFound) {
		t.Fatalf("second Delete: %v", err)
	}
}

func TestDeleteToleratesMissingFile(t *testing.T) {
	now := time.Now()
	p := newPhotos(t, &now)
	ph, _ := p.Create(context.Background(), 1, 5, []byte("x"))
	os.Remove(fileOf(p, 1, ph.ID))
	if err := p.Delete(context.Background(), 1, ph.ID); err != nil {
		t.Fatalf("Delete with missing file: %v", err)
	}
}

func TestPhotosPendingCap(t *testing.T) {
	now := time.Now()
	p := newPhotos(t, &now)
	for i := 0; i < MaxPendingPhotos; i++ {
		if _, err := p.Create(context.Background(), 1, 5, []byte("x")); err != nil {
			t.Fatalf("photo %d: %v", i, err)
		}
	}
	if _, err := p.Create(context.Background(), 1, 5, []byte("x")); !errors.Is(err, ErrTooManyPhotos) {
		t.Fatalf("11th: %v", err)
	}
	if _, err := p.Create(context.Background(), 2, 5, []byte("x")); err != nil {
		t.Fatalf("other user: %v", err)
	}
}

func TestSweep(t *testing.T) {
	now := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	p := newPhotos(t, &now)
	ctx := context.Background()
	mk := func(age time.Duration) Photo {
		now = time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC).Add(-age)
		ph, err := p.Create(ctx, 1, 5, []byte("x"))
		if err != nil {
			t.Fatal(err)
		}
		return ph
	}
	fresh := mk(59 * time.Minute)
	stale := mk(61 * time.Minute)
	touched := mk(23 * time.Hour)
	old := mk(25 * time.Hour)
	now = time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC).Add(-30 * time.Minute)
	if err := p.Touch(ctx, 1, touched.ID); err != nil {
		t.Fatal(err)
	}
	if err := p.Touch(ctx, 1, old.ID); err != nil { // seen recently, but created over 24 h ago
		t.Fatal(err)
	}
	now = time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	orphanFile := filepath.Join(p.Dir, "1", "01ORPHANFILE.jpg")
	os.WriteFile(orphanFile, []byte("x"), 0o600)
	os.WriteFile(filepath.Join(p.Dir, "1", "notes.txt"), []byte("x"), 0o600)
	missing := mk(10 * time.Minute)
	now = time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	os.Remove(fileOf(p, 1, missing.ID))

	removed, err := p.Sweep(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 4 {
		t.Fatalf("removed = %d, want 4 (stale, old, orphan file, orphan row)", removed)
	}
	for _, c := range []struct {
		ph   Photo
		want bool
	}{{fresh, true}, {stale, false}, {touched, true}, {old, false}, {missing, false}} {
		var n int
		p.DB.QueryRow(`SELECT COUNT(*) FROM journal_photos WHERE id = ?`, c.ph.ID).Scan(&n)
		if (n == 1) != c.want {
			t.Errorf("row of %s: present = %v, want %v", c.ph.ID, n == 1, c.want)
		}
		if c.ph.ID != missing.ID && exists(fileOf(p, 1, c.ph.ID)) != c.want {
			t.Errorf("file of %s: want present = %v", c.ph.ID, c.want)
		}
	}
	if exists(orphanFile) {
		t.Error("orphan file survived")
	}
	if !exists(filepath.Join(p.Dir, "1", "notes.txt")) {
		t.Error("non-photo file must not be touched")
	}
}

func TestDeleteWorkspacePhotosTx(t *testing.T) {
	now := time.Now()
	p := newPhotos(t, &now)
	ctx := context.Background()
	a, _ := p.Create(ctx, 1, 5, []byte("x"))
	b, _ := p.Create(ctx, 1, 5, []byte("x"))
	c, _ := p.Create(ctx, 1, 6, []byte("x"))
	var ids []string
	err := func() error {
		tx, err := p.DB.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer tx.Rollback()
		ids, err = DeleteWorkspacePhotosTx(ctx, tx, 1, 5)
		if err != nil {
			return err
		}
		return tx.Commit()
	}()
	if err != nil || len(ids) != 2 {
		t.Fatalf("ids = %v, err = %v", ids, err)
	}
	if err := p.RemoveFiles(1, ids); err != nil {
		t.Fatal(err)
	}
	if exists(fileOf(p, 1, a.ID)) || exists(fileOf(p, 1, b.ID)) || !exists(fileOf(p, 1, c.ID)) {
		t.Fatal("wrong files removed")
	}
	var n int
	p.DB.QueryRow(`SELECT COUNT(*) FROM journal_photos`).Scan(&n)
	if n != 1 {
		t.Fatalf("rows left = %d", n)
	}
	var _ *sql.DB = p.DB
}

func TestRunJanitorSweepsAtStart(t *testing.T) {
	now := time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)
	p := newPhotos(t, &now)
	ph, _ := p.Create(context.Background(), 1, 5, []byte("x"))
	now = now.Add(2 * time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { RunJanitor(ctx, p, nil, time.Hour, t.Logf); close(done) }()
	deadline := time.Now().Add(5 * time.Second)
	for exists(fileOf(p, 1, ph.ID)) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	<-done
	if exists(fileOf(p, 1, ph.ID)) {
		t.Fatal("the janitor did not sweep at start")
	}
}

func TestPhotosPendingCapParallel(t *testing.T) {
	now := time.Now()
	p := newPhotos(t, &now)
	var wg sync.WaitGroup
	var ok, full atomic.Int32
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := p.Create(context.Background(), 1, 5, []byte("x"))
			switch {
			case err == nil:
				ok.Add(1)
			case errors.Is(err, ErrTooManyPhotos):
				full.Add(1)
			default:
				t.Errorf("create: %v", err)
			}
		}()
	}
	wg.Wait()
	if ok.Load() != MaxPendingPhotos || full.Load() != 40-MaxPendingPhotos {
		t.Fatalf("created %d, refused %d; want %d and %d", ok.Load(), full.Load(), MaxPendingPhotos, 40-MaxPendingPhotos)
	}
	if n, _ := p.Count(context.Background(), 1); n != MaxPendingPhotos {
		t.Fatalf("Count = %d", n)
	}
}
