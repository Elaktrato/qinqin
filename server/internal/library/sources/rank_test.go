package sources_test

import (
	"reflect"
	"testing"

	"qinqin/internal/library/sources"
)

type hit struct{ id, title, author string }

func TestMatchRank(t *testing.T) {
	for _, c := range []struct {
		q, title, author string
		want             int
	}{
		{"山月記", "山月記", "中島敦", sources.RankExactTitle},
		{"山月", "山月記", "中島敦", sources.RankTitlePrefix},
		{"中島", "山月記", "中島敦", sources.RankAuthor},
		{"月記", "山月記", "中島敦", sources.RankSubstring},
		{"記中", "山月記", "中島敦", sources.RankSubstring}, // across title and author
		{"漱石", "山月記", "中島敦", -1},
	} {
		if got := sources.MatchRank(c.q, c.title, c.author); got != c.want {
			t.Errorf("MatchRank(%q, %q, %q) = %d, want %d", c.q, c.title, c.author, got, c.want)
		}
	}
}

func TestTopMatchesRanksBeforeTruncating(t *testing.T) {
	items := []hit{
		{"9", "x雪国y", "a"},    // substring
		{"10", "雪国", "b"},     // exact
		{"2", "雪国物語", "c"},    // prefix
		{"3", "z", "雪国太郎"},    // author
		{"1", "雪国", "d"},      // exact, lower id
		{"4", "none", "none"}, // no match
		{"11", "雪国の春", "e"},   // prefix, higher id
	}
	rank := func(h hit) int { return sources.MatchRank("雪国", h.title, h.author) }
	id := func(h hit) string { return h.id }
	got := sources.TopMatches(items, 4, rank, id)
	var ids []string
	for _, h := range got {
		ids = append(ids, h.id)
	}
	if want := []string{"1", "10", "2", "11"}; !reflect.DeepEqual(ids, want) {
		t.Errorf("TopMatches ids = %v, want %v", ids, want)
	}
	all := sources.TopMatches(items, 100, rank, id)
	if len(all) != 6 || all[4].id != "3" || all[5].id != "9" {
		t.Errorf("TopMatches(all) = %v, want 6 hits ending author 3, substring 9", all)
	}
}
