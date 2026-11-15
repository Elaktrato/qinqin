package audio

import (
	"strings"
	"testing"

	"qinqin/internal/dict"
)

const header = "kind\tform\treading\tfile\tlicense\tattribution\tsource\n"

func manifest(lang, license string) dict.Manifest {
	return dict.Manifest{ID: "t", Language: lang, License: license, Attribution: "Someone",
		Type: dict.TypeAudio, Format: dict.FormatAudioIndex}
}

func TestParseIndex(t *testing.T) {
	rows, err := ParseIndex(strings.NewReader(header+
		"term\t風\tかぜ\taudio/a.opus\t\t\t\n"+
		"term\t你好\tnǐ hǎo\taudio/b.mp3\tCC0\tMe\thttps://x\n"), manifest("ja", "CC BY 4.0"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].License != "CC BY 4.0" || rows[0].Attribution != "Someone" ||
		rows[1].License != "CC0" || rows[1].Attribution != "Me" || rows[1].Source != "https://x" {
		t.Errorf("rows = %+v", rows)
	}
	zh, err := ParseIndex(strings.NewReader(header+"syllable\t\tni3\taudio/n.ogg\t\t\t\n"), manifest("zh", "CC0"))
	if err != nil || len(zh) != 1 || zh[0].Kind != "syllable" {
		t.Errorf("syllable = %+v, %v", zh, err)
	}
}

func TestParseIndexRejects(t *testing.T) {
	cases := map[string]struct {
		lang, license, body, want string
	}{
		"header":      {"ja", "CC0", "kind\tform\n", "header"},
		"kind":        {"ja", "CC0", "word\t風\tかぜ\taudio/a.opus\t\t\t\n", "kind"},
		"syl form":    {"zh", "CC0", "syllable\tx\tni3\taudio/a.opus\t\t\t\n", "syllable"},
		"syl key":     {"zh", "CC0", "syllable\t\tni6\taudio/a.opus\t\t\t\n", "ni6"},
		"syl in ja":   {"ja", "CC0", "syllable\t\tni3\taudio/a.opus\t\t\t\n", "syllable"},
		"traversal":   {"ja", "CC0", "term\t風\tかぜ\taudio/../a.opus\t\t\t\n", "file"},
		"outside dir": {"ja", "CC0", "term\t風\tかぜ\tother/a.opus\t\t\t\n", "file"},
		"extension":   {"ja", "CC0", "term\t風\tかぜ\taudio/a.wav\t\t\t\n", "file"},
		"per file":    {"ja", "per file", "term\t風\tかぜ\taudio/a.opus\t\t\t\n", "line 2"},
		"empty form":  {"ja", "CC0", "term\t\tかぜ\taudio/a.opus\t\t\t\n", "form"},
	}
	for name, c := range cases {
		body := c.body
		if name != "header" {
			body = header + body
		}
		_, err := ParseIndex(strings.NewReader(body), manifest(c.lang, c.license))
		if err == nil || !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s: err = %v, want it to contain %q", name, err, c.want)
		}
	}
}

func TestReadingKey(t *testing.T) {
	cases := []struct{ lang, in, want string }{
		{"ja", "カゼ", "かぜ"},
		{"ja", "か ぜ", "かぜ"},
		{"zh", "nǐ hǎo", "ni3hao3"},
		{"zh", "ni3 hao3", "ni3hao3"},
		{"zh", "xyz", ""},
		{"zh", "", ""},
	}
	for _, c := range cases {
		if got := ReadingKey(c.lang, c.in); got != c.want {
			t.Errorf("ReadingKey(%s,%q) = %q, want %q", c.lang, c.in, got, c.want)
		}
	}
}

func TestParseIndexAcceptsTermWithoutReading(t *testing.T) {
	rows, err := ParseIndex(strings.NewReader(header+"term\t块钱\t\taudio/a.ogg\t\t\t\n"), manifest("zh", "CC0"))
	if err != nil || len(rows) != 1 || rows[0].Reading != "" {
		t.Errorf("rows = %+v, %v; want a term row with no reading", rows, err)
	}
}
