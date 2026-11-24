package pack

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
)

// takeWriteLock is a write statement that changes no row: run first in a
// transaction, it takes SQLite's write lock, as BEGIN IMMEDIATE does, while
// the transaction stays a *sql.Tx.
const takeWriteLock = `UPDATE schema_migrations SET version = version WHERE 0`

// BeginWrite begins the transaction an import or an uninstall writes in,
// holding the write lock from the start. A deferred transaction that reads
// first (the stored rows to compare, an id to update) takes a snapshot; in
// WAL mode its first write then fails at once with SQLITE_BUSY if another
// connection committed since (the data package builder after the previous
// import), and the busy timeout does not help. Taking the lock first makes
// the other writer wait instead, or this one wait (busy_timeout) for it.
func BeginWrite(ctx context.Context, sqlDB *sql.DB) (*sql.Tx, error) {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, takeWriteLock); err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("take the write lock: %w", err)
	}
	if afterBegin != nil {
		afterBegin(tx)
	}
	return tx, nil
}

// afterBegin, if set, runs right after BeginWrite began a transaction (a
// test hook).
var afterBegin func(*sql.Tx)

// SetAfterBeginForTests has fn run right after every BeginWrite until the
// returned restore is called. It panics outside a test binary.
func SetAfterBeginForTests(fn func(*sql.Tx)) (restore func()) {
	if !testing.Testing() {
		panic("pack: SetAfterBeginForTests outside a test binary")
	}
	prev := afterBegin
	afterBegin = fn
	return func() { afterBegin = prev }
}
