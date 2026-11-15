package lang_test

import (
	"testing"

	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// The ja pack registers for these tests the same way main.go registers it.
func init() {
	lang.Register(lang.Ja{})
}

func TestJaNormalizeReading(t *testing.T) {
	p := lang.For("ja")
	// Kana readings take the hiragana plain form: katakana folds to
	// hiragana, the okurigana punctuation dictionary sources write into
	// kun readings drops, and the prolonged sound mark expands to the
	// vowel of the kana before it.
	if got := p.NormalizeReading("kana", "ガッコウ"); got != "がっこう" {
		t.Errorf(`ja NormalizeReading("kana", "ガッコウ") = %q, want "がっこう"`, got)
	}
	if got := p.NormalizeReading("kana", "まな.ぶ"); got != "まなぶ" {
		t.Errorf(`ja NormalizeReading("kana", "まな.ぶ") = %q, want "まなぶ"`, got)
	}
	if got := p.NormalizeReading("kana", "コーヒー"); got != "こおひい" {
		t.Errorf(`ja NormalizeReading("kana", "コーヒー") = %q, want "こおひい" (the prolonged mark expands)`, got)
	}
	if got := p.NormalizeReading("on", "ニチ"); got != "にち" {
		t.Errorf(`ja NormalizeReading("on", "ニチ") = %q, want "にち"`, got)
	}
	if got := p.NormalizeReading("kun", "まな-ぶ"); got != "まなぶ" {
		t.Errorf(`ja NormalizeReading("kun", "まな-ぶ") = %q, want "まなぶ"`, got)
	}
	// Every other reading lowercases: romaji has case, kana does not.
	if got := p.NormalizeReading("romaji", "GAKKOU"); got != "gakkou" {
		t.Errorf(`ja NormalizeReading("romaji", "GAKKOU") = %q, want "gakkou"`, got)
	}
}

func TestJaSearchPlain(t *testing.T) {
	p := lang.For("ja")
	// Romaji queries become kana — the canonical form of stored kana
	// readings — with the small tsu for doubled consonants, ん for a
	// closing n, and small ya/yu/yo combining. An n before a y is the
	// にゃ/にゅ/にょ onset, never ん; the ん-forms write their apostrophe.
	for _, tc := range []struct{ query, want string }{
		{"gakkou", "がっこう"},
		{"kitte", "きって"},
		{"konnichiwa", "こんにちは"},
		{"shinbun", "しんぶん"},
		{"kyou", "きょう"},
		{"toukyou", "とうきょう"},
		{"manabu", "まなぶ"},
		{"nyuuryoku", "にゅうりょく"},
		{"nyuu", "にゅう"},
		{"konnyaku", "こんにゃく"},
		{"shin'ya", "しんや"},
		{"kin'you", "きんよう"},
	} {
		if got := p.SearchPlain(tc.query); got != tc.want {
			t.Errorf("ja SearchPlain(%q) = %q, want %q", tc.query, got, tc.want)
		}
	}
	// Kana queries stay kana, katakana folded to hiragana; romaji
	// lowercases before it converts.
	if got := p.SearchPlain("がっこう"); got != "がっこう" {
		t.Errorf(`ja SearchPlain("がっこう") = %q, want "がっこう"`, got)
	}
	if got := p.SearchPlain("ガッコウ"); got != "がっこう" {
		t.Errorf(`ja SearchPlain("ガッコウ") = %q, want "がっこう" (katakana folded)`, got)
	}
	if got := p.SearchPlain("Gakkou"); got != "がっこう" {
		t.Errorf(`ja SearchPlain("Gakkou") = %q, want "がっこう"`, got)
	}
	// A query that does not convert stays as written — never an error.
	if got := p.SearchPlain("hello"); got != "hello" {
		t.Errorf(`ja SearchPlain("hello") = %q, want "hello" unchanged`, got)
	}
}

func TestJaDeriveReadings(t *testing.T) {
	p := lang.For("ja")

	// Each kana reading gains a romaji reading with its plain form
	// filled; the input is kept as written. Long vowels, the small tsu,
	// ん, the prolonged sound mark, and okurigana punctuation all
	// convert — こんにちわ is the wa-spelled kana; the particle spelling
	// こんにちは converts mechanically as konnichiha.
	for _, tc := range []struct{ kana, romaji string }{
		{"がっこう", "gakkou"},
		{"きって", "kitte"},
		{"きょう", "kyou"},
		{"しんぶん", "shinbun"},
		{"こーひー", "koohii"},
		{"まな.ぶ", "manabu"},
		{"こんにちわ", "konnichiwa"},
		{"ガッコウ", "gakkou"},      // katakana folds before it converts
		{"ファイル", "fairu"},       // loanword small vowels combine: ふ+ぁ = fa
		{"コーヒー", "koohii"},      // the prolonged mark expands in the plain form
		{"にゅうりょく", "nyuuryoku"}, // the ny combo the closing-n rule must not shadow
	} {
		out := p.DeriveReadings([]model.Reading{{Type: "kana", Value: tc.kana}})
		if len(out) != 2 {
			t.Fatalf("DeriveReadings(%s) = %+v, want the kana plus a derived romaji", tc.kana, out)
		}
		if out[0] != (model.Reading{Type: "kana", Value: tc.kana}) {
			t.Errorf("DeriveReadings(%s) kept %+v, want the kana reading unchanged", tc.kana, out[0])
		}
		if out[1] != (model.Reading{Type: "romaji", Value: tc.romaji, Plain: tc.romaji}) {
			t.Errorf("DeriveReadings(%s) derived %+v, want romaji %q", tc.kana, out[1], tc.romaji)
		}
	}

	// Two kana readings each derive their own romaji.
	out := p.DeriveReadings([]model.Reading{
		{Type: "kana", Value: "きって"},
		{Type: "kana", Value: "がっこう"},
	})
	if len(out) != 4 || out[2].Value != "kitte" || out[3].Value != "gakkou" {
		t.Errorf("DeriveReadings of two kana readings = %+v, want a romaji derived from each", out)
	}

	// An existing romaji reading derives nothing new.
	out = p.DeriveReadings([]model.Reading{
		{Type: "kana", Value: "がっこう"},
		{Type: "romaji", Value: "gakkou"},
	})
	if len(out) != 2 {
		t.Errorf("DeriveReadings with romaji present = %+v, want no duplicate", out)
	}

	// Kanji readings and anything else derive nothing.
	out = p.DeriveReadings([]model.Reading{{Type: "on", Value: "ニチ"}})
	if len(out) != 1 {
		t.Errorf("DeriveReadings(on) = %+v, want the input unchanged", out)
	}
}

func TestJaPackRomaji(t *testing.T) {
	p := lang.For("ja")

	// Both directions of the converter: a romaji query becomes kana,
	// and a kana reading derives its romaji.
	if got := p.SearchPlain("gakkou"); got != "がっこう" {
		t.Errorf(`ja SearchPlain("gakkou") = %q, want "がっこう"`, got)
	}
	out := p.DeriveReadings([]model.Reading{{Type: "kana", Value: "がっこう"}})
	if len(out) != 2 || out[1].Type != "romaji" || out[1].Value != "gakkou" {
		t.Errorf("DeriveReadings(がっこう) = %+v, want a derived romaji reading gakkou", out)
	}

	// The invariant holds for the ny syllables end to end: the romaji
	// derived from a にゅ reading converts back to the kana plain it was
	// derived from — a closing n never shadows the ny combos. (The んや
	// reading writes its apostrophe: shin'ya.)
	out = p.DeriveReadings([]model.Reading{{Type: "kana", Value: "にゅうりょく"}})
	if len(out) != 2 || out[1].Type != "romaji" {
		t.Fatalf("DeriveReadings(にゅうりょく) = %+v, want a derived romaji reading", out)
	}
	if got := p.SearchPlain(out[1].Value); got != "にゅうりょく" {
		t.Errorf("SearchPlain(%q) = %q, want にゅうりょく — the derived romaji must round-trip", out[1].Value, got)
	}

	// Katakana and hiragana are equivalent everywhere: stored plains
	// and queries fold to the same hiragana.
	if got := p.NormalizeReading("kana", "ガッコウ"); got != p.NormalizeReading("kana", "がっこう") {
		t.Errorf("plain of ガッコウ = %q, want the same as がっこう (%q)", got, p.NormalizeReading("kana", "がっこう"))
	}
	if got := p.SearchPlain("ガッコウ"); got != p.SearchPlain("がっこう") {
		t.Errorf("SearchPlain of ガッコウ = %q, want the same as がっこう (%q)", got, p.SearchPlain("がっこう"))
	}

	// A romaji query matches the plain form of the kana reading it
	// converts to — the point of the canonical form.
	kana := p.NormalizeReading("kana", "がっこう")
	if got := p.SearchPlain("gakkou"); got != kana {
		t.Errorf(`SearchPlain("gakkou") = %q, want the kana plain %q`, got, kana)
	}
}

// The derived romaji of a reading with ん before a vowel or y writes the
// apostrophe, so it converts back to the kana it came from.
func TestJaDerivedRomajiApostropheRoundTrips(t *testing.T) {
	p := lang.For("ja")
	for _, tc := range []struct{ kana, romaji string }{
		{"しんや", "shin'ya"},
		{"しんゃ", "shin'ya"},
		{"きんよう", "kin'you"},
		{"ほんい", "hon'i"},
		{"れんあい", "ren'ai"},
		{"しんにゅう", "shinnyuu"}, // ん+にゅ needs no apostrophe: nn is unambiguous
	} {
		out := p.DeriveReadings([]model.Reading{{Type: "kana", Value: tc.kana}})
		if got := out[1].Value; got != tc.romaji {
			t.Errorf("derive(%s) = %q, want %q", tc.kana, got, tc.romaji)
		}
	}
	for _, kana := range []string{"しんや", "きんよう", "ほんい", "れんあい", "しんにゅう"} {
		out := p.DeriveReadings([]model.Reading{{Type: "kana", Value: kana}})
		if got := p.SearchPlain(out[1].Value); got != kana {
			t.Errorf("SearchPlain(%q) = %q, want %q", out[1].Value, got, kana)
		}
	}
}

func TestJaSearchPlainParticleGreetings(t *testing.T) {
	p := lang.For("ja")
	for _, tc := range []struct{ query, want string }{
		{"konnichiwa", "こんにちは"},
		{"Konnichiwa", "こんにちは"},
		{"konbanwa", "こんばんは"},
		{"konnichiha", "こんにちは"},
		{"watashiwa", "わたしわ"}, // only the fixed greetings read は
	} {
		if got := p.SearchPlain(tc.query); got != tc.want {
			t.Errorf("SearchPlain(%q) = %q, want %q", tc.query, got, tc.want)
		}
	}
}

func TestJaSearchPlainHepburnMBeforeLabials(t *testing.T) {
	p := lang.For("ja")
	for _, tc := range []struct{ query, want string }{
		{"sampo", "さんぽ"},
		{"shimbun", "しんぶん"},
		{"kammuri", "かんむり"},
		{"gamma", "がんま"},
		{"mama", "まま"},
		{"onna", "おんな"},
	} {
		if got := p.SearchPlain(tc.query); got != tc.want {
			t.Errorf("SearchPlain(%q) = %q, want %q", tc.query, got, tc.want)
		}
	}
}

func TestJaProlongedMarkAfterEveryRow(t *testing.T) {
	p := lang.For("ja")
	for in, want := range map[string]string{
		"かー": "かあ", "きー": "きい", "くー": "くう", "けー": "けえ", "こー": "こお",
		"しゃー": "しゃあ", "ふぁー": "ふぁあ", "んー": "ん", "ー": "", "っー": "っ",
	} {
		if got := p.NormalizeReading("kana", in); got != want {
			t.Errorf("plain(%q) = %q, want %q", in, got, want)
		}
	}
}
