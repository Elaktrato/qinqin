package lookup_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"sync/atomic"
	"testing"
)

// countingConnector opens connections of an existing driver and counts
// every statement they run, prepared or direct.
type countingConnector struct {
	drv   driver.Driver
	dsn   string
	count *atomic.Int64
	// onQuery, when set, sees the text of every statement.
	onQuery func(string)
}

func (c countingConnector) Connect(context.Context) (driver.Conn, error) {
	conn, err := c.drv.Open(c.dsn)
	if err != nil {
		return nil, err
	}
	return countingConn{conn, c.count, c.onQuery}, nil
}

func (c countingConnector) Driver() driver.Driver { return c.drv }

type countingConn struct {
	driver.Conn
	count   *atomic.Int64
	onQuery func(string)
}

func (c countingConn) seen(query string) {
	c.count.Add(1)
	if c.onQuery != nil {
		c.onQuery(query)
	}
}

func (c countingConn) Prepare(query string) (driver.Stmt, error) {
	c.seen(query)
	return c.Conn.Prepare(query)
}

func (c countingConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	q, ok := c.Conn.(driver.QueryerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	c.seen(query)
	return q.QueryContext(ctx, query, args)
}

func (c countingConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	e, ok := c.Conn.(driver.ExecerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	c.seen(query)
	return e.ExecContext(ctx, query, args)
}

// TestQueriesBounded checks that a full 12-rune window — 12 prefixes,
// kana ones also looked up by reading, plus every deinflection of each —
// costs a constant number of statements whatever the homographs: one
// batched lookup per category, not one per candidate or per homograph.
func TestQueriesBounded(t *testing.T) {
	seeded, path := openDB(t)
	importJMdict(t, seeded, jaWords+altWords)
	importKanjidic(t, seeded)
	// 生 has three word homographs with their own reading rows, plus a
	// KANJIDIC entry.
	importFreqPack(t, seeded, "a", jaFreq+"生,なま,900\n生,せい,1500\n生,き,8000\n")

	var count atomic.Int64
	counted := sql.OpenDB(countingConnector{drv: seeded.Driver(), dsn: path, count: &count})
	defer counted.Close()
	s := service(counted)

	tests := []struct {
		text string
		want int64
	}{
		// ByForm match (no hits, no loads) + ByReadingKind match and its 4
		// loads (entries, forms, readings, senses) + packs + frequency
		// rows + dictionary names.
		{"したしたしたしたしたしたした", 9},
		{"いるいるいるいるいるいる", 9},
		{"ことことことことことこと", 9},
		// ByForm match and its 4 loads; no kana term, so no reading
		// lookup; packs + frequency rows + dictionary names.
		{"生生生生生生生生生生生生生", 8},
	}
	for _, tt := range tests {
		count.Store(0)
		rs := run(t, s, "ja", tt.text, 0)
		if len(rs) == 0 {
			t.Fatalf("Lookup(%q) found nothing", tt.text)
		}
		if n := count.Load(); n != tt.want {
			t.Errorf("Lookup(%q) ran %d statements, want %d", tt.text, n, tt.want)
		}
	}
	rs := run(t, s, "ja", "生", 0)
	if len(rs) != 4 {
		t.Errorf("生 results = %v, want three words and the character", headwords(rs))
	}
}
