package components_test

import (
	"reflect"
	"strings"
	"testing"

	"qinqin/internal/components"
)

func TestParse(t *testing.T) {
	src := "\xef\xbb\xbf# KanjiVG-derived\n\n語\t言 口 吾 口 五 二\r\n話\t言  舌 話 口\n吾\t五 口\n"
	parts := "# strokes\n言\t7\n口\t3\n\n"
	d, err := components.Parse(strings.NewReader(src), strings.NewReader(parts))
	if err != nil {
		t.Fatal(err)
	}
	want := components.Data{
		Chars: map[string][]string{
			"語": {"言", "口", "吾", "五", "二"}, // duplicates kept once, in order
			"話": {"言", "舌", "口"},           // the self part dropped, runs of spaces
			"吾": {"五", "口"},
		},
		Strokes: map[string]int{"言": 7, "口": 3},
	}
	if !reflect.DeepEqual(d, want) {
		t.Fatalf("Parse =\n%v\nwant\n%v", d, want)
	}
	// parts.tsv is optional.
	d, err = components.Parse(strings.NewReader("語\t言\n"), nil)
	if err != nil || len(d.Strokes) != 0 || d.Strokes == nil || len(d.Chars) != 1 {
		t.Fatalf("without parts.tsv: %v %v", d, err)
	}
}

func TestParseErrorsNameTheLine(t *testing.T) {
	many := make([]string, components.MaxParts+1)
	for i := range many {
		many[i] = string(rune(0x4E00 + i))
	}
	for _, c := range []struct {
		name, components, parts, want string
	}{
		{"non-Han character", "a\t言\n", "", "components.tsv line 1"},
		{"radical-block character", "⺍\t言\n", "", "components.tsv line 1"},
		{"two characters", "# c\n語話\t言\n", "", "components.tsv line 2"},
		{"missing tab", "語 言 口\n", "", "components.tsv line 1"},
		{"no parts", "語\t \n", "", "components.tsv line 1"},
		{"multi-code-point part", "語\t言 口口\n", "", "components.tsv line 1"},
		{"control part", "語\t言 \x01\n", "", "components.tsv line 1"},
		{"too many parts", "話\t言\n龘\t" + strings.Join(many, " ") + "\n", "", "components.tsv line 2"},
		{"duplicate character", "語\t言\n話\t言\n語\t口\n", "", "components.tsv line 3"},
		{"invalid UTF-8", "語\t\xff\n", "", "components.tsv line 1"},
		{"strokes 0", "語\t言\n", "言\t0\n", "parts.tsv line 1"},
		{"strokes 65", "語\t言\n", "口\t3\n言\t65\n", "parts.tsv line 2"},
		{"strokes not a number", "語\t言\n", "言\tseven\n", "parts.tsv line 1"},
		{"part of two code points", "語\t言\n", "言口\t7\n", "parts.tsv line 1"},
		{"duplicate part", "語\t言\n", "言\t7\n言\t7\n", "parts.tsv line 2"},
		{"parts missing tab", "語\t言\n", "言 7\n", "parts.tsv line 1"},
	} {
		var parts *strings.Reader
		if c.parts != "" {
			parts = strings.NewReader(c.parts)
		}
		var err error
		if parts == nil {
			_, err = components.Parse(strings.NewReader(c.components), nil)
		} else {
			_, err = components.Parse(strings.NewReader(c.components), parts)
		}
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: err = %v, want it to name %q", c.name, err, c.want)
		}
	}
}

func TestParseCaps(t *testing.T) {
	restore := components.SetMaxBytesForTest(64)
	defer restore()
	long := strings.Repeat("語\t言\n", 1) + strings.Repeat("# padding padding padding\n", 4)
	if _, err := components.Parse(strings.NewReader(long), nil); err == nil || !strings.Contains(err.Error(), "components.tsv") || !strings.Contains(err.Error(), "limit") {
		t.Errorf("over-cap components.tsv: err = %v", err)
	}
	if _, err := components.Parse(strings.NewReader("語\t言\n"), strings.NewReader(strings.Repeat("# x\n", 40))); err == nil || !strings.Contains(err.Error(), "parts.tsv") {
		t.Errorf("over-cap parts.tsv: err = %v", err)
	}
}
