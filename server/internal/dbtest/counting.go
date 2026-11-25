package dbtest

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"sync/atomic"
	"testing"

	"modernc.org/sqlite"
)

// Counter counts what a Counting database handle sent to SQLite: the
// statements executed or queried (prepared or not) and the transactions
// begun. A performance test asserts these counts instead of a time.
type Counter struct {
	statements   atomic.Int64
	transactions atomic.Int64
}

// Statements is the number of statements executed or queried.
func (c *Counter) Statements() int64 { return c.statements.Load() }

// Transactions is the number of transactions begun.
func (c *Counter) Transactions() int64 { return c.transactions.Load() }

// Reset sets both counts to zero.
func (c *Counter) Reset() { c.statements.Store(0); c.transactions.Store(0) }

// Counting opens the existing database at path through a counting
// wrapper of the SQLite driver, with the connection settings of db.Open
// and no migration. The handle is closed when the test ends.
func Counting(t testing.TB, path string) (*sql.DB, *Counter) {
	t.Helper()
	c := &Counter{}
	sqlDB := sql.OpenDB(connector{dsn: path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)", c: c})
	if err := sqlDB.Ping(); err != nil {
		t.Fatalf("dbtest: open %s: %v", path, err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB, c
}

type connector struct {
	dsn string
	c   *Counter
}

func (k connector) Connect(context.Context) (driver.Conn, error) {
	inner, err := (&sqlite.Driver{}).Open(k.dsn)
	if err != nil {
		return nil, err
	}
	return &conn{inner: inner, c: k.c}, nil
}

func (k connector) Driver() driver.Driver { return &sqlite.Driver{} }

// The interfaces the modernc connection implements, forwarded.
type innerConn interface {
	driver.Conn
	driver.ConnBeginTx
	driver.ConnPrepareContext
	driver.ExecerContext
	driver.QueryerContext
}

type conn struct {
	inner driver.Conn
	c     *Counter
}

func (x *conn) in() innerConn { return x.inner.(innerConn) }

func (x *conn) Prepare(q string) (driver.Stmt, error) {
	return x.PrepareContext(context.Background(), q)
}
func (x *conn) Close() error { return x.inner.Close() }
func (x *conn) Begin() (driver.Tx, error) {
	return x.BeginTx(context.Background(), driver.TxOptions{})
}
func (x *conn) BeginTx(ctx context.Context, o driver.TxOptions) (driver.Tx, error) {
	x.c.transactions.Add(1)
	return x.in().BeginTx(ctx, o)
}
func (x *conn) PrepareContext(ctx context.Context, q string) (driver.Stmt, error) {
	s, err := x.in().PrepareContext(ctx, q)
	if err != nil {
		return nil, err
	}
	return &stmt{inner: s, c: x.c}, nil
}
func (x *conn) ExecContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Result, error) {
	x.c.statements.Add(1)
	return x.in().ExecContext(ctx, q, args)
}
func (x *conn) QueryContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	x.c.statements.Add(1)
	return x.in().QueryContext(ctx, q, args)
}
func (x *conn) ResetSession(ctx context.Context) error {
	if r, ok := x.inner.(driver.SessionResetter); ok {
		return r.ResetSession(ctx)
	}
	return nil
}
func (x *conn) IsValid() bool {
	if v, ok := x.inner.(driver.Validator); ok {
		return v.IsValid()
	}
	return true
}

type innerStmt interface {
	driver.Stmt
	driver.StmtExecContext
	driver.StmtQueryContext
}

type stmt struct {
	inner driver.Stmt
	c     *Counter
}

func (s *stmt) Close() error  { return s.inner.Close() }
func (s *stmt) NumInput() int { return s.inner.NumInput() }
func (s *stmt) Exec(args []driver.Value) (driver.Result, error) {
	s.c.statements.Add(1)
	return s.inner.Exec(args) //nolint:staticcheck // the driver.Stmt interface
}
func (s *stmt) Query(args []driver.Value) (driver.Rows, error) {
	s.c.statements.Add(1)
	return s.inner.Query(args) //nolint:staticcheck // the driver.Stmt interface
}
func (s *stmt) ExecContext(ctx context.Context, args []driver.NamedValue) (driver.Result, error) {
	s.c.statements.Add(1)
	return s.inner.(innerStmt).ExecContext(ctx, args)
}
func (s *stmt) QueryContext(ctx context.Context, args []driver.NamedValue) (driver.Rows, error) {
	s.c.statements.Add(1)
	return s.inner.(innerStmt).QueryContext(ctx, args)
}
