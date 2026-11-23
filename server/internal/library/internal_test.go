package library

import (
	"context"
	"testing"

	"qinqin/internal/dbtest"
)

func TestIsUniqueViolation(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	ins := `INSERT INTO library_books (user_id, workspace_id, language, title, source, source_id, created_at) VALUES (?, 1, 'zh', ?, 's', 'x', 't')`
	if _, err := sqlDB.ExecContext(ctx, ins, 1, "a"); err != nil {
		t.Fatal(err)
	}
	_, err := sqlDB.ExecContext(ctx, ins, 1, "b")
	if !isUniqueViolation(err) {
		t.Fatalf("duplicate not detected: %v", err)
	}
	_, err = sqlDB.ExecContext(ctx, ins, 2, nil)
	if err == nil || isUniqueViolation(err) {
		t.Fatalf("NOT NULL failure misreported: %v", err)
	}
}
