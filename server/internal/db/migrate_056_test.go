package db_test

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"qinqin/internal/db"
)

// Migration 056 (#277): every grammar_progress row becomes one `grammar`
// study event (docs/contracts/grammar/runs.json, legacy), the table goes. A
// row the rules refuse, or of a workspace that is not its user's, is dropped;
// a populated, messy database upgrades.
func TestMigration056GrammarEvents(t *testing.T) {
	sqlDB := open030(t)
	if err := db.MigrateThrough(sqlDB, "055_feature_switches_check"); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../../docs/contracts/grammar/runs.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Legacy []struct {
			Name      string          `json:"name"`
			Key       string          `json:"key"`
			Data      json.RawMessage `json:"data"`
			UpdatedAt string          `json:"updatedAt"`
			Expect    *struct {
				TS      string          `json:"ts"`
				Payload json.RawMessage `json:"payload"`
			} `json:"expect"`
		} `json:"legacy"`
	}
	if err := json.Unmarshal(raw, &f); err != nil || len(f.Legacy) < 5 {
		t.Fatalf("fixture: %v, %d cases", err, len(f.Legacy))
	}
	for _, q := range []string{
		`INSERT INTO users (id, username, hash, updated_at) VALUES (1, 'ann', 'h', 't'), (2, 'bob', 'h', 't')`,
		`INSERT INTO workspaces (id, user_id, language, name, updated_at) VALUES (5, 1, 'zh', 'zh', 't'), (6, 2, 'zh', 'zh', 't')`,
	} {
		if _, err := sqlDB.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	// One workspace per case, so each case's event is found by its lesson.
	want := map[string]string{} // lesson id -> expected "ts|payload", or "" for none
	for i, c := range f.Legacy {
		rest := strings.TrimPrefix(c.Key, "grammar:progress:")
		pack, lesson, _ := strings.Cut(rest, ":")
		var d struct {
			CompletedAt any
			Best, Total *int
		}
		json.Unmarshal(c.Data, &d)
		completed, _ := d.CompletedAt.(string)
		best, total := -1, -1
		if d.Best != nil {
			best = *d.Best
		}
		if d.Total != nil {
			total = *d.Total
		}
		// Each case gets its own pack, so two cases never share a primary key.
		uniquePack := pack
		if pack != "" {
			uniquePack = pack + "." + string(rune('a'+i))
		}
		_, err := sqlDB.Exec(`INSERT INTO grammar_progress (user_id, workspace_id, pack_id, lesson_id, completed_at, best, total, updated_at)
			VALUES (1, 5, ?, ?, ?, ?, ?, ?)`, uniquePack, lesson, completed, best, total, c.UpdatedAt)
		if err != nil {
			continue // the table's CHECKs already refuse it: nothing to convert
		}
		key := uniquePack + ":" + lesson
		if c.Expect == nil {
			want[key] = ""
			continue
		}
		var p map[string]any
		json.Unmarshal(c.Expect.Payload, &p)
		p["point"] = key
		b, _ := json.Marshal(struct {
			Point string `json:"point"`
			Mode  string `json:"mode"`
			Score any    `json:"score"`
			Total any    `json:"total"`
		}{key, p["mode"].(string), p["score"], p["total"]})
		want[key] = c.Expect.TS + "|" + string(b)
	}
	// A row of a workspace that is not its user's is dropped.
	if _, err := sqlDB.Exec(`INSERT INTO grammar_progress VALUES (1, 6, 'p', 'foreign', '2026-11-19T08:00:00Z', 1, 2, '2026-11-19T08:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	want["p:foreign"] = ""
	// A time before 1970 cannot be a ULID: dropped, never a failed upgrade.
	if _, err := sqlDB.Exec(`INSERT INTO grammar_progress VALUES (1, 5, 'p', 'ancient', '0001-01-01T00:00:00Z', 1, 2, '2026-11-19T08:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	want["p:ancient"] = ""

	if err := db.MigrateThrough(sqlDB, "056_grammar_events"); err != nil {
		t.Fatalf("migration 056 on a populated database: %v", err)
	}
	var tables int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'grammar_progress'`).Scan(&tables)
	if tables != 0 {
		t.Error("grammar_progress is still there")
	}
	rows, err := sqlDB.Query(`SELECT id, user_id, workspace_id, device, ts, type, payload, updated_at FROM study_events ORDER BY ts, id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := map[string]string{}
	for rows.Next() {
		var id, device, ts, typ, payload, updated string
		var user, ws int64
		if err := rows.Scan(&id, &user, &ws, &device, &ts, &typ, &payload, &updated); err != nil {
			t.Fatal(err)
		}
		if user != 1 || ws != 5 || device != "migration" || typ != "grammar" || updated == "" {
			t.Errorf("event %s: user %d ws %d device %q type %q updated %q", id, user, ws, device, typ, updated)
		}
		u, err := ulid.ParseStrict(id)
		if err != nil {
			t.Errorf("id %q is not a ULID: %v", id, err)
		} else if at, _ := time.Parse(time.RFC3339, ts); !ulid.Time(u.Time()).Equal(at) {
			t.Errorf("id %s carries %v, ts %s", id, ulid.Time(u.Time()), ts)
		}
		var p struct {
			Point string `json:"point"`
		}
		json.Unmarshal([]byte(payload), &p)
		got[p.Point] = ts + "|" + payload
	}
	for key, w := range want {
		if w == "" {
			if g, ok := got[key]; ok {
				t.Errorf("%s: dropped row became %s", key, g)
			}
			continue
		}
		if got[key] != w {
			t.Errorf("%s: event %q, want %q", key, got[key], w)
		}
	}
	if len(got) != countNonEmpty(want) {
		t.Errorf("%d events, want %d: %v", len(got), countNonEmpty(want), got)
	}
}

func countNonEmpty(m map[string]string) int {
	n := 0
	for _, v := range m {
		if v != "" {
			n++
		}
	}
	return n
}
