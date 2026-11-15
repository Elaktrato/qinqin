package studyday

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

const fixtureDir = "../../../docs/contracts/study-day/"

type fixtureChange struct {
	Zone string  `json:"zone"`
	From *string `json:"from"`
}

func readFixture(t *testing.T, name string, v any) {
	t.Helper()
	b, err := os.ReadFile(fixtureDir + name)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return v.UTC()
}

func historyOf(t *testing.T, fc []fixtureChange) History {
	t.Helper()
	changes := make([]Change, 0, len(fc))
	for _, c := range fc {
		ch := Change{Zone: c.Zone}
		if c.From != nil {
			v := mustTime(t, *c.From)
			ch.From = &v
		}
		changes = append(changes, ch)
	}
	h, err := New(changes)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestFixturesDayOf(t *testing.T) {
	var f struct {
		Cases []struct {
			Name    string          `json:"name"`
			History []fixtureChange `json:"history"`
			TS      string          `json:"ts"`
			Day     string          `json:"day"`
		} `json:"cases"`
	}
	readFixture(t, "day-of.json", &f)
	if len(f.Cases) < 30 {
		t.Fatalf("only %d cases", len(f.Cases))
	}
	for _, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			if got := historyOf(t, c.History).DayOf(mustTime(t, c.TS)).String(); got != c.Day {
				t.Fatalf("DayOf(%s) = %s, want %s", c.TS, got, c.Day)
			}
		})
	}
}

func TestFixturesDayOfTransitions(t *testing.T) {
	var f struct {
		Cases [][3]string `json:"cases"`
	}
	readFixture(t, "day-of-transitions.json", &f)
	if len(f.Cases) < 1000 {
		t.Fatalf("only %d rows", len(f.Cases))
	}
	byZone := map[string]History{}
	for _, c := range f.Cases {
		h, ok := byZone[c[0]]
		if !ok {
			var err error
			h, err = New([]Change{{Zone: c[0]}})
			if err != nil {
				t.Fatalf("zone %s: %v", c[0], err)
			}
			byZone[c[0]] = h
		}
		if got := h.DayOf(mustTime(t, c[1])).String(); got != c[2] {
			t.Errorf("%s DayOf(%s) = %s, want %s", c[0], c[1], got, c[2])
		}
	}
}

func TestFixturesDayStart(t *testing.T) {
	var f struct {
		Cases []struct {
			Name    string          `json:"name"`
			History []fixtureChange `json:"history"`
			Day     string          `json:"day"`
			Start   string          `json:"start"`
		} `json:"cases"`
	}
	readFixture(t, "day-start.json", &f)
	if len(f.Cases) < 15 {
		t.Fatalf("only %d cases", len(f.Cases))
	}
	for _, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			d, err := ParseDate(c.Day)
			if err != nil {
				t.Fatal(err)
			}
			got := historyOf(t, c.History).DayStart(d).Format(time.RFC3339)
			if got != c.Start {
				t.Fatalf("DayStart(%s) = %s, want %s", c.Day, got, c.Start)
			}
		})
	}
}
