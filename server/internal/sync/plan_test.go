package sync

import (
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/db"
)

// The lexicon pulls scan by updated_at: each must be driven by its
// updated_at index, not a table scan.
func TestLexiconPullsUseUpdatedAtIndex(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "plan.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	for _, tc := range []struct{ name, query, index string }{
		{"entries", entriesQuery, "idx_lx_entries_updated"},
		{"senses", sensesQuery, "idx_lx_senses_updated"},
		{"links", linksQuery, "idx_lx_links_updated"},
	} {
		for _, live := range []string{"", liveOnly} {
			rows, err := sqlDB.Query("EXPLAIN QUERY PLAN "+strings.Replace(tc.query, "%s", live, 1), "2026-01-01T00:00:00Z")
			if err != nil {
				t.Fatalf("%s: %v", tc.name, err)
			}
			var plan strings.Builder
			for rows.Next() {
				var id, parent, unused int
				var detail string
				if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
					t.Fatal(err)
				}
				plan.WriteString(detail + "\n")
			}
			rows.Close()
			if !strings.Contains(plan.String(), "USING INDEX "+tc.index) {
				t.Errorf("%s (live=%q) plan:\n%s\nwant %s", tc.name, live, plan.String(), tc.index)
			}
		}
	}
}
