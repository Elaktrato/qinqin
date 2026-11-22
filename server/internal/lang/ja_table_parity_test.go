package lang_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/lang"
	"qinqin/internal/lemma"
)

// TestJaTableParity: the rule table reproduces the Go rules exactly —
// same forms, classes and reasons in the same order — on every prefix of
// at most 12 code points at every offset of the grammar-pack example
// sentences, plus the surfaces the other tests use. Temporary: removed
// with the Go rules once Ja runs on the table.
func TestJaTableParity(t *testing.T) {
	tb := lemma.For("ja")
	if tb == nil {
		t.Fatal("no built-in ja table")
	}
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "plugins", "data", "ja-grammar", "lessons.json"))
	if err != nil {
		t.Fatal(err)
	}
	var pack struct {
		Lessons []struct {
			Examples []struct{ Text string } `json:"examples"`
		} `json:"lessons"`
	}
	if err := json.Unmarshal(raw, &pack); err != nil {
		t.Fatal(err)
	}
	surfaces := map[string]bool{}
	for _, l := range pack.Lessons {
		for _, e := range l.Examples {
			rs := []rune(e.Text)
			for i := range rs {
				for n := 1; n <= 12 && i+n <= len(rs); n++ {
					surfaces[string(rs[i:i+n])] = true
				}
			}
		}
	}
	for _, s := range []string{"食べさせられなかった", "していませんでした", "食べさせられていなかった", "行きたくなかった",
		"いえ", "いろ", "あれ", "なれ", "いたい", "みたい", "見てよ", "してよ", "これよ", "それよ", "だれよ", "たべよ",
		"たべろ", "やめろ", "たべたい", "いきたい", "見ろ", "見よ", "考えよ", "起きよ", "捨てろ", "しろ", "こい", "したい",
		"いれば", "来させる", "来られる", "きた", "こない", "いった", "いって", "せよ", "来い"} {
		surfaces[s] = true
	}
	if len(surfaces) < 100000 {
		t.Fatalf("only %d surfaces", len(surfaces))
	}
	diffs := 0
	for s := range surfaces {
		old := lang.Ja{}.Deinflect(s)
		got := tb.Deinflect(s)
		same := len(old) == len(got)
		for i := 0; same && i < len(old); i++ {
			same = old[i].Form == got[i].Form && old[i].Class == got[i].Class && slices.Equal(old[i].Reasons, got[i].Reasons)
		}
		if !same {
			if diffs++; diffs <= 10 {
				t.Errorf("Deinflect(%q): Go %+v, table %+v", s, old, got)
			}
		}
	}
	t.Logf("%d surfaces compared, %d differ", len(surfaces), diffs)
}
