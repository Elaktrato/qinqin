package dbtest

import (
	"context"
	"testing"
)

func TestCountingCountsStatementsAndTransactions(t *testing.T) {
	_, path := OpenPath(t)
	sqlDB, n := Counting(t, path)
	ctx := context.Background()
	if _, err := sqlDB.ExecContext(ctx, `INSERT INTO users (username, hash, updated_at) VALUES ('a', 'x', 't')`); err != nil {
		t.Fatal(err)
	}
	var c int
	if err := sqlDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&c); err != nil || c != 1 {
		t.Fatalf("count %d, %v", c, err)
	}
	stmt, err := sqlDB.PrepareContext(ctx, `SELECT username FROM users WHERE id = ?`)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		var s string
		if err := stmt.QueryRowContext(ctx, 1).Scan(&s); err != nil {
			t.Fatal(err)
		}
	}
	stmt.Close()
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET hash = 'y'`); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if got := n.Statements(); got != 5 {
		t.Errorf("%d statements, want 5 (exec, query, two prepared queries, exec in tx)", got)
	}
	if got := n.Transactions(); got != 1 {
		t.Errorf("%d transactions, want 1", got)
	}
	n.Reset()
	if n.Statements() != 0 || n.Transactions() != 0 {
		t.Error("Reset left counts")
	}
}
