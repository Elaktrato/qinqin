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
		{"xx", "anything", true}, {"xx", "去了", true},
	}
	for _, c := range cases {
		if got := journal.CorrectionFitsLanguage(c.lang, c.s); got != c.want {
			t.Errorf("CorrectionFitsLanguage(%q, %q) = %v, want %v", c.lang, c.s, got, c.want)
		}
	}
}
