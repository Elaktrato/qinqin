package pinyin

import (
	"os"
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
	for _, in := range []string{"hello", "hi", "fai", "duang", "gi", "ki", "bou", "chei", "len", "xiann", "yio"} {
		if _, err := ToBopomofo(in); err == nil {
			t.Errorf("ToBopomofo(%q) expected error", in)
		}
		if _, err := ToMarked(in); err == nil {
			t.Errorf("ToMarked(%q) expected error", in)
		}
		// ToNumbered splits unspaced runs, so fai, duang, bou, chei and yio
		// come out as valid syllable pairs; the rest cannot split.
		if _, err := ToNumbered(in); err == nil && !strings.Contains(" fai duang bou chei yio ", " "+in+" ") {
			t.Errorf("ToNumbered(%q) expected error", in)
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

func TestSyllableTableCorrections(t *testing.T) {
	for _, in := range []string{"pou", "zhei", "nen", "lun", "tun", "zei", "sen", "nun", "nun2"} { // 黁 [nun2] is attested in CC-CEDICT
		if _, err := ToBopomofo(in); err != nil {
			t.Errorf("ToBopomofo(%q) unexpected error: %v", in, err)
		}
	}
}

func TestInterjectionsAndSyllabicNasals(t *testing.T) {
	cases := []struct{ in, bopomofo, marked string }{
		{"yo1", "ㄧㄛ", "yō"},
		{"yo", "ㄧㄛ", "yo"},
		{"n2", "ㄣˊ", "ń"},
		{"ng3", "ㄫˇ", "ňg"},
		{"m2", "ㄇˊ", "ḿ"},
		{"hng", "ㄏㄫ", "hng"},
		{"hm4", "ㄏㄇˋ", "hm̀"},
		{"ê2", "ㄝˊ", "ế"},
		{"eh4", "ㄝˋ", "ề"},
		{"ế", "ㄝˊ", "ế"},
		{"ń", "ㄣˊ", "ń"},
	}
	for _, c := range cases {
		b, err := ToBopomofo(c.in)
		if err != nil || b != c.bopomofo {
			t.Errorf("ToBopomofo(%q) = %q, %v; want %q", c.in, b, err, c.bopomofo)
		}
		m, err := ToMarked(c.in)
		if err != nil || m != c.marked {
			t.Errorf("ToMarked(%q) = %q, %v; want %q", c.in, m, err, c.marked)
		}
	}
	if got, err := ToNumbered("ê2 n3 yo1"); err != nil || strings.Join(got, " ") != "eh2 n3 yo1" {
		t.Errorf("ToNumbered specials = %v, %v", got, err)
	}
	if p := Plain("ń ế"); p != "ne" {
		t.Errorf("Plain(ń ế) = %q, want ne", p)
	}
}

func TestApostropheForms(t *testing.T) {
	cases := []struct{ in, bopomofo, marked string }{
		{"xi'an", "ㄒㄧ ㄢ", "xi an"},
		{"Xī’ān", "ㄒㄧ ㄢ", "xī ān"},
		{"nv3'er2", "ㄋㄩˇ ㄦˊ", "nǚ ér"},
		{"ping'an an1", "ㄆㄧㄥ ㄢ ㄢ", "ping an ān"},
	}
	for _, c := range cases {
		b, err := ToBopomofo(c.in)
		if err != nil || b != c.bopomofo {
			t.Errorf("ToBopomofo(%q) = %q, %v; want %q", c.in, b, err, c.bopomofo)
		}
		m, err := ToMarked(c.in)
		if err != nil || m != c.marked {
			t.Errorf("ToMarked(%q) = %q, %v; want %q", c.in, m, err, c.marked)
		}
	}
	if _, err := ToMarked("'"); err == nil {
		t.Error("ToMarked of a lone apostrophe succeeded")
	}
	if _, err := ToMarked("xi'xyz"); err == nil {
		t.Error("ToMarked(xi'xyz) succeeded")
	}
}

func TestConverterEdgeRows(t *testing.T) {
	if p := Plain("Xī'ān"); p != "xian" {
		t.Errorf("Plain apostrophe = %q, want xian", p)
	}
	if p := Plain("xi’an"); p != "xian" {
		t.Errorf("Plain typographic apostrophe = %q, want xian", p)
	}
	b, err := ToBopomofo("nv3")
	if err != nil || b != "ㄋㄩˇ" {
		t.Errorf("ToBopomofo(nv3) = %q, %v", b, err)
	}
	m, err := ToMarked("nv3")
	if err != nil || m != "nǚ" {
		t.Errorf("ToMarked(nv3) = %q, %v", m, err)
	}
	m, err = ToMarked("zhong1 guo2 ren2")
	if err != nil || m != "zhōng guó rén" {
		t.Errorf("ToMarked three syllables = %q, %v", m, err)
	}
	m, err = ToMarked("NI3 HAO3")
	if err != nil || m != "nǐ hǎo" {
		t.Errorf("ToMarked uppercase = %q, %v", m, err)
	}
	b, err = ToBopomofo("ZHONG1 Guo2")
	if err != nil || b != "ㄓㄨㄥ ㄍㄨㄛˊ" {
		t.Errorf("ToBopomofo uppercase = %q, %v", b, err)
	}
}

func TestInitialsDeriveFromBopomofoTable(t *testing.T) {
	if len(initials) != len(initialBopomofo)-1 {
		t.Fatalf("initials has %d entries, initialBopomofo %d (minus the empty initial)", len(initials), len(initialBopomofo))
	}
	for i, ini := range initials {
		if _, ok := initialBopomofo[ini]; !ok {
			t.Errorf("initial %q is not in initialBopomofo", ini)
		}
		if i > 0 && len(initials[i-1]) < len(ini) {
			t.Errorf("initials not ordered longest first at %q", ini)
		}
	}
}

// The specials must never leak into the splitting of an unspaced token:
// the longest-first split would otherwise end a run on n, ng or m.
func TestToNumberedSpecialsOnlyAsWholeTokens(t *testing.T) {
	for _, in := range []string{"xiann", "hǎom", "dianm", "nǐhǎom", "xianng"} {
		if got, err := ToNumbered(in); err == nil {
			t.Errorf("ToNumbered(%q) = %v, want an error", in, got)
		}
	}
	cases := []struct{ in, want string }{
		{"réngōng", "ren2 gong1"},
		{"bàngōng", "ban4 gong1"},
		{"fēngōng", "fen1 gong1"},
		{"jìngōng", "jin4 gong1"},
		{"jīběngōng", "ji1 ben3 gong1"},
		{"nóngmíngōng", "nong2 min2 gong1"},
		{"zhǔréngōng", "zhu3 ren2 gong1"},
		{"jíēn", "ji2 en1"},
		{"ren2gong1", "ren2 gong1"},
		{"nǔnàwǔtè", "nu3 na4 wu3 te4"},
		{"gélènuò", "ge2 le4 nuo4"},
		{"nun2", "nun2"},
		{"n2", "n2"},
		{"ng3 hm4", "ng3 hm4"},
		{"ê2 yo1", "eh2 yo1"},
	}
	for _, c := range cases {
		got, err := ToNumbered(c.in)
		if err != nil || strings.Join(got, " ") != c.want {
			t.Errorf("ToNumbered(%q) = %v, %v; want %q", c.in, got, err, c.want)
		}
	}
	// Upper-case M and NG are abbreviations, not the syllables.
	for _, in := range []string{"M", "NG", "N2", "Hm"} {
		if _, err := ToMarked(in); err == nil {
			t.Errorf("ToMarked(%q) succeeded, want an error", in)
		}
	}
}

// The audio fetch script lists the syllables it will write into an index;
// every one must parse here, or an index row could fail the import.
func TestFetchScriptSyllablesAreInTheTable(t *testing.T) {
	data, err := os.ReadFile("../../../scripts/fetch-audio-commons.mjs")
	if err != nil {
		t.Skipf("script not available: %v", err)
	}
	src := string(data)
	start := strings.Index(src, "const SYLLABLES")
	end := strings.Index(src[start:], ").split(' ')")
	if start < 0 || end < 0 {
		t.Fatal("cannot find the SYLLABLES list in the script")
	}
	var words []string
	for _, line := range strings.Split(src[start:start+end], "\n") {
		if i, j := strings.Index(line, "'"), strings.LastIndex(line, "'"); i >= 0 && j > i {
			words = append(words, strings.Fields(line[i+1:j])...)
		}
	}
	if len(words) < 400 {
		t.Fatalf("parsed only %d syllables from the script", len(words))
	}
	for _, w := range words {
		if _, err := parse(w + "1"); err != nil {
			t.Errorf("script syllable %q is not accepted by the pinyin table", w)
		}
	}
}
