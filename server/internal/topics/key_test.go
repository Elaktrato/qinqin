package topics_test

import (
	"slices"
	"testing"

	"qinqin/internal/topics"
)

// TopicsForKey reads every row of a key, the word row first, then the senses; each topic once; nil for no row.
func TestTopicsForKey(t *testing.T) {
	f := &topics.File{Labels: []topics.Label{
		{Key: "j:1", Form: "行く", Sense: 3, Topics: []string{"health"}},
		{Key: "j:2", Form: "水", Topics: []string{"drink"}},
		{Key: "j:1", Form: "行く", Topics: []string{"movement", "travel"}},
		{Key: "j:1", Form: "いく", Sense: 1, Topics: []string{"travel"}},
	}}
	if got := f.TopicsForKey("j:1"); !slices.Equal(got, []string{"movement", "travel", "health"}) {
		t.Fatalf("j:1: %v", got)
	}
	if got := f.TopicsForKey("j:9"); got != nil {
		t.Fatalf("j:9: %v", got)
	}
	zh, err := topics.Load("zh")
	if err != nil || zh == nil {
		t.Fatal(err)
	}
	if got := zh.TopicsForKey("八"); !slices.Contains(got, "numbers") {
		t.Fatalf("八: %v", got)
	}
}
