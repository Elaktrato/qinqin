package journal_test

import (
	"testing"

	"qinqin/internal/journal"
)

func TestCorrectionFitsLanguage(t *testing.T) {
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
		if got := journal.CorrectionFitsLanguage(c.lang, c.s); got != c.want {
			t.Errorf("CorrectionFitsLanguage(%q, %q) = %v, want %v", c.lang, c.s, got, c.want)
		}
	}
}
