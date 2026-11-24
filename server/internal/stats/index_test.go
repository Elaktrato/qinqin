package stats

import (
	"strings"
	"testing"

	"qinqin/internal/dbtest"
)

func TestActivityUsesTypeIndex(t *testing.T) {
	sqlDB := dbtest.Open(t)
	rules := Rules
	ws := int64(1)
	for _, r := range rules {
		for _, withWS := range []bool{false, true} {
			var w *int64
			if withWS {
				w = &ws
			}
			args := ruleArgs(r, 1, r.Type, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", w, `[{"d":"2026-01-01","lo":"2026-01-01T00:00:00Z","hi":"2026-01-02T00:00:00Z"}]`)
			rows, err := sqlDB.Query("EXPLAIN QUERY PLAN "+ruleQuery(r, withWS), args...)
			if err != nil {
				t.Fatalf("%s ws=%v: %v", r.Type, withWS, err)
			}
			var plan []string
			for rows.Next() {
				var id, parent, unused int
				var detail string
				if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
					t.Fatal(err)
				}
				plan = append(plan, detail)
			}
			rows.Close()
			p := strings.Join(plan, " | ")
			if !strings.Contains(p, "SEARCH study_events USING") || !strings.Contains(p, "INDEX idx_study_events_user_type_ts") {
				t.Errorf("%s ws=%v plan does not search with the index: %s", r.Type, withWS, p)
			}
			// The windows are the outer loop: their SCAN comes before the SEARCH.
			if scan, search := strings.Index(p, "SCAN w"), strings.Index(p, "SEARCH study_events"); scan < 0 || search < scan {
				t.Errorf("%s ws=%v plan does not scan the windows first: %s", r.Type, withWS, p)
			}
			// Each window is its own index range: the constraint comes from w, not from fixed bounds.
			if !strings.Contains(p, "ts>? AND ts<?") {
				t.Errorf("%s ws=%v plan has no ts range on the index: %s", r.Type, withWS, p)
			}
		}
	}
}
