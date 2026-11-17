package themes

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestContrastContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/themes/contrast.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Pairs []struct {
			FG    string  `json:"fg"`
			BG    string  `json:"bg"`
			Ratio float64 `json:"ratio"`
			Note  string  `json:"note"`
		} `json:"pairs"`
		Checks []struct {
			Name    string          `json:"name"`
			Theme   json.RawMessage `json:"theme"`
			Expect  []Check         `json:"expect"`
			Failing int             `json:"failing"`
		} `json:"checks"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Pairs) < 10 || len(doc.Checks) < 2 {
		t.Fatalf("%d pairs, %d checks", len(doc.Pairs), len(doc.Checks))
	}
	for _, p := range doc.Pairs {
		if got := Ratio(p.FG, p.BG); got != p.Ratio {
			t.Errorf("Ratio(%s, %s) = %v, want %v (%s)", p.FG, p.BG, got, p.Ratio, p.Note)
		}
	}
	for _, c := range doc.Checks {
		th, err := ParseTheme(c.Theme)
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		got := Review(th)
		if !reflect.DeepEqual(got, c.Expect) {
			t.Errorf("%s: Review =\n%+v\nwant\n%+v", c.Name, got, c.Expect)
		}
		if n := Failing(got); n != c.Failing {
			t.Errorf("%s: Failing = %d, want %d", c.Name, n, c.Failing)
		}
	}
}
