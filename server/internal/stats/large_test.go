package stats_test

import (
	"context"
	"database/sql"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"qinqin/internal/db"
	"qinqin/internal/plugins"
	"qinqin/internal/stats"
	"qinqin/internal/studyday"
)

type largeFixture struct {
	db    *sql.DB
	user  int64
	rules []plugins.RuleOf
	rows  int
}

var (
	largeOnce sync.Once
	large     largeFixture
	largeDir  string
)

func TestMain(m *testing.M) {
	code := m.Run()
	if largeDir != "" {
		os.RemoveAll(largeDir)
	}
	os.Exit(code)
}

// seedLarge builds one year for user 1 (about 400k events) and 100k
// reviews for user 2.
func seedLarge(tb testing.TB) largeFixture {
	largeOnce.Do(func() {
		// The fixture outlives the first test or benchmark that builds
		// it, so it lives in its own directory removed by TestMain.
		dir, err := os.MkdirTemp("", "stats-large")
		if err != nil {
			tb.Fatal(err)
		}
		largeDir = dir
		sqlDB, err := db.Open(filepath.Join(dir, "large.db"))
		if err != nil {
			tb.Fatal(err)
		}
		rules := builtinRules(tb, sqlDB)
		u1, u2 := newUser(tb, sqlDB, "big"), newUser(tb, sqlDB, "other")
		tx, err := sqlDB.Begin()
		if err != nil {
			tb.Fatal(err)
		}
		stmt, err := tx.Prepare(`INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES (?, ?, ?, 'd', ?, ?, ?, 't')`)
		if err != nil {
			tb.Fatal(err)
		}
		rng := rand.New(rand.NewSource(48))
		n := 0
		ins := func(user, ws int64, ts time.Time, typ, payload string) {
			n++
			if _, err := stmt.Exec(fmt.Sprintf("L%09d", n), user, ws, ts.Format(time.RFC3339), typ, payload); err != nil {
				tb.Fatal(err)
			}
		}
		today := time.Now().UTC().Truncate(24 * time.Hour)
		for d := 0; d < 365; d++ {
			base := today.AddDate(0, 0, -d)
			at := func() time.Time { return base.Add(time.Duration(rng.Intn(86400)) * time.Second) }
			for i := 0; i < 1000; i++ {
				ins(u1, int64(1+rng.Intn(2)), at(), "review", "null")
			}
			for i := 0; i < 80; i++ {
				ins(u1, int64(1+rng.Intn(2)), at(), "read", fmt.Sprintf(`{"seconds":%d}`, 10+rng.Intn(2991)))
			}
			for i := 0; i < 15; i++ {
				ins(u1, int64(1+rng.Intn(2)), at(), "journal", fmt.Sprintf(`{"entryId":"e%d"}`, rng.Intn(5)))
			}
		}
		own := n
		for i := 0; i < 100000; i++ {
			ins(u2, 1, today.AddDate(0, 0, -rng.Intn(365)).Add(time.Duration(rng.Intn(86400))*time.Second), "review", "null")
		}
		if err := stmt.Close(); err != nil {
			tb.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			tb.Fatal(err)
		}
		large = largeFixture{db: sqlDB, user: u1, rules: rules, rows: own}
	})
	return large
}

// window91 is the heatmap's 91 learner days (the zone is Asia/Tokyo, so
// every window is offset from the UTC days the events were seeded on).
func window91() []studyday.Window {
	h, err := studyday.New([]studyday.Change{{Zone: "Asia/Tokyo"}})
	if err != nil {
		panic(err)
	}
	to := h.DayOf(time.Now())
	return h.Windows(to.AddDays(-90), to)
}

func TestActivityLargeLog(t *testing.T) {
	if testing.Short() {
		t.Skip("large log")
	}
	f := seedLarge(t)
	windows := window91()
	start := time.Now()
	cells, err := stats.Activity(context.Background(), f.db, f.user, windows, nil, f.rules)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("user events %d, 91-day Activity: %v, %d cells", f.rows, elapsed, len(cells))
	ws := int64(1)
	start = time.Now()
	one, err := stats.Activity(context.Background(), f.db, f.user, windows, &ws, f.rules)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("91-day Activity, one workspace: %v, %d cells", time.Since(start), len(one))
	if len(cells) == 0 {
		t.Error("no cells")
	}
	if elapsed > 2*time.Second && !raceEnabled {
		t.Errorf("Activity took %v, want < 2s", elapsed)
	}
}

func BenchmarkActivity91Days(b *testing.B) {
	f := seedLarge(b)
	windows := window91()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err := stats.Activity(context.Background(), f.db, f.user, windows, nil, f.rules); err != nil {
			b.Fatal(err)
		}
	}
}
