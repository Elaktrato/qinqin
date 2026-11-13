package sources

import (
	"fmt"
	"reflect"
	"testing"
)

func numbers(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = fmt.Sprint(i)
	}
	return out
}

func TestAssortmentIsDeterministicPerSeed(t *testing.T) {
	items := numbers(200)
	a := Assortment(items, "2026-11-13", 12)
	b := Assortment(items, "2026-11-13", 12)
	if len(a) != 12 || !reflect.DeepEqual(a, b) {
		t.Fatalf("same seed: %v vs %v", a, b)
	}
	if c := Assortment(items, "2026-11-14", 12); reflect.DeepEqual(a, c) {
		t.Fatalf("different seeds gave the same assortment %v", a)
	}
	if reflect.DeepEqual(a, items[:12]) {
		t.Fatalf("assortment is catalog order: %v", a)
	}
}

func TestAssortmentNeverRepeatsAndKeepsInput(t *testing.T) {
	items := numbers(30)
	got := Assortment(items, "x", 30)
	seen := map[string]bool{}
	for _, s := range got {
		if seen[s] {
			t.Fatalf("repeat %s in %v", s, got)
		}
		seen[s] = true
	}
	if len(seen) != 30 {
		t.Fatalf("got %d distinct, want 30", len(seen))
	}
	if !reflect.DeepEqual(items, numbers(30)) {
		t.Fatal("input slice was reordered")
	}
}

func TestAssortmentLimits(t *testing.T) {
	if got := Assortment(numbers(5), "x", 12); len(got) != 5 {
		t.Errorf("limit above size: %d items", len(got))
	}
	if got := Assortment([]string(nil), "x", 12); got == nil || len(got) != 0 {
		t.Errorf("empty catalog: %#v, want empty non-nil", got)
	}
	if got := Assortment(numbers(5), "x", 0); len(got) != 0 {
		t.Errorf("limit 0: %v", got)
	}
}

func TestCombinedRankPutsDirectBeforePhonetic(t *testing.T) {
	// direct matches keep their MatchRank
	if r, ph := CombinedRank("東京", "東京八景", "太宰治", "tokyo", "tokyohakkei", "dazaiosamu"); r != RankTitlePrefix || ph {
		t.Errorf("direct = %d %v", r, ph)
	}
	// a phonetic exact title ranks after any direct substring match
	r, ph := CombinedRank("tokyo", "東京", "某", "tokyo", "tokyo", "bo")
	if !ph || r <= RankSubstring || r != RankPhonetic+RankExactTitle {
		t.Errorf("phonetic = %d %v", r, ph)
	}
	if r, _ := CombinedRank("x", "東京", "某", "", "tokyo", "bo"); r != -1 {
		t.Errorf("empty phonetic query matched: %d", r)
	}
	if r, _ := CombinedRank("zzz", "東京", "某", "zzz", "", ""); r != -1 {
		t.Errorf("work without phonetic keys matched: %d", r)
	}
}
