package main

import (
	"context"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// fixtureAnalyzer loads the fixture dictionary of code into a fresh
// database and returns its analyzer.
func fixtureAnalyzer(t *testing.T, code string, mutate func(*LangRules)) *analyzer {
	t.Helper()
	r, err := loadRules(fixtureRules)
	if err != nil {
		t.Fatal(err)
	}
	lr := r.Languages[code]
	if mutate != nil {
		mutate(&lr)
	}
	a, err := newAnalyzer(context.Background(), filepath.Join(t.TempDir(), "dict.db"), code, lr, ".")
	if err != nil {
		t.Fatalf("newAnalyzer(%s): %v", code, err)
	}
	t.Cleanup(a.close)
	return a
}

type readingCase struct {
	text, reading string
	words         []string
	ambiguous     string // a word that must be in the review list
	fullCoverage  bool
}

func checkReadings(t *testing.T, a *analyzer, cases []readingCase) {
	t.Helper()
	for _, c := range cases {
		got, err := a.analyze(context.Background(), c.text)
		if err != nil {
			t.Fatalf("analyze %s: %v", c.text, err)
		}
		if got.reading != c.reading {
			t.Errorf("%s: reading %q, want %q", c.text, got.reading, c.reading)
		}
		if c.words != nil && !slices.Equal(got.words, c.words) {
			t.Errorf("%s: words %q, want %q", c.text, got.words, c.words)
		}
		if c.ambiguous != "" && !slices.ContainsFunc(got.ambiguous, func(s string) bool { return strings.HasPrefix(s, c.ambiguous+"\t") }) {
			t.Errorf("%s: review list %q lacks %s", c.text, got.ambiguous, c.ambiguous)
		}
		if c.reading != "" && len(got.ambiguous) != 0 {
			t.Errorf("%s: has a reading but review entries %q", c.text, got.ambiguous)
		}
		if (got.coverage == 1) != c.fullCoverage {
			t.Errorf("%s: coverage %.2f, want full=%v", c.text, got.coverage, c.fullCoverage)
		}
	}
}

func TestChineseReadings(t *testing.T) {
	a := fixtureAnalyzer(t, "zh", nil)
	checkReadings(t, a, []readingCase{
		// Syllables of a word joined, words spaced, punctuation mapped.
		{text: "我喜欢学习汉语。", reading: "wǒ xǐhuan xuéxí hànyǔ.", words: []string{"喜欢", "学习", "汉语"}, fullCoverage: true},
		// 吧 and 了 have two readings; the rules' defaults settle them.
		{text: "我们一起去吃饭吧。", reading: "wǒmen yīqǐ qù chīfàn ba.", words: []string{"我们", "一起", "吃饭"}, fullCoverage: true},
		{text: "他去了银行。", reading: "tā qù le yínháng.", words: []string{"银行"}, fullCoverage: true},
		// 长 has two readings and no default: no reading, reviewed.
		{text: "银行很长。", reading: "", words: []string{"银行"}, ambiguous: "长", fullCoverage: true},
		// An apostrophe before a syllable starting with a vowel.
		{text: "我们去西安。", reading: "wǒmen qù xī'ān.", words: []string{"我们", "西安"}, fullCoverage: true},
		// A character the dictionary lacks: no reading, partial coverage.
		{text: "我喜欢猫。", reading: "", words: []string{"喜欢"}},
		// Traditional characters match the traditional forms.
		{text: "我們喜歡漢語。", reading: "wǒmen xǐhuan hànyǔ.", words: []string{"我們", "喜歡", "漢語"}, fullCoverage: true},
		// Digits are kept; quotes open and close.
		{text: "我们3个朋友。", reading: "wǒmen 3 gè péngyou.", fullCoverage: true},
		{text: "他：“你好！”", reading: "tā: “nǐhǎo!”", words: []string{"你好"}, fullCoverage: true},
	})

	noDefaults := fixtureAnalyzer(t, "zh", func(l *LangRules) { l.DefaultReadings = nil })
	checkReadings(t, noDefaults, []readingCase{
		{text: "他去了银行。", reading: "", ambiguous: "了", fullCoverage: true},
	})
}

func TestJapaneseReadings(t *testing.T) {
	a := fixtureAnalyzer(t, "ja", nil)
	checkReadings(t, a, []readingCase{
		// 私 and 行く have two readings; the defaults settle them, and the
		// inflected 行きました keeps its kana tail.
		{text: "私は学校に行きました。", reading: "わたしはがっこうにいきました。", words: []string{"私", "学校", "行く"}, fullCoverage: true},
		{text: "水を飲んだ。", reading: "みずをのんだ。", words: []string{"水", "飲む"}, fullCoverage: true},
		// 今日 has two readings; the shipped default reads it きょう.
		{text: "今日は本です。", reading: "きょうはほんです。", words: []string{"今日", "本"}, fullCoverage: true},
		// 来る inflects irregularly: never derived.
		{text: "学校に来ます。", reading: "", words: []string{"学校", "来る"}, ambiguous: "来ます", fullCoverage: true},
		// A する compound: the noun's reading plus the kana tail.
		{text: "日本語を勉強しています。", reading: "にほんごをべんきょうしています。", words: []string{"日本語", "勉強"}, fullCoverage: true},
		{text: "これは本です。", reading: "これはほんです。", words: []string{"これ", "本"}, fullCoverage: true},
		// Kana the dictionary lacks is still its own reading, but the
		// coverage is partial.
		{text: "コーヒーを飲む。", reading: "コーヒーをのむ。", words: []string{"飲む"}},
		// A kana token that matches a word only through kana folding (りま
		// for リマ), or an uncommon one, is no word to file a sentence under;
		// its reading is still the kana itself.
		{text: "りまを飲む。", reading: "りまをのむ。", words: []string{"飲む"}, fullCoverage: true},
	})

	// 水 is also すい (an uncommon entry): only the JMdict-common reading
	// counts while preferCommonReadings is set.
	noCommon := fixtureAnalyzer(t, "ja", func(l *LangRules) { l.PreferCommonReadings = false })
	checkReadings(t, noCommon, []readingCase{
		{text: "水を飲んだ。", reading: "", ambiguous: "水", fullCoverage: true},
	})

	noDefaults := fixtureAnalyzer(t, "ja", func(l *LangRules) { l.DefaultReadings = nil })
	checkReadings(t, noDefaults, []readingCase{
		{text: "私は学校に行きました。", reading: "", ambiguous: "私", fullCoverage: true},
		{text: "今日は本です。", reading: "", words: []string{"今日", "本"}, ambiguous: "今日", fullCoverage: true},
	})
}

func TestJoinSyllables(t *testing.T) {
	for in, want := range map[string]string{
		"xǐ huan": "xǐhuan", "xī ān": "xī'ān", "tiān ān mén": "tiān'ānmén", "nǚ ér": "nǚ'ér", "wǒ": "wǒ", "Zhōng guó": "Zhōngguó",
	} {
		if got := joinSyllables(in); got != want {
			t.Errorf("joinSyllables(%q) = %q, want %q", in, got, want)
		}
	}
}
