package pinyin

import "testing"

func TestBopomofoTable(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"nǐ hǎo", "ㄋㄧˇ ㄏㄠˇ"},
		{"ni3 hao3", "ㄋㄧˇ ㄏㄠˇ"},
		{"nǚ", "ㄋㄩˇ"},
		{"zhōng wén", "ㄓㄨㄥ ㄨㄣˊ"},
		{"ma", "ㄇㄚ"},
		{"lǜ", "ㄌㄩˋ"},
	}
	for _, c := range cases {
		got, err := ToBopomofo(c.in)
		if err != nil {
			t.Errorf("ToBopomofo(%q) error: %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("ToBopomofo(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestMarkedAndPlain(t *testing.T) {
	got, err := ToMarked("ni3 hao3")
	if err != nil {
		t.Fatalf("ToMarked error: %v", err)
	}
	if got != "nǐ hǎo" {
		t.Errorf("ToMarked(\"ni3 hao3\") = %q, want %q", got, "nǐ hǎo")
	}
	if p := Plain("Nǐ hǎo"); p != "nihao" {
		t.Errorf("Plain(\"Nǐ hǎo\") = %q, want %q", p, "nihao")
	}
}

func TestInvalidSyllableErrors(t *testing.T) {
	if _, err := ToBopomofo("hello"); err == nil {
		t.Error("ToBopomofo(\"hello\") expected error")
	}
	if _, err := ToMarked("hello"); err == nil {
		t.Error("ToMarked(\"hello\") expected error")
	}
}
