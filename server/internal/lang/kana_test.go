package lang

import "testing"

func TestToHiragana(t *testing.T) {
	if got := ToHiragana("カゼ ふう"); got != "かぜ ふう" {
		t.Errorf("ToHiragana = %q", got)
	}
}
