package counters

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// The Japanese counters table (table/counters-ja.json, CC BY 4.0, written
// for the project; table/NOTICE, table/REVIEW.md).
//
//go:embed table/counters-ja.json
var tableJSON []byte

// Table is the Japanese counters table.
type Table struct {
	Version       int       `json:"version"`
	ID            string    `json:"id"`
	Language      string    `json:"language"`
	Name          string    `json:"name"`
	License       string    `json:"license"`
	Attribution   string    `json:"attribution"`
	HumanReviewed bool      `json:"humanReviewed"`
	Counters      []Counter `json:"counters"`
	Nouns         []Noun    `json:"nouns"`
}

// Counter is one counter of the table: its id (the item keys'), written
// form and other accepted spellings, base reading, what it counts, its
// sound class (README, "Readings"), the numbers asked (1–10 and 何 when
// empty), and per number: the readings that replace the rule's, the
// accepted readings after them, and a written form that replaces number +
// counter.
type Counter struct {
	ID       string              `json:"id"`
	Written  string              `json:"written"`
	Variants []string            `json:"variants,omitempty"`
	Reading  string              `json:"reading"`
	Counts   string              `json:"counts"`
	Sound    string              `json:"sound"`
	Voiced3  bool                `json:"voiced3,omitempty"`
	Numbers  []string            `json:"numbers,omitempty"`
	Readings map[string][]string `json:"readings,omitempty"`
	Also     map[string][]string `json:"also,omitempty"`
	Forms    map[string]string   `json:"forms,omitempty"`
}

// Noun is one noun of the table with its counters, canonical first.
type Noun struct {
	Written  string   `json:"written"`
	Reading  string   `json:"reading"`
	Counters []string `json:"counters"`
}

var table = mustTable()

func mustTable() Table {
	var t Table
	dec := json.NewDecoder(bytes.NewReader(tableJSON))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&t); err != nil {
		panic(fmt.Sprintf("counters: table/counters-ja.json: %v", err))
	}
	return t
}

// JapaneseTable is the embedded table.
func JapaneseTable() Table { return table }

// CounterByID is a counter of the table.
func CounterByID(id string) (Counter, bool) {
	i := slices.IndexFunc(table.Counters, func(c Counter) bool { return c.ID == id })
	if i < 0 {
		return Counter{}, false
	}
	return table.Counters[i], true
}

// DefaultNumbers are the numbers asked of a counter without its own list.
var DefaultNumbers = []string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", What}

type numberReading struct{ full, gem, kanji string }

// numbers: the reading of each number, its geminated form before a
// counter that geminates (いっ, ろっ, はっ, じゅっ), and its kanji.
var numbers = map[string]numberReading{
	"1": {"いち", "いっ", "一"}, "2": {"に", "", "二"}, "3": {"さん", "", "三"}, "4": {"よん", "", "四"},
	"5": {"ご", "", "五"}, "6": {"ろく", "ろっ", "六"}, "7": {"なな", "", "七"}, "8": {"はち", "はっ", "八"},
	"9": {"きゅう", "", "九"}, "10": {"じゅう", "じゅっ", "十"}, "11": {"じゅういち", "じゅういっ", "十一"},
	"12": {"じゅうに", "", "十二"}, "14": {"じゅうよん", "", "十四"}, "20": {"にじゅう", "にじゅっ", "二十"},
	"24": {"にじゅうよん", "", "二十四"}, What: {"なん", "", "何"},
}

// geminating: the numbers whose geminated form a sound class takes (h and
// k: 1, 6, 8, 10; s and t: 1, 8, 10; and the tens and elevens alike).
var geminating = map[string][]string{
	"h": {"1", "6", "8", "10", "11", "20"},
	"k": {"1", "6", "8", "10", "11", "20"},
	"s": {"1", "8", "10", "11", "20"},
	"t": {"1", "8", "10", "11", "20"},
}

var (
	dakuten    = map[rune]rune{'か': 'が', 'き': 'ぎ', 'く': 'ぐ', 'け': 'げ', 'こ': 'ご', 'さ': 'ざ', 'し': 'じ', 'す': 'ず', 'せ': 'ぜ', 'そ': 'ぞ', 'た': 'だ', 'ち': 'ぢ', 'つ': 'づ', 'て': 'で', 'と': 'ど', 'は': 'ば', 'ひ': 'び', 'ふ': 'ぶ', 'へ': 'べ', 'ほ': 'ぼ'}
	handakuten = map[rune]rune{'は': 'ぱ', 'ひ': 'ぴ', 'ふ': 'ぷ', 'へ': 'ぺ', 'ほ': 'ぽ'}
)

// withFirst replaces the first kana of s by its mapped form, "" when it
// has none.
func withFirst(s string, m map[rune]rune) string {
	r := []rune(s)
	if len(r) == 0 {
		return ""
	}
	to, ok := m[r[0]]
	if !ok {
		return ""
	}
	return string(to) + string(r[1:])
}

// ruleReading is number + counter by the counter's sound class.
func ruleReading(c Counter, n string) string {
	num := numbers[n]
	if num.gem != "" && slices.Contains(geminating[c.Sound], n) {
		if c.Sound == "h" {
			return num.gem + withFirst(c.Reading, handakuten)
		}
		return num.gem + c.Reading
	}
	if (n == "3" || n == What) && (c.Sound == "h" || c.Voiced3) {
		return num.full + withFirst(c.Reading, dakuten)
	}
	return num.full + c.Reading
}

func appendNew(list []string, more ...string) []string {
	for _, m := range more {
		if m != "" && !slices.Contains(list, m) {
			list = append(list, m)
		}
	}
	return list
}

// answersOf: the table's readings for the number, or the rule's; a
// じゅっ/にじゅっ form also accepted as じっ/にじっ; then the table's also.
func answersOf(c Counter, n string) []string {
	var out []string
	if r, ok := c.Readings[n]; ok {
		out = appendNew(out, r...)
	} else {
		out = appendNew(out, ruleReading(c, n))
	}
	for _, a := range slices.Clone(out) {
		for _, p := range []string{"にじゅっ", "じゅっ"} {
			if rest, ok := strings.CutPrefix(a, p); ok {
				out = appendNew(out, strings.TrimSuffix(p, "ゅっ")+"っ"+rest)
				break
			}
		}
	}
	return appendNew(out, c.Also[n]...)
}

// mistakesOf: the plain join, the voiced and the p-sound forms, each with
// the number's full and (before k, s, t, h) geminated form, that are not
// answers. A native counter (つ) has none.
func mistakesOf(c Counter, n string, answers []string) []string {
	if c.Sound == "native" {
		return []string{}
	}
	num := numbers[n]
	bases := appendNew(nil, c.Reading, withFirst(c.Reading, dakuten), withFirst(c.Reading, handakuten))
	cands := []string{}
	for _, b := range bases {
		cands = append(cands, num.full+b)
	}
	first := []rune(c.Reading)[0]
	_, voiceable := dakuten[first]
	if num.gem != "" && voiceable {
		cands = append(cands, num.gem+c.Reading)
		if h := withFirst(c.Reading, handakuten); h != "" {
			cands = append(cands, num.gem+h)
		}
	}
	out := []string{}
	for _, m := range cands {
		if !slices.Contains(answers, m) && !slices.Contains(out, m) {
			out = append(out, m)
		}
	}
	return out
}

// Answer is a reading as the drill serves it, with its romaji.
type Answer struct {
	Reading string `json:"reading"`
	Romaji  string `json:"romaji"`
}

// NumberReadings is one item of the readings drill: the prompt (3本, 何本),
// the kanji form (三本), the answers (canonical first) and the common
// mistakes.
type NumberReadings struct {
	Number   string   `json:"number"`
	Prompt   string   `json:"prompt"`
	Written  string   `json:"written"`
	Answers  []Answer `json:"answers"`
	Mistakes []Answer `json:"mistakes"`
}

// CounterReadings is a counter with the readings of every number asked.
type CounterReadings struct {
	ID       string           `json:"id"`
	Written  string           `json:"written"`
	Variants []string         `json:"variants"`
	Reading  string           `json:"reading"`
	Romaji   string           `json:"romaji"`
	Counts   string           `json:"counts"`
	Numbers  []NumberReadings `json:"numbers"`
}

func answers(list []string) []Answer {
	out := make([]Answer, len(list))
	for i, r := range list {
		out[i] = Answer{Reading: r, Romaji: romaji(r)}
	}
	return out
}

func numbersOf(c Counter) []string {
	if len(c.Numbers) > 0 {
		return c.Numbers
	}
	return DefaultNumbers
}

// readingsOf is one number of a counter.
func readingsOf(c Counter, n string) NumberReadings {
	prompt, written := n+c.Written, numbers[n].kanji+c.Written
	if n == What {
		prompt = written
	}
	if f, ok := c.Forms[n]; ok {
		prompt, written = f, f
	}
	a := answersOf(c, n)
	return NumberReadings{Number: n, Prompt: prompt, Written: written, Answers: answers(a), Mistakes: answers(mistakesOf(c, n, a))}
}

// ReadingsOf is the readings of a counter id and a number it asks.
func ReadingsOf(counter, number string) (NumberReadings, bool) {
	c, ok := CounterByID(counter)
	if !ok || !slices.Contains(numbersOf(c), number) {
		return NumberReadings{}, false
	}
	return readingsOf(c, number), true
}

// AllReadings is every counter of the table with every number asked, in
// table order (GET /api/drills/counters, readings.json).
func AllReadings() []CounterReadings {
	out := make([]CounterReadings, 0, len(table.Counters))
	for _, c := range table.Counters {
		cr := CounterReadings{ID: c.ID, Written: c.Written, Variants: append([]string{}, c.Variants...), Reading: c.Reading,
			Romaji: romaji(c.Reading), Counts: c.Counts}
		for _, n := range numbersOf(c) {
			cr.Numbers = append(cr.Numbers, readingsOf(c, n))
		}
		out = append(out, cr)
	}
	return out
}

// romaji is the romaji of a kana reading by the Japanese pack's rule.
func romaji(kana string) string {
	for _, r := range (lang.Ja{}).DeriveReadings([]model.Reading{{Type: "kana", Value: kana}}) {
		if r.Type == "romaji" {
			return r.Value
		}
	}
	return ""
}
