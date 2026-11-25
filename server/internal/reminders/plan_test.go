package reminders

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"qinqin/internal/studyday"
)

type planFixture struct {
	Cases []struct {
		Name     string   `json:"name"`
		Now      string   `json:"now"`
		Zone     string   `json:"zone"`
		Days     int      `json:"days"`
		Settings Settings `json:"settings"`
		Facts    []Facts  `json:"facts"`
		Expect   []Slot   `json:"expect"`
	} `json:"cases"`
}

func TestPlanFixture(t *testing.T) {
	var f planFixture
	readFixture(t, "plan.json", &f)
	if len(f.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range f.Cases {
		now, err := time.Parse(time.RFC3339, c.Now)
		if err != nil {
			t.Fatal(err)
		}
		h, err := studyday.New([]studyday.Change{{Zone: c.Zone}})
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		got := Plan(Input{Now: now, History: h, Settings: c.Settings, Facts: c.Facts, Days: c.Days})
		if got == nil {
			got = []Slot{}
		}
		want := c.Expect
		if want == nil {
			want = []Slot{}
		}
		if !reflect.DeepEqual(got, want) {
			g, _ := json.MarshalIndent(got, "", " ")
			w, _ := json.MarshalIndent(want, "", " ")
			t.Errorf("%s:\n got %s\nwant %s", c.Name, g, w)
		}
	}
}
