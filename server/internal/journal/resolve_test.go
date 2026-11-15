package journal_test

import (
	"fmt"
	"strings"
	"testing"

	"qinqin/internal/ai"
	"qinqin/internal/journal"
)

const resolveText = "我昨天去学校。我去学校了。"

func raw(quote, before, corr string) ai.RawAnnotation {
	return ai.RawAnnotation{Quote: quote, ContextBefore: before, Correction: corr, Explanation: "e", Category: "grammar"}
}

func TestResolveAnnotations(t *testing.T) {
	t.Run("first occurrence by context", func(t *testing.T) {
		got, drop := journal.ResolveAnnotations(resolveText, "zh", []ai.RawAnnotation{raw("去学校", "昨天", "到学校")})
		if len(got) != 1 || drop != (journal.DropCounts{}) {
			t.Fatalf("got %+v drop %+v", got, drop)
		}
		if got[0].ID != "a1" || got[0].Prefix != "我昨天" || got[0].Suffix != "。我去学校了。" {
			t.Errorf("annotation = %+v", got[0])
		}
	})
	t.Run("context that only the second occurrence has", func(t *testing.T) {
		got, _ := journal.ResolveAnnotations(resolveText, "zh", []ai.RawAnnotation{raw("去学校", "我", "到学校")})
		if len(got) != 1 || got[0].Prefix != "我昨天去学校。我" {
			t.Errorf("got %+v", got)
		}
	})
	t.Run("second occurrence by context", func(t *testing.T) {
		got, _ := journal.ResolveAnnotations(resolveText, "zh", []ai.RawAnnotation{raw("去学校", "。我", "到学校")})
		if len(got) != 1 {
			t.Fatalf("got %+v", got)
		}
		if got[0].Prefix != "我昨天去学校。我" || got[0].Suffix != "了。" {
			t.Errorf("prefix %q suffix %q", got[0].Prefix, got[0].Suffix)
		}
	})
	t.Run("unhelpful context falls back to first", func(t *testing.T) {
		got, _ := journal.ResolveAnnotations(resolveText, "zh", []ai.RawAnnotation{raw("去学校", "不对", "到学校")})
		if len(got) != 1 || got[0].Prefix != "我昨天" {
			t.Errorf("got %+v", got)
		}
	})
	t.Run("drops", func(t *testing.T) {
		in := []ai.RawAnnotation{
			raw("不存在", "", "有"),   // not found
			raw("去学校", "", "去学校"), // no change
			raw("昨天", "", "go"),   // wrong script
			raw("  ", "", "有"),    // empty
			raw("昨天去", "", "昨日去"), // kept
			raw("天去学", "", "天到学"), // overlaps
		}
		got, drop := journal.ResolveAnnotations(resolveText, "zh", in)
		want := journal.DropCounts{NotFound: 1, NoChange: 1, WrongScript: 1, Empty: 1, Overlap: 1}
		if drop != want {
			t.Errorf("drop = %+v, want %+v", drop, want)
		}
		if len(got) != 1 || got[0].Quote != "昨天去" {
			t.Errorf("got %+v", got)
		}
	})
	t.Run("too many", func(t *testing.T) {
		var b strings.Builder
		var in []ai.RawAnnotation
		for i := 0; i < 45; i++ {
			c := string(rune(0x4e00 + i))
			b.WriteString(c + "。")
			in = append(in, raw(c, "", string(rune(0x5000+i))))
		}
		got, drop := journal.ResolveAnnotations(b.String(), "zh", in)
		if len(got) != 40 || drop.TooMany != 5 {
			t.Errorf("kept %d, drop %+v", len(got), drop)
		}
		for i, a := range got {
			if a.ID != fmt.Sprintf("a%d", i+1) {
				t.Fatalf("id %d = %s", i, a.ID)
			}
		}
	})
	t.Run("caps long fields", func(t *testing.T) {
		r := raw("昨天", "", "昨日")
		r.Explanation = strings.Repeat("长", 1500)
		got, _ := journal.ResolveAnnotations(resolveText, "zh", []ai.RawAnnotation{r})
		if len([]rune(got[0].Explanation)) != 1000 {
			t.Errorf("explanation runes = %d", len([]rune(got[0].Explanation)))
		}
	})
}
