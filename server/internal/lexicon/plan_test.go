package lexicon

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/db"
)

// The pre-fix match queries, kept as the control: on the same database
// they must pick the language index, which proves the setup would catch
// a regression to that shape.
const (
	oldByFormQuery = `
		SELECT DISTINCT f.text, e.id FROM lx_forms f
		JOIN lx_entries e ON e.id = f.entry_id
		WHERE e.language = ? AND e.deleted_at IS NULL AND f.deleted_at IS NULL
		  AND f.text IN (%s)
		ORDER BY f.text, e.id`
	oldByReadingQuery = `
		SELECT DISTINCT r.plain, e.id FROM lx_readings r
		JOIN lx_entries e ON e.id = r.entry_id
		WHERE e.language = ? AND e.deleted_at IS NULL AND r.deleted_at IS NULL
		  AND r.plain IN (%s)
		ORDER BY r.plain, e.id`
	oldBestQuery = `
		SELECT e.id FROM lx_entries e
		WHERE e.language = ? AND e.kind = ? AND e.deleted_at IS NULL
		  AND EXISTS (SELECT 1 FROM lx_forms f
		              WHERE f.entry_id = e.id AND f.text = ? AND f.deleted_at IS NULL)
		ORDER BY (e.uk = 1 AND e.pri > 0) DESC, e.pri DESC, e.id
		LIMIT 1`
)

// seededPlanDB is a database holding words and characters of three
// languages, each with forms and readings, and planner statistics
// (ANALYZE) as a long-lived database would gather them.
func seededPlanDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "plan.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	st := Store{DB: sqlDB}
	ctx := context.Background()
	var dictID int64
	if err := sqlDB.QueryRow(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES ('d', 'd', '1', 'x', 'x', '2026-01-01T00:00:00Z') RETURNING id`).Scan(&dictID); err != nil {
		t.Fatal(err)
	}
	for _, language := range []string{"ja", "zh", "ko"} {
		for i := 0; i < 400; i++ {
			kind := "word"
			if i%4 == 0 {
				kind = "character"
			}
			e := &Entry{
				Language: language, Kind: kind, Key: fmt.Sprintf("%s%d", language, i),
				Forms:    []Form{{Text: fmt.Sprintf("f%d", i)}, {Text: fmt.Sprintf("g%d", i)}},
				Readings: []Reading{{Type: "kana", Value: fmt.Sprintf("r%d", i%50), Plain: fmt.Sprintf("r%d", i%50)}},
				Senses:   []Sense{{Glosses: []string{"x"}}},
			}
			if _, err := st.Put(ctx, e, dictID); err != nil {
				t.Fatal(err)
			}
		}
	}
	return sqlDB
}

// plan returns the EXPLAIN QUERY PLAN detail lines of query.
func plan(t *testing.T, sqlDB *sql.DB, query string, args ...any) string {
	t.Helper()
	rows, err := sqlDB.Query("EXPLAIN QUERY PLAN "+query, args...)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var id, parent, notused int
		var detail string
		if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
			t.Fatal(err)
		}
		lines = append(lines, detail)
	}
	return strings.Join(lines, "; ")
}

// keyArgs is n IN-list values followed by extra.
func keyArgs(n int, extra ...any) []any {
	var args []any
	for i := 0; i < n; i++ {
		args = append(args, fmt.Sprintf("f%d", i))
	}
	return append(args, extra...)
}

func TestMatchQueriesUseTheTextIndexes(t *testing.T) {
	sqlDB := seededPlanDB(t)
	const n = 12
	in := placeholders(n)
	for _, analyzed := range []bool{false, true} {
		if analyzed {
			if _, err := sqlDB.Exec(`ANALYZE`); err != nil {
				t.Fatal(err)
			}
		}
		tests := []struct {
			name, query string
			args        []any
			want        string
		}{
			{"ByForm", fmt.Sprintf(byFormQuery, in), keyArgs(n, "ja"), "SEARCH f USING INDEX idx_lx_forms_text"},
			{"ByReading", fmt.Sprintf(byReadingQuery, in), keyArgs(n, "ja"), "SEARCH r USING INDEX idx_lx_readings_plain"},
			{"ByReadingKind", fmt.Sprintf(byReadingKindQuery, in), keyArgs(n, "ja", "word"), "SEARCH r USING INDEX idx_lx_readings_plain"},
			{"Best", bestQuery, []any{"f1", "ja", "word"}, "SEARCH f USING INDEX idx_lx_forms_text"},
		}
		for _, tt := range tests {
			got := plan(t, sqlDB, tt.query, tt.args...)
			if !strings.HasPrefix(got, tt.want) || !strings.Contains(got, "SEARCH e USING INTEGER PRIMARY KEY") {
				t.Errorf("analyzed=%v %s plan = %q, want it to start with %q and join entries by primary key", analyzed, tt.name, got, tt.want)
			}
		}
		if analyzed {
			continue
		}
		// Control: the old shapes scan the language index on this database.
		for name, q := range map[string]struct {
			query string
			args  []any
		}{
			"old ByForm":    {fmt.Sprintf(oldByFormQuery, in), append([]any{"ja"}, keyArgs(n)...)},
			"old ByReading": {fmt.Sprintf(oldByReadingQuery, in), append([]any{"ja"}, keyArgs(n)...)},
			"old Best":      {oldBestQuery, []any{"ja", "word", "f1"}},
		} {
			if got := plan(t, sqlDB, q.query, q.args...); !strings.Contains(got, "sqlite_autoindex_lx_entries_1") {
				t.Errorf("control %s plan = %q, want the language index (setup no longer discriminates)", name, got)
			}
		}
	}
}
