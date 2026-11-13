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
		SELECT DISTINCT f.text, e.id FROM forms f
		JOIN entries e ON e.id = f.entry_id
		WHERE e.language = ? AND e.deleted_at IS NULL AND f.deleted_at IS NULL
		  AND f.text IN (%s)
		ORDER BY f.text, e.id`
	oldByReadingQuery = `
		SELECT DISTINCT r.plain, e.id FROM readings r
		JOIN entries e ON e.id = r.entry_id
		WHERE e.language = ? AND e.deleted_at IS NULL AND r.deleted_at IS NULL
		  AND r.plain IN (%s)
		ORDER BY r.plain, e.id`
	oldBestQuery = `
		SELECT e.id FROM entries e
		WHERE e.language = ? AND e.kind = ? AND e.deleted_at IS NULL
		  AND EXISTS (SELECT 1 FROM forms f
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
			{"ByForm", fmt.Sprintf(byFormQuery, in), keyArgs(n, "ja"), "SEARCH f USING INDEX idx_forms_text"},
			{"ByReading", fmt.Sprintf(byReadingQuery, in), keyArgs(n, "ja"), "SEARCH r USING INDEX idx_readings_plain"},
			{"ByReadingKind", fmt.Sprintf(byReadingKindQuery, in), keyArgs(n, "ja", "word"), "SEARCH r USING INDEX idx_readings_plain"},
			{"Best", bestQuery, []any{"f1", "ja", "word"}, "SEARCH f USING INDEX idx_forms_text"},
			{"BestWord fallback", bestKanaWordQuery, []any{"r1", 1, "ja", "r1"}, "SEARCH r USING INDEX idx_readings_plain"},
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
			if got := plan(t, sqlDB, q.query, q.args...); !strings.Contains(got, "sqlite_autoindex_entries_1") {
				t.Errorf("control %s plan = %q, want the language index (setup no longer discriminates)", name, got)
			}
		}
	}
}

func TestSearchTiersUseTheTextIndexes(t *testing.T) {
	sqlDB := seededPlanDB(t)
	tierNames := []string{"form", "reading", "reading prefix", "bopomofo prefix", "gloss"}
	for _, analyzed := range []bool{false, true} {
		if analyzed {
			if _, err := sqlDB.Exec(`ANALYZE`); err != nil {
				t.Fatal(err)
			}
		}
		// Unfiltered: the form and reading tiers seek the text indexes
		// and join entries by primary key; the gloss tier, a substring
		// match, reaches senses through their entry index.
		tiers := searchTiers(SearchQuery{Lang: "ja"}, "r1")
		if len(tiers) != len(tierNames) {
			t.Fatalf("%d tiers, want %d", len(tiers), len(tierNames))
		}
		for i, tr := range tiers {
			got := plan(t, sqlDB, tr.query+` LIMIT ?`, append(tr.args, 50)...)
			switch tierNames[i] {
			case "form":
				if !strings.HasPrefix(got, "SEARCH f USING INDEX idx_forms_text") || !strings.Contains(got, "SEARCH e USING INTEGER PRIMARY KEY") {
					t.Errorf("analyzed=%v form tier plan = %q", analyzed, got)
				}
			case "gloss":
				if !strings.Contains(got, "SEARCH s USING INDEX idx_senses_entry") {
					t.Errorf("analyzed=%v gloss tier plan = %q, want senses by entry index", analyzed, got)
				}
			default:
				if !strings.HasPrefix(got, "SEARCH r USING INDEX idx_readings_plain") || !strings.Contains(got, "SEARCH e USING INTEGER PRIMARY KEY") {
					t.Errorf("analyzed=%v %s tier plan = %q", analyzed, tierNames[i], got)
				}
			}
			// Control: without CROSS JOIN the prefix tiers fall into the
			// language-index trap on this database.
			if !analyzed && (i == 2 || i == 3) {
				old := strings.Replace(tr.query, "CROSS JOIN", "JOIN", 1)
				if got := plan(t, sqlDB, old+` LIMIT ?`, append(tr.args, 50)...); !strings.Contains(got, "sqlite_autoindex_entries_1") {
					t.Errorf("control %s tier plan = %q, want the language index (setup no longer discriminates)", tierNames[i], got)
				}
			}
		}
		// Scheme-filtered: no child or entry table is scanned; the
		// member list may drive the reading tiers.
		for i, tr := range searchTiers(SearchQuery{Lang: "ja", Kind: "word", SchemeID: "x", LevelName: "1"}, "r1") {
			got := plan(t, sqlDB, tr.query+` LIMIT ?`, append(tr.args, 50)...)
			for _, alias := range []string{"f", "r", "e", "s", "m"} {
				if strings.Contains(got, "SCAN "+alias+";") || strings.HasSuffix(got, "SCAN "+alias) {
					t.Errorf("analyzed=%v filtered %s tier scans %s: %q", analyzed, tierNames[i], alias, got)
				}
			}
		}
	}
}

// TestCharacterQueriesUseIndexes: the character universe walks the
// (language, kind) prefix of the entries key index, and every per-row
// lookup (first form, reading, gloss, variant links both ways) seeks its
// table's entry index; no table is scanned.
func TestCharacterQueriesUseIndexes(t *testing.T) {
	sqlDB := seededPlanDB(t)
	for _, analyzed := range []bool{false, true} {
		if analyzed {
			if _, err := sqlDB.Exec(`ANALYZE`); err != nil {
				t.Fatal(err)
			}
		}
		// Scans allowed: v, the per-row union of a character's few
		// partners, and d, the dictionaries registry (a handful of rows)
		// the planner may loop over per sense after ANALYZE.
		noScans := func(name, got string) {
			t.Helper()
			for _, line := range strings.Split(got, "; ") {
				if strings.HasPrefix(line, "SCAN ") && line != "SCAN v" && line != "SCAN d" && line != "SCAN CONSTANT ROW" {
					t.Errorf("analyzed=%v %s scans a table: %q in\n%s", analyzed, name, line, got)
				}
			}
		}
		for _, language := range []string{"ja", "zh"} {
			for _, stale := range []bool{false, true} {
				list, ok := charactersQuery(language, stale)
				if !ok {
					t.Fatalf("no characters query for %s", language)
				}
				got := plan(t, sqlDB, list, language)
				for _, want := range []string{
					"SEARCH e USING INDEX sqlite_autoindex_entries_1 (language=? AND kind=?)",
					"SEARCH f USING INDEX idx_forms_entry (entry_id=?)",
					"SEARCH r USING INDEX idx_readings_entry (entry_id=?)",
					"SEARCH s USING INDEX idx_senses_entry (entry_id=?",
					"SEARCH l USING INDEX sqlite_autoindex_entry_links_1 (from_id=?)",
					"SEARCH l USING INDEX idx_entry_links_to (to_id=? AND type=?)",
				} {
					if !strings.Contains(got, want) {
						t.Errorf("analyzed=%v %s (stale %v) list plan lacks %q:\n%s", analyzed, language, stale, want, got)
					}
				}
				noScans(language+" list", got)
			}
			marker, _ := characterMarkerQuery(language)
			got := plan(t, sqlDB, marker, language)
			if !strings.Contains(got, "SEARCH e USING INDEX sqlite_autoindex_entries_1 (language=? AND kind=?)") {
				t.Errorf("analyzed=%v %s marker plan = %q", analyzed, language, got)
			}
			noScans(language+" marker", got)
		}
		got := plan(t, sqlDB, charactersVersionQuery)
		for _, want := range []string{
			"SEARCH entries USING COVERING INDEX idx_entries_updated",
			"SEARCH entry_links USING COVERING INDEX idx_entry_links_updated",
		} {
			if !strings.Contains(got, want) {
				t.Errorf("analyzed=%v version plan lacks %q:\n%s", analyzed, want, got)
			}
		}
		noScans("version", got)
		if _, ok := charactersQuery("es", false); ok {
			t.Error("charactersQuery(es) is defined, want none")
		}
	}
}
