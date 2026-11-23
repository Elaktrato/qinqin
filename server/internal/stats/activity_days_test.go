package stats_test

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"

	"qinqin/internal/dbtest"
	"qinqin/internal/stats"
	"qinqin/internal/studyday"
)

type dayFixtureEvent struct {
	TS      string          `json:"ts"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type dayFixtureCase struct {
	Name    string `json:"name"`
	History []struct {
		Zone string  `json:"zone"`
		From *string `json:"from"`
	} `json:"history"`
	Events []dayFixtureEvent `json:"events"`
	From   string            `json:"from"`
	To     string            `json:"to"`
	Cells  []struct {
		Day       string  `json:"day"`
		Workspace int64   `json:"workspace"`
		Type      string  `json:"type"`
		Points    int64   `json:"points"`
		Raw       float64 `json:"raw"`
	} `json:"cells"`
}

func (c dayFixtureCase) studyHistory(t *testing.T) studyday.History {
	t.Helper()
	var changes []studyday.Change
	for _, h := range c.History {
		ch := studyday.Change{Zone: h.Zone}
		if h.From != nil {
			v, err := time.Parse(time.RFC3339, *h.From)
			if err != nil {
				t.Fatal(err)
			}
			ch.From = &v
		}
		changes = append(changes, ch)
	}
	h, err := studyday.New(changes)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestActivityDaysFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/study-day/activity-days.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []dayFixtureCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) < 10 {
		t.Fatalf("only %d cases", len(f.Cases))
	}
	for _, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			sqlDB := dbtest.Open(t)
			rules := builtinRules(t, sqlDB)
			u := newUser(t, sqlDB, "a")
			for _, ev := range c.Events {
				add(t, sqlDB, u, 1, ev.TS, ev.Type, string(ev.Payload))
			}
			got := runIn(t, sqlDB, u, c.studyHistory(t), c.From, c.To, nil, rules)
			if len(got) != len(c.Cells) {
				t.Fatalf("got %+v, want %+v", got, c.Cells)
			}
			for i, w := range c.Cells {
				g := got[i]
				if g.Day != w.Day || g.Workspace != w.Workspace || g.Type != w.Type || g.Points != w.Points || g.Raw != w.Raw {
					t.Errorf("cell %d = %+v, want %+v", i, g, w)
				}
			}
		})
	}
}

// A zone change moves no past day: the cells before the change instant
// are identical before and after it, whatever the new zone.
func TestActivityZoneChangeKeepsPast(t *testing.T) {
	sqlDB := dbtest.Open(t)
	rules := builtinRules(t, sqlDB)
	u := newUser(t, sqlDB, "a")
	base := time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 24*14; i++ { // two weeks, one review an hour plus odd minutes
		ts := base.Add(time.Duration(i)*time.Hour + time.Duration(i%7)*time.Minute)
		add(t, sqlDB, u, 1, ts.Format(time.RFC3339), "review", "")
	}
	change := time.Date(2026, 11, 1, 6, 0, 0, 0, time.UTC)
	before, err := studyday.New([]studyday.Change{{Zone: "Asia/Tokyo"}})
	if err != nil {
		t.Fatal(err)
	}
	cut := before.DayOf(change)
	for _, zone := range []string{"America/Los_Angeles", "Europe/Berlin", "Pacific/Kiritimati", "Etc/GMT+12", "Asia/Tokyo", "UTC", "Pacific/Auckland"} {
		after, err := studyday.New([]studyday.Change{{Zone: "Asia/Tokyo"}, {Zone: zone, From: &change}})
		if err != nil {
			t.Fatal(err)
		}
		first := date("2026-10-20")
		last := cut.AddDays(-1) // days that ended before the change
		a := runIn(t, sqlDB, u, before, first.String(), last.String(), nil, rules)
		b := runIn(t, sqlDB, u, after, first.String(), last.String(), nil, rules)
		if !reflect.DeepEqual(a, b) {
			t.Errorf("%s: past days moved:\nbefore %+v\nafter  %+v", zone, a, b)
		}
		if len(a) == 0 {
			t.Fatal("no cells in the past window")
		}
		// the whole log still sums to the same number of reviews
		total := func(h studyday.History) (n int64) {
			for _, c := range runIn(t, sqlDB, u, h, "2026-10-19", "2026-11-05", nil, rules) {
				n += c.Points
			}
			return n
		}
		if total(before) != 24*14 || total(after) != 24*14 {
			t.Errorf("%s: totals %d / %d, want %d", zone, total(before), total(after), 24*14)
		}
	}
}

func TestActivityEmptyWindowsAndNoWindows(t *testing.T) {
	sqlDB := dbtest.Open(t)
	rules := builtinRules(t, sqlDB)
	u := newUser(t, sqlDB, "a")
	add(t, sqlDB, u, 1, "2011-12-30T10:00:00Z", "review", "")
	cells, err := stats.Activity(context.Background(), sqlDB, u, nil, nil, rules)
	if err != nil || cells == nil || len(cells) != 0 {
		t.Errorf("no windows: %v %v", cells, err)
	}
	apia, _ := studyday.New([]studyday.Change{{Zone: "Pacific/Apia"}})
	if got := runIn(t, sqlDB, u, apia, "2011-12-30", "2011-12-30", nil, rules); len(got) != 0 {
		t.Errorf("a skipped date has cells: %+v", got)
	}
	if got := runIn(t, sqlDB, u, apia, "2011-12-29", "2011-12-31", nil, rules); len(got) != 1 || got[0].Day != "2011-12-31" {
		t.Errorf("around the skipped date: %+v", got)
	}
}
