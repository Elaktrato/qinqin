package lang_test

import (
	"testing"

	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// The zh pack registers for these tests the same way main.go registers it
// for the server.
func init() {
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
}

func TestForReturnsRegisteredPack(t *testing.T) {
	if got := lang.For("zh").Code(); got != "zh" {
		t.Errorf(`For("zh").Code() = %q, want "zh"`, got)
	}
	// Codes are matched case-insensitively.
	if got := lang.For("ZH").Code(); got != "zh" {
		t.Errorf(`For("ZH").Code() = %q, want "zh"`, got)
	}
}

func TestRegistered(t *testing.T) {
	if !lang.Registered("zh") {
		t.Error(`Registered("zh") = false, want true`)
	}
	if !lang.Registered("ZH") {
		t.Error(`Registered("ZH") = false, want true (case-insensitive)`)
	}
	if lang.Registered("es") {
		t.Error(`Registered("es") = true, want false without a code pack`)
	}
}

func TestForUnknownCodeUsesGenericPack(t *testing.T) {
	p := lang.For("es")
	if got := p.NormalizeReading("latin", "Hola"); got != "hola" {
		t.Errorf(`generic NormalizeReading("latin", "Hola") = %q, want "hola"`, got)
	}
	if got := p.SearchPlain("HOLA"); got != "hola" {
		t.Errorf(`generic SearchPlain("HOLA") = %q, want "hola"`, got)
	}
	// The generic pack derives nothing: readings come back unchanged.
	in := []model.Reading{{Type: "latin", Value: "Hola", Plain: "hola", Ord: 0}}
	out := p.DeriveReadings(in)
	if len(out) != 1 || out[0] != in[0] {
		t.Errorf("generic DeriveReadings = %+v, want the input unchanged", out)
	}
}

func TestZhNormalizeReading(t *testing.T) {
	p := lang.For("zh")
	if got := p.NormalizeReading("pinyin", "hǎo"); got != "hao" {
		t.Errorf(`zh NormalizeReading("pinyin", "hǎo") = %q, want "hao"`, got)
	}
	if got := p.NormalizeReading("pinyin", "Nǐ hǎo"); got != "nihao" {
		t.Errorf(`zh NormalizeReading("pinyin", "Nǐ hǎo") = %q, want "nihao"`, got)
	}
	// Non-pinyin readings keep their form: bopomofo has no case.
	if got := p.NormalizeReading("bopomofo", "ㄏㄠˇ"); got != "ㄏㄠˇ" {
		t.Errorf(`zh NormalizeReading("bopomofo", "ㄏㄠˇ") = %q, want "ㄏㄠˇ"`, got)
	}
}

func TestZhSearchPlain(t *testing.T) {
	p := lang.For("zh")
	if got := p.SearchPlain("Nǐ hǎo"); got != "nihao" {
		t.Errorf(`zh SearchPlain("Nǐ hǎo") = %q, want "nihao"`, got)
	}
	if got := p.SearchPlain("hao3"); got != "hao" {
		t.Errorf(`zh SearchPlain("hao3") = %q, want "hao" (tone digits stripped)`, got)
	}
}

func TestZhDeriveReadings(t *testing.T) {
	p := lang.For("zh")

	// A pinyin reading gains a derived bopomofo reading; the input is kept.
	out := p.DeriveReadings([]model.Reading{{Type: "pinyin", Value: "hǎo"}})
	if len(out) != 2 {
		t.Fatalf("DeriveReadings(pinyin) = %+v, want the pinyin plus a bopomofo reading", out)
	}
	if out[0] != (model.Reading{Type: "pinyin", Value: "hǎo"}) {
		t.Errorf("DeriveReadings kept %+v, want the pinyin reading unchanged", out[0])
	}
	if out[1] != (model.Reading{Type: "bopomofo", Value: "ㄏㄠˇ", Plain: "ㄏㄠˇ"}) {
		t.Errorf("derived reading = %+v, want bopomofo ㄏㄠˇ", out[1])
	}

	// Multi-syllable pinyin converts as a whole.
	out = p.DeriveReadings([]model.Reading{{Type: "pinyin", Value: "nǐ hǎo"}})
	if len(out) != 2 || out[1].Value != "ㄋㄧˇ ㄏㄠˇ" {
		t.Errorf("DeriveReadings(nǐ hǎo) = %+v, want a derived bopomofo ㄋㄧˇ ㄏㄠˇ", out)
	}

	// An existing bopomofo reading is not duplicated.
	out = p.DeriveReadings([]model.Reading{
		{Type: "pinyin", Value: "hǎo"},
		{Type: "bopomofo", Value: "ㄏㄠˇ"},
	})
	if len(out) != 2 {
		t.Errorf("DeriveReadings with bopomofo present = %+v, want no duplicate", out)
	}

	// No pinyin reading, nothing derived.
	out = p.DeriveReadings([]model.Reading{{Type: "latin", Value: "hello"}})
	if len(out) != 1 {
		t.Errorf("DeriveReadings(latin) = %+v, want the input unchanged", out)
	}

	// Pinyin that cannot be converted derives nothing and never errors.
	out = p.DeriveReadings([]model.Reading{{Type: "pinyin", Value: "xyz"}})
	if len(out) != 1 {
		t.Errorf("DeriveReadings(xyz) = %+v, want the input unchanged", out)
	}
}

func TestValidCode(t *testing.T) {
	ok := map[string]string{"ES": "es", " pt_BR ": "pt-br", "zh-hant-tw": "zh-hant-tw", "es": "es"}
	for in, want := range ok {
		if got, valid := lang.ValidCode(in); !valid || got != want {
			t.Errorf("ValidCode(%q) = %q, %v; want %q, true", in, got, valid, want)
		}
	}
	for _, in := range []string{"e", "spanish", "es-", "es-x-very-long-tag", "", "Hello!"} {
		if got, valid := lang.ValidCode(in); valid {
			t.Errorf("ValidCode(%q) = %q, true; want invalid", in, got)
		}
	}
}

func TestCodes(t *testing.T) {
	got := lang.Codes()
	if len(got) != 2 || got[0] != "ja" || got[1] != "zh" {
		t.Errorf("Codes() = %v, want [ja zh]", got)
	}
}
