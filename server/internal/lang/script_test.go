package lang_test

import (
	"testing"

	"qinqin/internal/lang"
)

func TestFitsScript(t *testing.T) {
	cases := []struct {
		lang, s string
		want    bool
	}{
		{"zh", "去了", true}, {"zh", "went", false}, {"zh", "2026年", true},
		{"ja", "行きました", true}, {"ja", "ikimashita", false},
		{"es", "fuimos", true}, {"es", "去了", false},
		{"ko", "갔어요", true}, {"ko", "went", false},
		{"zh", "", true}, {"zh", "。", true}, {"en", ";", true}, {"en", "", true}, {"ja", "、", true},
		{"zh", "了 !", true}, {"zh", "A。", false}, {"en", "去了,", false},
		{"xx", "anything", true}, {"xx", "去了", true},
		// The script comes from the language profile, by the primary subtag (#199).
		{"zh-TW", "去了", true}, {"zh-TW", "went", false}, {"ja-JP", "ikimashita", false},
	}
	for _, c := range cases {
		if got := lang.FitsScript(c.lang, c.s); got != c.want {
			t.Errorf("FitsScript(%q, %q) = %v, want %v", c.lang, c.s, got, c.want)
		}
	}
}

// The majority rule of the #185 fix wave, shared with the AI examples (#186):
// at least half of the letters in the language's script.
func TestMostlyInScript(t *testing.T) {
	cases := []struct {
		lang, s string
		want    bool
	}{
		{"zh", "你好！你今天去学校了吗？", true}, {"zh", "Sure! 你好", false}, {"zh", "我喜欢用 Go。", true},
		{"ja", "これは学校です。", true}, {"ja", "This is 学校.", false},
		{"es", "Me gusta comer.", true}, {"es", "我喜欢", false},
		{"zh", "。！", true}, {"xx", "anything", true},
	}
	for _, c := range cases {
		if got := lang.MostlyInScript(c.lang, c.s); got != c.want {
			t.Errorf("MostlyInScript(%q, %q) = %v, want %v", c.lang, c.s, got, c.want)
		}
	}
}
