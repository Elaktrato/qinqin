package dict

import (
	"fmt"
	"testing"
)

func TestPriorityScoreTable(t *testing.T) {
	for _, c := range []struct {
		tags []string
		want int
	}{
		{nil, 0},
		{[]string{"bogus"}, 0},
		{[]string{"nf00"}, 0},
		{[]string{"nf49"}, 0},
		{[]string{"nfx1"}, 0},
		{[]string{"news1"}, 60},
		{[]string{"ichi1"}, 60},
		{[]string{"spec1"}, 60},
		{[]string{"gai1"}, 60},
		{[]string{"news2"}, 30},
		{[]string{"ichi2"}, 30},
		{[]string{"spec2"}, 30},
		{[]string{"gai2"}, 30},
		{[]string{"nf01"}, 100},
		{[]string{"nf19"}, 82},
		{[]string{"nf24"}, 77},
		{[]string{"nf25"}, 53},
		{[]string{"nf48"}, 30},
		// Combined by max, never summed.
		{[]string{"ichi1", "news1", "spec1", "gai1"}, 60},
		{[]string{"ichi1", "news1", "nf19"}, 82},
		{[]string{"news2", "nf25"}, 53},
		{[]string{"ichi1", "news2", "nf40"}, 60},
	} {
		if got := priorityScore(c.tags); got != c.want {
			t.Errorf("priorityScore(%v) = %d, want %d", c.tags, got, c.want)
		}
	}
}

func TestPriorityScoreMonotonic(t *testing.T) {
	// nf01 is the most frequent bucket; every bucket outranks the next.
	prev := 101
	for n := 1; n <= 48; n++ {
		got := priorityScore([]string{fmt.Sprintf("nf%02d", n)})
		if got >= prev || got <= 0 || got > 100 {
			t.Errorf("nf%02d = %d, want in 1..100 and below nf%02d (%d)", n, got, n-1, prev)
		}
		prev = got
	}
	// Every tier-1 score outranks every tier-2 score: a tier-1 tag alone
	// beats the best tier-2 bucket (nf25), and nf24 (always news1) beats
	// a tier-1 tag alone.
	if t1, t2 := priorityScore([]string{"ichi1"}), priorityScore([]string{"nf25"}); t1 <= t2 {
		t.Errorf("ichi1 = %d, nf25 = %d, want tier 1 above tier 2", t1, t2)
	}
	if nf, t1 := priorityScore([]string{"nf24"}), priorityScore([]string{"news1"}); nf <= t1 {
		t.Errorf("nf24 = %d, news1 = %d, want nf24 above a bare tier-1 tag", nf, t1)
	}
}

func TestFormScorePenalizesRareForms(t *testing.T) {
	for _, c := range []struct {
		pri, inf []string
		want     int
	}{
		{[]string{"ichi1"}, nil, 60},
		{[]string{"ichi1"}, []string{"&ateji;"}, 60}, // not a rarity flag
		{[]string{"ichi1"}, []string{"&rK;"}, 20},
		{[]string{"ichi1"}, []string{"&oK;"}, 20},
		{[]string{"ichi1"}, []string{"&iK;"}, 20},
		{[]string{"ichi1"}, []string{"&sK;"}, 20},
		{[]string{"ichi1"}, []string{"&ik;"}, 20},
		{[]string{"ichi1"}, []string{"&ok;"}, 20},
		{[]string{"ichi1"}, []string{"&sk;"}, 20},
		{[]string{"ichi1"}, []string{"&rk;"}, 20},
		{[]string{"ichi1"}, []string{"rK"}, 20}, // a declared entity expanded by another reader
		{[]string{"news2"}, []string{"&rK;"}, 0},
		{nil, []string{"&rK;"}, 0},
		{[]string{"nf01"}, []string{"&rK;", "&oK;"}, 60}, // one penalty, not one per flag
	} {
		if got := formScore(c.pri, c.inf); got != c.want {
			t.Errorf("formScore(%v, %v) = %d, want %d", c.pri, c.inf, got, c.want)
		}
	}
}

func TestEntityName(t *testing.T) {
	for in, want := range map[string]string{"&uk;": "uk", "uk": "uk", " &rK; ": "rK", "": ""} {
		if got := entityName(in); got != want {
			t.Errorf("entityName(%q) = %q, want %q", in, got, want)
		}
	}
}
