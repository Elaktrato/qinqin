package grammar

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"

	"qinqin/internal/dbtest"
)

// docs/contracts/grammar/progress.json: the keep-the-best rule and the refused runs.
func TestProgressContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/grammar/progress.json")
	if err != nil {
		t.Fatal(err)
	}
	type score struct{ Best, Total int }
	var fx struct {
		Row  Progress `json:"row"`
		Runs []struct {
			Name     string                     `json:"name"`
			Previous *score                     `json:"previous"`
			Run      struct{ Score, Total int } `json:"run"`
			Expect   score                      `json:"expect"`
		} `json:"runs"`
		Invalid []struct {
			Name         string `json:"name"`
			PackID       string `json:"packId"`
			LessonID     string `json:"lessonId"`
			Score, Total int
		} `json:"invalid"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(fx.Runs) < 4 || len(fx.Invalid) < 4 {
		t.Fatalf("fixture too small")
	}
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	u := dbtest.User(t, sqlDB, "alice")
	for i, c := range fx.Runs {
		ws := dbtest.Workspace(t, sqlDB, u, fmt.Sprintf("x%d", i))
		if c.Previous != nil {
			if _, err := record(ctx, sqlDB, u, ws, "p", "l", c.Previous.Best, c.Previous.Total, "2026-01-01T00:00:00Z"); err != nil {
				t.Fatal(err)
			}
		}
		got, err := RecordRun(ctx, sqlDB, u, ws, "p", "l", c.Run.Score, c.Run.Total)
		if err != nil || (score{got.Best, got.Total}) != c.Expect || got.CompletedAt == "2026-01-01T00:00:00Z" {
			t.Errorf("%d %s: %+v (%v), want %+v", i, c.Name, got, err, c.Expect)
		}
	}
	ws := dbtest.Workspace(t, sqlDB, u, "zh")
	for _, c := range fx.Invalid {
		var inv *InvalidError
		if _, err := RecordRun(ctx, sqlDB, u, ws, c.PackID, c.LessonID, c.Score, c.Total); !errors.As(err, &inv) {
			t.Errorf("%s: %v, want a refusal", c.Name, err)
		}
	}
	if fx.Row.PackID == "" || fx.Row.Best > fx.Row.Total {
		t.Errorf("row %+v", fx.Row)
	}
}

// The keyed form restores what it carries and refuses what it cannot read.
func TestProgressKeyedRoundTrip(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	u := dbtest.User(t, sqlDB, "alice")
	ws, target := dbtest.Workspace(t, sqlDB, u, "zh"), dbtest.Workspace(t, sqlDB, u, "ja")
	p, err := RecordRun(ctx, sqlDB, u, ws, "zh-grammar", "le-change", 2, 3)
	if err != nil {
		t.Fatal(err)
	}
	key, data := KeyedOf(p)
	if key != "grammar:progress:zh-grammar:le-change" || !IsKeyed(key) {
		t.Errorf("key %q", key)
	}
	if ok, err := RestoreKeyed(ctx, sqlDB, u, target, key, data); !ok || err != nil {
		t.Fatalf("restore: %v %v", ok, err)
	}
	if list, err := ListProgress(ctx, sqlDB, u, target); err != nil || len(list) != 1 || list[0] != p {
		t.Errorf("restored %+v (%v), want %+v", list, err, p)
	}
	for k, d := range map[string]string{
		"grammar:progress:zh-grammar:le": `{"best":1,"total":2}`,
		"grammar:progress:nolesson":      `{"completedAt":"2026-11-19T08:00:00Z","best":1,"total":2}`,
		"grammar:progress:p:l":           `{"completedAt":"2026-11-19T08:00:00Z","best":3,"total":2}`,
		"grammar:other":                  `{}`,
	} {
		if ok, err := RestoreKeyed(ctx, sqlDB, u, target, k, json.RawMessage(d)); ok || err != nil {
			t.Errorf("%s restored: %v %v", k, ok, err)
		}
	}
}
