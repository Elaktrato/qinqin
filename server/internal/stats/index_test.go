package stats

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/plugins"
)

func TestActivityUsesTypeIndex(t *testing.T) {
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	for _, raw := range plugins.Builtin() {
		if _, err := plugins.RegisterBuiltin(context.Background(), sqlDB, raw); err != nil {
			t.Fatal(err)
		}
	}
	rules, err := plugins.ActivityRules(context.Background(), sqlDB)
	if err != nil || len(rules) != 3 {
		t.Fatalf("rules = %v, err %v", rules, err)
	}
	ws := int64(1)
	for _, r := range rules {
		for _, withWS := range []bool{false, true} {
			var w *int64
			if withWS {
				w = &ws
			}
			args := ruleArgs(r.Rule, 1, r.Type, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", w)
			rows, err := sqlDB.Query("EXPLAIN QUERY PLAN "+ruleQuery(r.Rule, withWS), args...)
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
			if p := strings.Join(plan, " | "); !strings.Contains(p, "idx_study_events_user_type_ts") {
				t.Errorf("%s ws=%v plan does not use the index: %s", r.Type, withWS, p)
			}
		}
	}
}
