package pinyin

import (
	"strings"
	"testing"
)

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
		{"fa5", "ㄈㄚ"},
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
	if p := Plain("lǜ"); p != "lv" {
		t.Errorf("Plain(\"lǜ\") = %q, want %q", p, "lv")
	}
	if p := Plain("lü"); p != "lv" {
		t.Errorf("Plain(\"lü\") = %q, want %q", p, "lv")
	}
	if p := Plain("lu:"); p != "lv" {
		t.Errorf("Plain(\"lu:\") = %q, want %q", p, "lv")
	}
}

func TestDictionarySyllablesAccepted(t *testing.T) {
	cases := []struct {
		in, bopomofo, marked string
	}{
		{"dia3", "ㄉㄧㄚˇ", "diǎ"},
		{"lo", "ㄌㄛ", "lo"},
		{"kei1", "ㄎㄟ", "kēi"},
		{"tei1", "ㄊㄟ", "tēi"},
	}
	for _, c := range cases {
		b, err := ToBopomofo(c.in)
		if err != nil {
			t.Errorf("ToBopomofo(%q) unexpected error: %v", c.in, err)
		} else if b != c.bopomofo {
			t.Errorf("ToBopomofo(%q) = %q, want %q", c.in, b, c.bopomofo)
		}
		m, err := ToMarked(c.in)
		if err != nil {
			t.Errorf("ToMarked(%q) unexpected error: %v", c.in, err)
		} else if m != c.marked {
			t.Errorf("ToMarked(%q) = %q, want %q", c.in, m, c.marked)
		}
	}
}

func TestRealSyllablesAccepted(t *testing.T) {
	for _, in := range []string{
		"a", "o", "e", "er", "yi", "wu", "yu", "yong", "weng", "wen",
		"bo", "mo", "fo", "me", "miu", "diu", "niu", "liu", "dei", "zhei", "shei",
		"nü", "lüe", "nüe", "jiong", "juan", "xun", "zhua", "shuai", "chuang",
		"zi", "ci", "si", "zhi", "chi", "shi", "ri", "ruo", "ruan",
		"hei", "gei", "ou", "cou", "den", "ban", "ren",
	} {
		if _, err := ToBopomofo(in); err != nil {
			t.Errorf("ToBopomofo(%q) unexpected error: %v", in, err)
		}
	}
}

func TestInvalidSyllableErrors(t *testing.T) {
	for _, in := range []string{"hello", "hi", "fai", "duang", "gi", "ki"} {
		if _, err := ToBopomofo(in); err == nil {
			t.Errorf("ToBopomofo(%q) expected error", in)
		}
		if _, err := ToMarked(in); err == nil {
			t.Errorf("ToMarked(%q) expected error", in)
		}
	}
}

func TestToNumbered(t *testing.T) {
	cases := []struct{ in, want string }{
		{"nǐ hǎo", "ni3 hao3"},
		{"lǜ", "lv4"},
		{"ma", "ma5"},
		{"nǚ'ér", "nv3 er2"},
		{"Xī'ān", "xi1 an1"},
		{"zhōngguó", "zhong1 guo2"},
		{"xian", "xian5"},
		{"ni3hao3", "ni3 hao3"},
		{"jǜ", "ju4"},
		{"xv2", "xu2"},
	}
	for _, c := range cases {
		got, err := ToNumbered(c.in)
		if err != nil {
			t.Errorf("ToNumbered(%q): %v", c.in, err)
			continue
		}
		if s := strings.Join(got, " "); s != c.want {
			t.Errorf("ToNumbered(%q) = %q, want %q", c.in, s, c.want)
		}
	}
	if _, err := ToNumbered("xyz"); err == nil {
		t.Error("ToNumbered(xyz) succeeded, want error")
	}
	if _, err := ToNumbered("  "); err == nil {
		t.Error("ToNumbered(blank) succeeded, want error")
	}
}

func TestToNumberedErhua(t *testing.T) {
	cases := []struct{ in, want string }{
		{"yi1 dian3 r5", "yi1 dian3 er5"}, // CC-CEDICT writes the suffix as its own token
		{"diǎnr", "dian3 er5"},
		{"huàr", "hua4 er5"},
		{"hua4r", "hua4 er5"},
		{"zhe4r", "zhe4 er5"},
		{"wánr", "wan2 er5"},
		{"r5", "er5"},
		{"yī diǎnr", "yi1 dian3 er5"},
		{"rén", "ren2"}, // an initial r is not erhua
		{"er2", "er2"},
	}
	for _, c := range cases {
		got, err := ToNumbered(c.in)
		if err != nil {
			t.Errorf("ToNumbered(%q): %v", c.in, err)
			continue
		}
		if s := strings.Join(got, " "); s != c.want {
			t.Errorf("ToNumbered(%q) = %q, want %q", c.in, s, c.want)
		}
	}
	if _, err := ToNumbered("xyzr"); err == nil {
		t.Error("ToNumbered(xyzr) succeeded, want error")
	}
}
