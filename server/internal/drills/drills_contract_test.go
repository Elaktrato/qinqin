package drills

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
)

// docs/contracts/drills/drills.json: drill ids, item keys, the payload of an
// answer, which stored events are answers, and the registry of the drills
// the server counts as activity. Schedules and rounds (schedule.json,
// pick.json) are client rules: the server has no FSRS.
func TestDrillsContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/drills/drills.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Rule      string `json:"rule"`
		Constants struct {
			EventPrefix   string   `json:"eventPrefix"`
			Feature       string   `json:"feature"`
			MaxIDLength   int      `json:"maxIdLength"`
			MaxItemLength int      `json:"maxItemLength"`
			ReservedIDs   []string `json:"reservedIds"`
		} `json:"constants"`
		Registry []string `json:"registry"`
		IDs      []struct {
			Name  string `json:"name"`
			ID    any    `json:"id"`
			Valid bool   `json:"valid"`
		} `json:"ids"`
		Items []struct {
			Name  string `json:"name"`
			Item  any    `json:"item"`
			Valid bool   `json:"valid"`
		} `json:"items"`
		Build []struct {
			Name   string `json:"name"`
			Drill  string `json:"drill"`
			Item   string `json:"item"`
			Mode   string `json:"mode"`
			Grade  int    `json:"grade"`
			Expect struct {
				Type    string          `json:"type"`
				Payload json.RawMessage `json:"payload"`
			} `json:"expect"`
		} `json:"build"`
		Parse []struct {
			Name  string `json:"name"`
			Event struct {
				TS      string          `json:"ts"`
				Type    string          `json:"type"`
				Payload json.RawMessage `json:"payload"`
			} `json:"event"`
			Expect *Answer `json:"expect"`
		} `json:"parse"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	c := fx.Constants
	if fx.Rule != "drills/drills" || c.EventPrefix != EventPrefix || c.Feature != Feature || c.MaxIDLength != MaxIDLength ||
		c.MaxItemLength != MaxItemLength || !slices.Equal(c.ReservedIDs, ReservedIDs) {
		t.Fatalf("fixture constants %+v (rule %q)", c, fx.Rule)
	}
	if !slices.Equal(fx.Registry, IDs) && !(len(fx.Registry) == 0 && len(IDs) == 0) {
		t.Errorf("registry %v, drills.IDs %v", fx.Registry, IDs)
	}
	for _, id := range IDs {
		if !ValidID(id) {
			t.Errorf("registered id %q is not a drill id", id)
		}
	}
	for _, tc := range fx.IDs {
		s, isString := tc.ID.(string)
		if got := isString && ValidID(s); got != tc.Valid {
			t.Errorf("id %s: %v, want %v", tc.Name, got, tc.Valid)
		}
	}
	for _, tc := range fx.Items {
		s, isString := tc.Item.(string)
		if got := isString && ValidItem(s); got != tc.Valid {
			t.Errorf("item %s: %v, want %v", tc.Name, got, tc.Valid)
		}
	}
	for _, tc := range fx.Build {
		if got := EventType(tc.Drill); got != tc.Expect.Type {
			t.Errorf("build %s: type %q, want %q", tc.Name, got, tc.Expect.Type)
		}
		if got := Payload(tc.Item, tc.Mode, tc.Grade); !sameText(got, tc.Expect.Payload) {
			t.Errorf("build %s: %s, want %s", tc.Name, got, tc.Expect.Payload)
		}
	}
	if len(fx.Parse) < 10 {
		t.Fatalf("%d parse cases", len(fx.Parse))
	}
	for _, tc := range fx.Parse {
		got, ok := Parse(tc.Event.Type, tc.Event.Payload, tc.Event.TS)
		if tc.Expect == nil {
			if ok {
				t.Errorf("parse %s: %+v, want no answer", tc.Name, got)
			}
			continue
		}
		if !ok || got != *tc.Expect {
			t.Errorf("parse %s: %+v %v, want %+v", tc.Name, got, ok, *tc.Expect)
		}
	}
}

// sameText compares JSON texts with the whitespace removed, member order kept.
func sameText(a, b json.RawMessage) bool {
	var x, y any
	ca, _ := json.Marshal(json.RawMessage(a))
	cb, _ := json.Marshal(json.RawMessage(b))
	return json.Unmarshal(a, &x) == nil && json.Unmarshal(b, &y) == nil && string(ca) == string(cb)
}
