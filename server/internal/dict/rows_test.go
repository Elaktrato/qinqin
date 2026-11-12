package dict_test

import (
	"database/sql"
	"testing"
)

// longAgo is the timestamp the re-import tests backdate rows to, so rows
// written afterwards stand out.
const longAgo = "2020-01-01T00:00:00Z"

func totalRows(t *testing.T, sqlDB *sql.DB, table string) int {
	t.Helper()
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}
