package stats_test

import (
	"context"
	"encoding/json"
	"math"
	"math/rand"
	"reflect"
	"sort"
	"testing"
	"time"

	"qinqin/internal/events"
	"qinqin/internal/model"
	"qinqin/internal/stats"
)

// oracle scores the event log in plain Go, following the spec's table.
func oracle(evs []model.StudyEvent, from, to time.Time) []stats.Cell {
	type key struct {
		day string
		ws  int64
		typ string
	}
	points := map[key]int64{}
	raw := map[key]float64{}
	ids := map[key]map[string]bool{}
	end := to.AddDate(0, 0, 1)
	for _, ev := range evs {
		if ev.TS.Before(from) || !ev.TS.Before(end) {
			continue
		}
		k := key{ev.TS.UTC().Format("2006-01-02"), ev.WorkspaceID, ev.Type}
		var p map[string]any
		_ = json.Unmarshal(ev.Payload, &p) // not an object: p stays nil
		switch ev.Type {
		case "review":
			points[k]++
			raw[k]++
		case "read":
			v, ok := p["seconds"].(float64)
			if !ok || v < 30 {
				continue
			}
			r := math.Min(v, 7200)
			points[k] += int64(math.Ceil(r / 300))
			raw[k] += r
		case "journal":
			id, ok := p["entryId"].(string)
			if !ok {
				continue
			}
			if ids[k] == nil {
				ids[k] = map[string]bool{}
			}
			if !ids[k][id] {
				ids[k][id] = true
				points[k]++
				raw[k]++
			}
		}
	}
	out := []stats.Cell{}
	for k, pts := range points {
		if pts > 0 {
			out = append(out, stats.Cell{Day: k.day, Workspace: k.ws, Type: k.typ, Points: pts, Raw: raw[k]})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Day != b.Day {
			return a.Day < b.Day
		}
		if a.Workspace != b.Workspace {
			return a.Workspace < b.Workspace
		}
		return a.Type < b.Type
	})
	return out
}

func TestActivityMatchesOracle(t *testing.T) {
	sqlDB := newDB(t)
	rules := builtinRules(t, sqlDB)
	u := newUser(t, sqlDB, "a")
	rng := rand.New(rand.NewSource(48))
	base := day("2026-07-01")
	var batch []model.StudyEvent
	for i := 0; i < 5000; i++ {
		ts := base.Add(time.Duration(rng.Intn(120*24*3600)) * time.Second)
		ev := model.StudyEvent{ID: "o-" + time.Duration(i).String(), UserID: u, WorkspaceID: int64(1 + rng.Intn(3)), Device: "d", TS: ts}
		ev.Type = []string{"review", "read", "journal"}[rng.Intn(3)]
		if rng.Intn(10) == 0 {
			ev.Payload = json.RawMessage([]string{`null`, `"x"`, `{"seconds":"300"}`, `{"entryId":5}`, `[]`, `{}`}[rng.Intn(6)])
		} else {
			switch ev.Type {
			case "read":
				ev.Payload = json.RawMessage(`{"seconds":` + []string{"5", "29", "30", "299", "300", "301", "4000", "9000", "45.5"}[rng.Intn(9)] + `}`)
			case "journal":
				ev.Payload = json.RawMessage(`{"entryId":"e` + string(rune('A'+rng.Intn(6))) + `"}`)
			}
		}
		batch = append(batch, ev)
	}
	if _, _, err := events.Append(context.Background(), sqlDB, batch); err != nil {
		t.Fatal(err)
	}
	from, to := day("2026-08-15"), day("2026-11-13") // 91 days inside the 120
	all, err := events.Since(context.Background(), sqlDB, u, base, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, ws := range []*int64{nil, ptr(2)} {
		var evs []model.StudyEvent
		for _, ev := range all {
			if ws == nil || ev.WorkspaceID == *ws {
				evs = append(evs, ev)
			}
		}
		want := oracle(evs, from, to)
		got := run(t, sqlDB, u, "2026-08-15", "2026-11-13", ws, rules)
		if len(want) < 50 {
			t.Fatalf("oracle too thin: %d cells", len(want))
		}
		if !reflect.DeepEqual(got, want) {
			for i := range want {
				if i >= len(got) || got[i] != want[i] {
					t.Errorf("first mismatch at %d: got %+v, want %+v (lens %d/%d)", i, safe(got, i), want[i], len(got), len(want))
					break
				}
			}
			t.Errorf("ws %v: Activity differs from oracle", ws)
		}
	}
}

func ptr(n int64) *int64 { return &n }

func safe(c []stats.Cell, i int) any {
	if i < len(c) {
		return c[i]
	}
	return nil
}
