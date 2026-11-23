package api

import (
	"strings"
	"testing"

	"qinqin/internal/dbtest"
)

// TestInstalledLanguagesPlan pins the installed-languages query to index
// seeks: it runs on every GET /api/languages and on a new user's first
// GET /api/workspaces, so it must not scan every entry or sense.
func TestInstalledLanguagesPlan(t *testing.T) {
	sqlDB := dbtest.Open(t)
	rows, err := sqlDB.Query(`EXPLAIN QUERY PLAN ` + installedLanguagesSQL)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	defer rows.Close()
	var plan []string
	for rows.Next() {
		var id, parent, notused int
		var detail string
		if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
			t.Fatal(err)
		}
		plan = append(plan, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	// Only the CTE's own rows (one per language) may be scanned.
	for _, step := range plan {
		if strings.HasPrefix(step, "SCAN ") && step != "SCAN langs" {
			t.Errorf("plan step %q scans a table; plan = %q", step, plan)
		}
	}
}
