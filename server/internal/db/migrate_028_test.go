package db

import "testing"

// TestMigration028CreatesTypeIndex checks the index the statistics
// endpoint (GET /api/stats/activity) relies on.
func TestMigration028CreatesTypeIndex(t *testing.T) {
	sqlDB := openMigrationDB(t)
	if err := migrateThrough(sqlDB, "028_study_events_type_index"); err != nil {
		t.Fatalf("migrate through 028: %v", err)
	}
	rows, err := sqlDB.Query(`SELECT name FROM pragma_index_list('study_events')`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	found := false
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
		found = found || n == "idx_study_events_user_type_ts"
	}
	if !found {
		t.Error("idx_study_events_user_type_ts missing")
	}
}
