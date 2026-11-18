package levels_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"path/filepath"
	"sync/atomic"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/lang"
	"qinqin/internal/levels"
)

// countingConnector counts every statement its connections run.
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

// TestLowestPerSchemeBatched: one entry in HSK levels 3 and 5 keeps 3; two
// schemes give two levels in scheme order; one statement serves any number
// of ids (and none at all for no ids).
func TestLowestPerSchemeBatched(t *testing.T) {
	lang.Register(lang.Zh{})
	path := filepath.Join(t.TempDir(), "test.db")
	sqlDB, err := db.Open(path)
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	importCedict(t, sqlDB,
		"好 好 [hao3] /good/",
		"好人 好人 [hao3 ren2] /good person/",
		"行 行 [xing2] /to walk/")
	hao := lexID(t, sqlDB, "character", "好")
	haoren := lexID(t, sqlDB, "word", "好人")
	xing := lexID(t, sqlDB, "character", "行")

	hsk := buildPack(t, "hsk-low", `{"unit":"character","levels":[{"name":"3","entries":["好"]},{"name":"5","entries":["好"]}]}`)
	if _, err := levels.Import(context.Background(), sqlDB, hsk); err != nil {
		t.Fatalf("import hsk: %v", err)
	}
	other := buildPack(t, "other-low", `{"unit":"character","levels":[{"name":"N5","entries":["好"]}]}`)
	if _, err := levels.Import(context.Background(), sqlDB, other); err != nil {
		t.Fatalf("import other: %v", err)
	}
	words := buildPack(t, "hsk-words", `{"unit":"word","levels":[{"name":"5","entries":["好人"]}]}`)
	if _, err := levels.Import(context.Background(), sqlDB, words); err != nil {
		t.Fatalf("import hsk words: %v", err)
	}

	var count atomic.Int64
	counted := sql.OpenDB(countingConnector{
		drv:   sqlDB.Driver(),
		dsn:   path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)",
		count: &count,
	})
	t.Cleanup(func() { counted.Close() })

	count.Store(0)
	got, err := levels.LowestPerScheme(context.Background(), counted, []int64{hao})
	if err != nil {
		t.Fatalf("LowestPerScheme(好): %v", err)
	}
	one := count.Load()
	if one == 0 || len(got[hao]) != 3 ||
		got[hao][0].LevelName != "3" ||
		got[hao][1].LevelName != "N5" ||
		got[hao][2].LevelName != "5" {
		t.Errorf("好 levels = %+v (in %d statements), want 3, N5 then the derived 5", got[hao], one)
	}

	count.Store(0)
	got, err = levels.LowestPerScheme(context.Background(), counted, []int64{hao, haoren, xing})
	if err != nil {
		t.Fatalf("LowestPerScheme(three): %v", err)
	}
	three := count.Load()
	if three != one {
		t.Errorf("three ids ran %d statements, one id ran %d; want the same", three, one)
	}
	if ls := got[haoren]; len(ls) != 1 || ls[0].LevelName != "5" {
		t.Errorf("好人 levels = %+v, want the word scheme 5", ls)
	}
	if len(got[xing]) != 0 {
		t.Errorf("行 levels = %+v, want none", got[xing])
	}

	count.Store(0)
	if _, err := levels.LowestPerScheme(context.Background(), counted, nil); err != nil || count.Load() != 0 {
		t.Errorf("no ids: err %v, %d statements, want none", err, count.Load())
	}
}
