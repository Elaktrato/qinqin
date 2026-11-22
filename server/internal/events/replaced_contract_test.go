package events

import (
	"encoding/json"
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
		Rule  string `json:"rule"`
		Cases []struct {
			Name   string `json:"name"`
			Events []struct {
				ID          string          `json:"id"`
				WorkspaceID int64           `json:"workspaceId"`
				TS          string          `json:"ts"`
				Type        string          `json:"type"`
				Payload     json.RawMessage `json:"payload"`
			} `json:"events"`
			Live     []string `json:"live"`
			Replaced []string `json:"replaced"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Rule != "events/review-replace" || len(fx.Cases) < 15 {
		t.Fatalf("rule %q, %d cases", fx.Rule, len(fx.Cases))
	}
	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) {
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
				at, ok := r.valid()
				if ok && !replaced[r.ID] {
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
		})
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
