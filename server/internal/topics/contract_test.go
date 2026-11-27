package topics_test

import (
	"bytes"
	"encoding/json"
	"os"
	"slices"
	"testing"

	"qinqin/internal/topics"
)

// TestListContract checks that the embedded topic list is docs/contracts/topics/topics.json byte for byte and
// that List reads it in order.
func TestListContract(t *testing.T) {
	want, err := os.ReadFile("../../../docs/contracts/topics/topics.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(want, topics.ListJSON()) {
		t.Fatal("server/internal/topics/topics.json differs from docs/contracts/topics/topics.json: copy the fixture")
	}
	var fixture struct {
		Rule   string `json:"rule"`
		Topics []struct {
			ID string `json:"id"`
		} `json:"topics"`
	}
	if err := json.Unmarshal(want, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Rule != "topics/list" {
		t.Fatalf("rule %q", fixture.Rule)
	}
	var ids []string
	for _, tp := range topics.List() {
		ids = append(ids, tp.ID)
	}
	var fids []string
	for _, tp := range fixture.Topics {
		fids = append(fids, tp.ID)
	}
	if !slices.Equal(ids, fids) || len(ids) < 30 || len(ids) > 60 {
		t.Fatalf("List() = %v, fixture %v", ids, fids)
	}
	if !topics.Known("food") || topics.Known("beverages") {
		t.Fatal("Known")
	}
}

// TestLabelsContract runs docs/contracts/topics/labels.json: which files Parse accepts, and the lookup rule.
func TestLabelsContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/topics/labels.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Rule  string `json:"rule"`
		Files []struct {
			Name  string          `json:"name"`
			Valid bool            `json:"valid"`
			File  json.RawMessage `json:"file"`
		} `json:"files"`
		Lookup []struct {
			Name    string         `json:"name"`
			Labels  []topics.Label `json:"labels"`
			Form    string         `json:"form"`
			Reading string         `json:"reading"`
			Topics  []string       `json:"topics"`
		} `json:"lookup"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.Rule != "topics/labels" || len(fixture.Files) == 0 || len(fixture.Lookup) == 0 {
		t.Fatalf("fixture rule %q with %d files, %d lookups", fixture.Rule, len(fixture.Files), len(fixture.Lookup))
	}
	for _, c := range fixture.Files {
		_, err := topics.Parse(c.File)
		if c.Valid && err != nil {
			t.Errorf("%s: refused: %v", c.Name, err)
		}
		if !c.Valid && err == nil {
			t.Errorf("%s: accepted, want a refusal", c.Name)
		}
	}
	for _, c := range fixture.Lookup {
		f := &topics.File{Labels: c.Labels}
		got := f.TopicsFor(c.Form, c.Reading)
		if got == nil {
			got = []string{}
		}
		if !slices.Equal(got, c.Topics) {
			t.Errorf("%s: TopicsFor(%q, %q) = %v, want %v", c.Name, c.Form, c.Reading, got, c.Topics)
		}
	}
}
