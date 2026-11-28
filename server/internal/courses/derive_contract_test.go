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

// LessonPayload writes the members in their contract order.
func TestLessonPayload(t *testing.T) {
	if got := string(courses.LessonPayload("c", "u", "words-1", true, 4, 5, []string{"a"})); got != `{"kind":"lesson-finished","course":"c","unit":"u","lesson":"words-1","score":4,"total":5,"words":["a"]}` {
		t.Fatal(got)
	}
	if got := string(courses.LessonPayload("c", "u", "words-1", false, 0, 0, nil)); got != `{"kind":"lesson-started","course":"c","unit":"u","lesson":"words-1"}` {
		t.Fatal(got)
	}
}
