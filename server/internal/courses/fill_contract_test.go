package courses_test

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"

	"qinqin/internal/courses"
	"qinqin/internal/topics"
)

type fillCase struct {
	Name   string          `json:"name"`
	Course json.RawMessage `json:"course"`
	Input  struct {
		Levels    *courses.LevelInput     `json:"levels"`
		Frequency *courses.FrequencyInput `json:"frequency"`
		Labels    []struct {
			Key    string   `json:"key"`
			Sense  int      `json:"sense"`
			Topics []string `json:"topics"`
		} `json:"labels"`
		Grammar []string `json:"grammar"`
	} `json:"input"`
	Expect json.RawMessage `json:"expect"`
}

func readFillCases(t *testing.T) []fillCase {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/courses/fill.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Rule  string     `json:"rule"`
		Cases []fillCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Rule != "courses/fill" || len(fixture.Cases) < 4 {
		t.Fatalf("rule %q, %d cases", fixture.Rule, len(fixture.Cases))
	}
	return fixture.Cases
}

// fillInput turns a case's input into the Input of Fill: the labels become a labels file read by key.
func fillInput(c fillCase) courses.Input {
	in := courses.Input{Levels: c.Input.Levels, Frequency: c.Input.Frequency, Grammar: map[string]bool{}}
	for _, g := range c.Input.Grammar {
		in.Grammar[g] = true
	}
	if len(c.Input.Labels) > 0 {
		f := &topics.File{}
		for _, l := range c.Input.Labels {
			f.Labels = append(f.Labels, topics.Label{Key: l.Key, Form: l.Key, Sense: l.Sense, Topics: l.Topics})
		}
		in.Topics = f.TopicsForKey
	}
	return in
}

// TestFillContract runs docs/contracts/courses/fill.json: Fill gives exactly the expected filled course.
func TestFillContract(t *testing.T) {
	for _, c := range readFillCases(t) {
		t.Run(c.Name, func(t *testing.T) {
			course, err := courses.Parse(c.Course)
			if err != nil {
				t.Fatal(err)
			}
			got, err := json.Marshal(courses.Fill(course, fillInput(c)))
			if err != nil {
				t.Fatal(err)
			}
			var want bytes.Buffer
			if err := json.Compact(&want, c.Expect); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, want.Bytes()) {
				t.Fatalf("Fill =\n%s\nwant\n%s", got, want.Bytes())
			}
		})
	}
}

// Fill is deterministic: the same input gives the same bytes, also when the level words come in a map-free
// second run.
func TestFillIsDeterministic(t *testing.T) {
	for _, c := range readFillCases(t) {
		course, _ := courses.Parse(c.Course)
		a, _ := json.Marshal(courses.Fill(course, fillInput(c)))
		b, _ := json.Marshal(courses.Fill(course, fillInput(c)))
		if !bytes.Equal(a, b) {
			t.Fatalf("%s: two fills differ", c.Name)
		}
	}
}
