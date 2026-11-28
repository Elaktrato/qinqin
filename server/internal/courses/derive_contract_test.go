package courses_test

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"qinqin/internal/courses"
)

// TestDeriveContract runs docs/contracts/courses/derive.json and changes.json: Derive gives exactly the expected
// path state.
func TestDeriveContract(t *testing.T) {
	for _, file := range []struct{ name, rule string }{{"derive.json", "courses/derive"}, {"changes.json", "courses/changes"}} {
		raw, err := os.ReadFile("../../../docs/contracts/courses/" + file.name)
		if err != nil {
			t.Fatal(err)
		}
		var fixture struct {
			Rule   string `json:"rule"`
			Course string `json:"course"`
			Cases  []struct {
				Name   string                `json:"name"`
				Course courses.Filled        `json:"course"`
				Events []courses.StoredEvent `json:"events"`
				Known  []string              `json:"known"`
				Expect json.RawMessage       `json:"expect"`
			} `json:"cases"`
		}
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
		if fixture.Rule != file.rule || len(fixture.Cases) < 5 {
			t.Fatalf("%s: rule %q, %d cases", file.name, fixture.Rule, len(fixture.Cases))
		}
		for _, c := range fixture.Cases {
			t.Run(file.name+"/"+c.Name, func(t *testing.T) {
				got, err := json.Marshal(courses.Derive(&c.Course, fixture.Course, c.Events, c.Known))
				if err != nil {
					t.Fatal(err)
				}
				var want bytes.Buffer
				if err := json.Compact(&want, c.Expect); err != nil {
					t.Fatal(err)
				}
				if !bytes.Equal(got, want.Bytes()) {
					t.Fatalf("Derive =\n%s\nwant\n%s", got, want.Bytes())
				}
			})
		}
	}
}

// Every payload of derive.json's build block parses as a course event of its kind.
func TestBuiltPayloadsParse(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/courses/derive.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Build []struct {
			Name   string          `json:"name"`
			Expect json.RawMessage `json:"expect"`
		} `json:"build"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil || len(fixture.Build) != 5 {
		t.Fatalf("%v, %d build cases", err, len(fixture.Build))
	}
	for _, c := range fixture.Build {
		p, ok := courses.ParseProgress(courses.StoredEvent{ID: "01JD0000000000000000000001", TS: "2026-11-28T10:00:00Z", Type: courses.EventType, Payload: c.Expect})
		var kind struct {
			Kind string `json:"kind"`
		}
		_ = json.Unmarshal(c.Expect, &kind)
		if !ok || p.Kind != kind.Kind || p.Course != "zh-test" {
			t.Errorf("%s: parsed %+v, %v", c.Name, p, ok)
		}
	}
}
