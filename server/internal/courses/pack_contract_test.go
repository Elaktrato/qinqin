package courses_test

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"qinqin/internal/courses"
)

// TestPackContract runs docs/contracts/courses/pack.json: which course.json files Parse accepts, and a substring
// of the message of each refused one.
func TestPackContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/courses/pack.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Rule  string `json:"rule"`
		Cases []struct {
			Name   string          `json:"name"`
			Course json.RawMessage `json:"course"`
			Error  *string         `json:"error"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Rule != "courses/pack" || len(fixture.Cases) < 10 {
		t.Fatalf("rule %q, %d cases", fixture.Rule, len(fixture.Cases))
	}
	for _, c := range fixture.Cases {
		t.Run(c.Name, func(t *testing.T) {
			got, err := courses.Parse(c.Course)
			if c.Error == nil {
				if err != nil {
					t.Fatalf("refused: %v", err)
				}
				if got == nil || len(got.Sections) == 0 {
					t.Fatal("no sections")
				}
				return
			}
			if err == nil {
				t.Fatalf("accepted, want an error with %q", *c.Error)
			}
			if !strings.Contains(err.Error(), *c.Error) {
				t.Fatalf("error %q, want it to contain %q", err, *c.Error)
			}
		})
	}
}
