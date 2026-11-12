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
}

func (c countingConnector) Connect(context.Context) (driver.Conn, error) {
	conn, err := c.drv.Open(c.dsn)
	if err != nil {
		return nil, err
	}
	return countingConn{conn, c.count}, nil
}

func (c countingConnector) Driver() driver.Driver { return c.drv }

type countingConn struct {
	driver.Conn
	count *atomic.Int64
}

func (c countingConn) Prepare(query string) (driver.Stmt, error) {
	c.count.Add(1)
	return c.Conn.Prepare(query)
}

func (c countingConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	q, ok := c.Conn.(driver.QueryerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	c.count.Add(1)
	return q.QueryContext(ctx, query, args)
}

func (c countingConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	e, ok := c.Conn.(driver.ExecerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	c.count.Add(1)
	return e.ExecContext(ctx, query, args)
}

// TestQueriesBounded checks that a full 12-rune kana window — 12
// prefixes, each also looked up by reading, plus every deinflection of
// each — costs a small constant number of statements: one batched
// lookup per category, not one per candidate.
func TestQueriesBounded(t *testing.T) {
	seeded, path := openDB(t)
	importJMdict(t, seeded, jaWords+hanashi(false))
	importJaFreq(t, seeded)

	var count atomic.Int64
	counted := sql.OpenDB(countingConnector{drv: seeded.Driver(), dsn: path, count: &count})
	defer counted.Close()
	s := service(counted)

	for _, text := range []string{"したしたしたしたしたしたした", "いるいるいるいるいるいる", "ことことことことことこと"} {
		count.Store(0)
		rs := run(t, s, "ja", text, 0)
		if len(rs) == 0 {
			t.Fatalf("Lookup(%q) found nothing", text)
		}
		// ByForm and ByReading: 1 match + 4 loads each (entries, forms,
		// readings, senses); frequency packs 1 + lookup batches (a few:
		// one per homograph group); dictionary names 1.
		n := count.Load()
		t.Logf("Lookup(%q): %d statements", text, n)
		if n == 0 || n > 16 {
			t.Errorf("Lookup(%q) ran %d statements, want at most 16", text, n)
		}
	}
}
