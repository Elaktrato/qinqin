package entries_test

import (
	"testing"

	"qinqin/internal/entries"
)

// Language codes are case-insensitive everywhere else (manifests and
// workspaces lowercase them), so a query for "ZH" must not come back empty.
func TestSearchLanguageIsCaseInsensitive(t *testing.T) {
	st := seedSearch(t)
	hits := mustSearch(t, st, entries.SearchQuery{Text: "nihao", Lang: "ZH"})
	if !hasWritten(hits, "你好") {
		t.Fatalf("search lang=ZH = %+v, want 你好", hits)
	}
}
