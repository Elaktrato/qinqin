package events

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"testing"
	"time"
)

// TestReplacedContract runs docs/contracts/events/review-replace.json: the
// replaced ids of every case, and the ids that still count (valid reviews
// that are not replaced) in (instant, id) order.
func TestReplacedContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/events/review-replace.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Rule      string `json:"rule"`
		Generated struct {
			Seed  int      `json:"seed"`
			Cases []fxCase `json:"cases"`
		} `json:"generated"`
		Cases []struct {
			Name string `json:"name"`
			fxCase
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Rule != "events/review-replace" || len(fx.Cases) < 15 {
		t.Fatalf("rule %q, %d cases", fx.Rule, len(fx.Cases))
	}
	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) { checkCase(t, c.fxCase) })
	}
	// The seeded random families (review fix 5).
	if fx.Generated.Seed != 131 || len(fx.Generated.Cases) != 300 {
		t.Fatalf("generated block: seed %d, %d cases", fx.Generated.Seed, len(fx.Generated.Cases))
	}
	for n, c := range fx.Generated.Cases {
		t.Run(fmt.Sprintf("generated %d", n), func(t *testing.T) { checkCase(t, c) })
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

type fxEvent struct {
	ID          string          `json:"id"`
	WorkspaceID int64           `json:"workspaceId"`
	TS          string          `json:"ts"`
	Type        string          `json:"type"`
	Payload     json.RawMessage `json:"payload"`
}

type fxCase struct {
	Events   []fxEvent `json:"events"`
	Live     []string  `json:"live"`
	Replaced []string  `json:"replaced"`
}

// checkCase compares the replaced ids and the ids that count, in (instant, id) order.
func checkCase(t *testing.T, c fxCase) {
	t.Helper()
	var list []Review
	for _, e := range c.Events {
		list = append(list, Review{ID: e.ID, WorkspaceID: e.WorkspaceID, TS: e.TS, Type: e.Type, Payload: e.Payload})
	}
	replaced := Replaced(list)
	got := []string{}
	for id := range replaced {
		got = append(got, id)
	}
	sort.Strings(got)
	if !equal(got, c.Replaced) {
		t.Errorf("replaced %v, want %v", got, c.Replaced)
	}
	type live struct {
		at time.Time
		id string
	}
	var lives []live
	for _, r := range list {
		if at, ok := r.valid(); ok && !replaced[r.ID] {
			lives = append(lives, live{at, r.ID})
		}
	}
	sort.Slice(lives, func(i, j int) bool {
		if !lives[i].at.Equal(lives[j].at) {
			return lives[i].at.Before(lives[j].at)
		}
		return lives[i].id < lives[j].id
	})
	ids := []string{}
	for _, l := range lives {
		ids = append(ids, l.id)
	}
	if !equal(ids, c.Live) {
		t.Errorf("live %v, want %v", ids, c.Live)
	}
}
