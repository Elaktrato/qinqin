package reminders

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

type settingsFixture struct {
	Cases []struct {
		Name   string          `json:"name"`
		Value  json.RawMessage `json:"value"`
		Expect Settings        `json:"expect"`
	} `json:"cases"`
	QuietHours []struct {
		Quiet  *Quiet `json:"quiet"`
		At     string `json:"at"`
		Inside bool   `json:"inside"`
	} `json:"quietHours"`
}

func readFixture(t *testing.T, name string, v any) {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/reminders/" + name)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatal(err)
	}
}

func TestParseSettingsFixture(t *testing.T) {
	var f settingsFixture
	readFixture(t, "settings.json", &f)
	if len(f.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range f.Cases {
		got := ParseSettings(c.Value)
		if !reflect.DeepEqual(got, c.Expect) {
			t.Errorf("%s:\n got %+v\nwant %+v", c.Name, got, c.Expect)
		}
	}
}

func TestInQuietFixture(t *testing.T) {
	var f settingsFixture
	readFixture(t, "settings.json", &f)
	for _, c := range f.QuietHours {
		minutes, ok := parseClock(c.At)
		if !ok {
			t.Fatalf("bad fixture time %q", c.At)
		}
		if got := c.Quiet.Contains(minutes); got != c.Inside {
			t.Errorf("%+v at %s: got %v want %v", c.Quiet, c.At, got, c.Inside)
		}
	}
}
