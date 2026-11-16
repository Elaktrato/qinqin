package backup

import (
	"context"
	"io"
	"os"
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
		SELECT printf('01JDBIG%019d', i), ?1, ?2, 'web', printf('2026-01-01T00:00:00.%06dZ', i), 'review',
			printf('{"cardId":"c-vocab-%d","mode":"vocab","grade":3}', ?3), 't' FROM n`, u, w.Alice.WS1, w.E1)
	exec(t, w.DB, `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 20000)
		INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at)
		SELECT 'qinqin-flashcards', ?1, ?2, printf('card:BIGCARD%06d', i),
			printf('{"id":"BIGCARD%06d","kind":"vocab","entryId":%d,"deckIds":["general"]}', i, ?3), 1, 't', 't' FROM n`, u, w.Alice.WS1, w.E1)
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
