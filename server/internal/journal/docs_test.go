package journal_test

import (
	"encoding/json"
	"strings"
	"testing"

	"qinqin/internal/ai"
	"qinqin/internal/journal"
)

func TestParseSettingsLenient(t *testing.T) {
	if got := journal.ParseSettings(json.RawMessage(`not json`)); got != (journal.Settings{ExplanationLanguage: "en"}) {
		t.Errorf("invalid JSON = %+v, want defaults", got)
	}
	if got := journal.ParseSettings(nil); got.ExplanationLanguage != "en" {
		t.Errorf("nil = %+v", got)
	}
	if got := journal.ParseSettings(json.RawMessage(`{"explanationLanguage":"klingon","guidance":"x"}`)); got.ExplanationLanguage != "en" || got.Guidance != "x" {
		t.Errorf("unknown language = %+v", got)
	}
	if got := journal.ParseSettings(json.RawMessage(`{"explanationLanguage":"zh-Hans"}`)); got.ExplanationLanguage != "zh-Hans" {
		t.Errorf("known language = %+v", got)
	}
	long, _ := json.Marshal(map[string]string{"guidance": strings.Repeat("字", 3000)})
	if got := journal.ParseSettings(long); len([]rune(got.Guidance)) != 2000 {
		t.Errorf("guidance runes = %d, want 2000", len([]rune(got.Guidance)))
	}
}

func TestParseEntry(t *testing.T) {
	if _, err := journal.ParseEntry(json.RawMessage(`{"id":"e1","text":"你好"}`)); err != nil {
		t.Errorf("valid entry: %v", err)
	}
	for _, bad := range []string{`{"text":"x"}`, `{"id":"e1"}`, `{"id":"e1","text":5}`, `nope`} {
		if _, err := journal.ParseEntry(json.RawMessage(bad)); err == nil {
			t.Errorf("ParseEntry(%s) succeeded", bad)
		}
	}
}

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
