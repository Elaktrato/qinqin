package journal_test

import (
	"strings"
	"testing"

	"qinqin/internal/ai"
	"qinqin/internal/journal"
)

func TestFilterSuggestionWords(t *testing.T) {
	items := []ai.SuggestionItem{
		{Title: " T1 ", Prompt: " p ", Words: []string{"学校", "捏造", " 老师 "}},
		{Title: "T2", Prompt: "p", Words: []string{"捏造"}},
		{Title: "T3"}, {Title: "T4"}, {Title: "T5"}, {Title: "T6"},
	}
	got := journal.FilterSuggestionWords(items, []string{"学校", "老师"})
	if len(got) != 5 {
		t.Fatalf("items = %d, want 5", len(got))
	}
	if got[0].Title != "T1" || got[0].Prompt != "p" || strings.Join(got[0].Words, ",") != "学校,老师" {
		t.Errorf("item 0 = %+v", got[0])
	}
	if len(got[1].Words) != 0 {
		t.Errorf("invented word kept: %+v", got[1])
	}
}
