package backup

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"
)

// bigWorld fills one user with a million events and 20 000 card rows in
// single statements (recursive CTEs), so setup takes seconds.
func bigWorld(t *testing.T) *baseWorld {
	t.Helper()
	if os.Getenv("QINQIN_BIG_TESTS") != "1" {
		t.Skip("set QINQIN_BIG_TESTS=1 to run the million-event tests")
	}
	w := newWorld(t)
	u := w.AliceUID
	exec(t, w.DB, `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 1000000)
		INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at)
		SELECT printf('01JDB6G%019d', i), ?1, ?2, 'web', printf('2026-01-01T00:00:00.%06dZ', i), 'review',
			printf('{"cardId":"c-vocab-%d","mode":"vocab","grade":3}', ?3), 't' FROM n`, u, w.Alice.WS1, w.E1)
	exec(t, w.DB, `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 20000)
		INSERT INTO study_cards (user_id, workspace_id, id, kind, entry_id, deck_ids, created_at, version, updated_at, modified_at)
		SELECT ?1, ?2, printf('BIGCARD%06d', i), 'vocab', ?3, '["general"]', '2026-01-01T00:00:00Z', 1,
			'2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z' FROM n`, u, w.Alice.WS1, w.E1)
	return w
}

// sampleHeap records the highest HeapInuse until stop is closed.
func sampleHeap() (peak *atomic.Uint64, stop func()) {
	peak = &atomic.Uint64{}
	done := make(chan struct{})
	fin := make(chan struct{})
	go func() {
		defer close(fin)
		var ms runtime.MemStats
		for {
			select {
			case <-done:
				return
			case <-time.After(20 * time.Millisecond):
			}
			runtime.ReadMemStats(&ms)
			if ms.HeapInuse > peak.Load() {
				peak.Store(ms.HeapInuse)
			}
		}
	}()
	return peak, func() { close(done); <-fin }
}

func TestBigExportStaysMemoryBound(t *testing.T) {
	w := bigWorld(t)
	runtime.GC()
	peak, stop := sampleHeap()
	man, err := WriteUser(context.Background(), w.DB, w.Data, w.AliceUID, io.Discard, testMeta)
	stop()
	if err != nil {
		t.Fatal(err)
	}
	if man.Counts["events"] != 1000004 || man.Counts["pluginData"] != 20005 {
		t.Errorf("counts %v", man.Counts)
	}
	if mib := peak.Load() >> 20; mib >= 64 {
		t.Errorf("peak HeapInuse %d MiB, want < 64", mib)
	}
	t.Logf("peak heap %d MiB", peak.Load()>>20)
}

func TestBigRestoreFinishesQuicklyAndStaysMemoryBound(t *testing.T) {
	w := bigWorld(t)
	p := filepath.Join(t.TempDir(), "big.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := WriteUser(context.Background(), w.DB, w.Data, w.AliceUID, f, testMeta); err != nil {
		t.Fatal(err)
	}
	f.Close()
	runtime.GC()
	peak, stop := sampleHeap()
	start := time.Now()
	a, err := Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	res, _, err := Restore(context.Background(), deps(w), w.AliceUID, 0, a, Options{})
	elapsed := time.Since(start)
	stop()
	if err != nil {
		t.Fatal(err)
	}
	if res.Restored.Events != 1000004 || res.Restored.Cards < 20000 {
		t.Errorf("result %+v", res.Restored)
	}
	if elapsed > 60*time.Second {
		t.Errorf("restore took %s, want < 60s", elapsed)
	}
	if mib := peak.Load() >> 20; mib >= 64 {
		t.Errorf("peak HeapInuse %d MiB, want < 64", mib)
	}
	t.Logf("restore (validate + safety export + apply) %s, peak heap %d MiB", elapsed, peak.Load()>>20)
}
