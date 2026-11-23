package api

import (
	"context"
	"database/sql"
	"net/http/httptest"
	"testing"

	"qinqin/internal/components"
	"qinqin/internal/dbtest"
)

// One GET /api/components reads the packs' version once, with or without
// packs.
func TestComponentsReadsVersionOnce(t *testing.T) {
	sqlDB := dbtest.Open(t)
	calls := 0
	old := componentsVersion
	componentsVersion = func(ctx context.Context, d *sql.DB, language string) (string, error) {
		calls++
		return components.Version(ctx, d, language)
	}
	defer func() { componentsVersion = old }()
	s := &server{db: sqlDB}
	for _, fill := range []bool{false, true} {
		if fill {
			if _, err := sqlDB.Exec(`INSERT INTO component_packs (pack_id, name, version, language, license, attribution, content_hash, updated_at)
				VALUES ('p', 'P', '1', 'ja', 'x', 'y', 'h', '2026-01-01T00:00:00Z')`); err != nil {
				t.Fatal(err)
			}
		}
		calls = 0
		rec := httptest.NewRecorder()
		s.handleListComponents(rec, httptest.NewRequest("GET", "/api/components?language=ja", nil))
		if rec.Code != 200 || calls != 1 {
			t.Errorf("packs=%v: status %d, Version called %d times, want 1", fill, rec.Code, calls)
		}
	}
}
