package counters

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"qinqin/internal/lexicon"
	"qinqin/internal/pinyin"
)

// ChineseMeasure is one measure word from a CC-CEDICT CL note: its
// simplified and traditional forms (the same when they are) and its
// tone-marked pinyin.
type ChineseMeasure struct {
	Simplified  string
	Traditional string
	Pinyin      string
}

//go:embed table/measures-zh.json
var correctionsJSON []byte

var zhCorrections = mustCorrections()

func mustCorrections() corrections {
	var c corrections
	dec := json.NewDecoder(bytes.NewReader(correctionsJSON))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&c); err != nil {
		panic(fmt.Sprintf("counters: table/measures-zh.json: %v", err))
	}
	return c
}

// FallbackMeasure is 个, the general measure word.
var FallbackMeasure = ChineseMeasure{Simplified: "个", Traditional: "個", Pinyin: "gè"}

// FallbackAfter are the measure words (simplified) of single, countable
// things: a noun whose first measure word is one of them takes 个 as an
// acceptable but not idiomatic answer (measures.json). Containers, pairs,
// portions, long things (条, 根: 一个路, 一个烟) and animals (匹, 头) are not
// among them.
var FallbackAfter = []string{"只", "张", "件", "辆", "台", "把", "位", "名", "颗", "棵", "座", "家", "所", "间", "枝", "支", "部", "架", "顶", "门", "首", "道", "扇", "盏", "项", "处"}

// FallbackNot are nouns (simplified) for which 个 is not acceptable even
// after one of FallbackAfter (纸: 一个纸, 衣服: 一个衣服 are wrong).
var FallbackNot = []string{"纸", "课", "衣服", "雨衣", "衬衫", "毛衣", "外套", "大衣", "票", "机票", "车票", "门票", "邮票", "照片", "脸", "光"}

// AsPeople: when a noun's first measure word is one of these (people), 个
// is fully right too (一个老师).
var AsPeople = []string{"位", "名"}

// Equivalents are measure words that are one word: each is right when the
// other is (一支花, 一枝花).
var Equivalents = [][]string{{"支", "枝"}}

// AltPinyin are other accepted readings of a measure word (场 cháng and
// chǎng; 个 toneless as in 一个; 匹 pī in Taiwan).
var AltPinyin = map[string][]string{"场": {"cháng", "chǎng"}, "个": {"ge"}, "匹": {"pī"}}

// Containers and ContainerAvoid: when a noun's measure words hold a
// container word, the ContainerAvoid words are never wrong choices (一瓶药,
// 一片药, 一颗药 are all right).
var (
	Containers     = []string{"杯", "瓶", "碗", "壶", "盒", "盘", "份"}
	ContainerAvoid = []string{"杯", "瓶", "碗", "壶", "盒", "盘", "份", "片", "块", "颗", "口"}
)

// ChinesePool are the common measure words wrong choices are taken from
// (not 个: it is right for too many nouns).
var ChinesePool = []ChineseMeasure{
	{"本", "本", "běn"}, {"张", "張", "zhāng"}, {"只", "隻", "zhī"}, {"条", "條", "tiáo"},
	{"件", "件", "jiàn"}, {"辆", "輛", "liàng"}, {"台", "臺", "tái"}, {"把", "把", "bǎ"}, {"位", "位", "wèi"},
	{"杯", "杯", "bēi"}, {"瓶", "瓶", "píng"}, {"双", "雙", "shuāng"}, {"块", "塊", "kuài"}, {"支", "支", "zhī"},
	{"棵", "棵", "kē"}, {"座", "座", "zuò"}, {"家", "家", "jiā"}, {"头", "頭", "tóu"}, {"匹", "匹", "pǐ"},
	{"封", "封", "fēng"}, {"片", "片", "piàn"}, {"篇", "篇", "piān"}, {"首", "首", "shǒu"}, {"部", "部", "bù"},
	{"间", "間", "jiān"}, {"套", "套", "tào"}, {"碗", "碗", "wǎn"}, {"颗", "顆", "kē"}, {"朵", "朵", "duǒ"},
	{"门", "門", "mén"}, {"份", "份", "fèn"}, {"所", "所", "suǒ"}, {"架", "架", "jià"}, {"顶", "頂", "dǐng"},
	{"根", "根", "gēn"}, {"副", "副", "fù"}, {"节", "節", "jié"}, {"道", "道", "dào"}, {"场", "場", "chǎng"},
	{"层", "層", "céng"}, {"面", "面", "miàn"}, {"扇", "扇", "shàn"}, {"盏", "盞", "zhǎn"}, {"幅", "幅", "fú"},
	{"顿", "頓", "dùn"}, {"次", "次", "cì"},
}

// clNote matches a CL note: a gloss "CL:…" or a note "(CL:…)" in a gloss.
var clNote = regexp.MustCompile(`(?:^|\()CL:([^()]*)`)

// clItem is one measure word of a note: 個|个[ge4] or 本[ben3].
var clItem = regexp.MustCompile(`^([^\[\]|,]+)(?:\|([^\[\]|,]+))?\[([^\[\]]+)\]$`)

// noteIn strips a CL note from a gloss: "cat (CL:隻|只[zhi1])" → "cat",
// "CL:本[ben3]" → "".
var noteIn = regexp.MustCompile(`\s*\(CL:[^()]*\)|^CL:.*$`)

// markup strips what a question does not need from a shown gloss:
// CC-CEDICT cross-references ("(abbr. for 超級市場|超级市场[chao1 …])") and
// the register notes "(coll.)", "(informal)", "(loanword)".
var markup = regexp.MustCompile(`\s*\([^()]*\[[^\]]*\][^()]*\)|\s*\((?:coll\.|informal|loanword)\)\s*`)

// MeasuresOf are the measure words of an entry's senses: the CL notes of
// every sense that is not minor, in order, each measure word once.
// Malformed items of a note are skipped.
func MeasuresOf(senses []lexicon.Sense) []ChineseMeasure {
	out := []ChineseMeasure{}
	for _, s := range senses {
		if lexicon.MinorSense(s) {
			continue
		}
		for _, g := range s.Glosses {
			for _, m := range clNote.FindAllStringSubmatch(g, -1) {
				for item := range strings.SplitSeq(m[1], ",") {
					cm, ok := parseItem(strings.TrimSpace(item))
					if ok && !slices.ContainsFunc(out, func(o ChineseMeasure) bool { return o.Simplified == cm.Simplified }) {
						out = append(out, cm)
					}
				}
			}
		}
	}
	return out
}

func parseItem(item string) (ChineseMeasure, bool) {
	m := clItem.FindStringSubmatch(item)
	if m == nil {
		return ChineseMeasure{}, false
	}
	trad, simp := m[1], m[2]
	if simp == "" {
		simp = trad
	}
	marked, err := pinyin.ToMarked(m[3])
	if err != nil {
		return ChineseMeasure{}, false
	}
	return ChineseMeasure{Simplified: simp, Traditional: trad, Pinyin: marked}, true
}

// ShownGloss is the one gloss the drill shows for an entry, by the sense
// display rule (lexicon.DisplayGloss, marks and minor senses included) over
// the glosses the measure words belong to: in each sense with a CL note,
// the glosses before the note (CC-CEDICT writes the note after the
// meanings it counts), nouns before verbs ("to …"), the note itself taken
// out (it would give the answer away). Without such a gloss, the rule over
// every gloss without its notes.
func ShownGloss(senses []lexicon.Sense) string {
	counted := make([]lexicon.Sense, 0, len(senses))
	all := make([]lexicon.Sense, len(senses))
	for i, s := range senses {
		var before, nouns, verbs, keep []string
		noted := false
		for _, g := range s.Glosses {
			hasNote := clNote.MatchString(g)
			g = strings.TrimSpace(noteIn.ReplaceAllString(g, ""))
			if g != "" {
				keep = append(keep, g)
				if !noted {
					before = append(before, g)
				}
			}
			if hasNote && !noted {
				noted = true
			}
		}
		all[i] = s
		all[i].Glosses = keep
		if !noted || len(before) == 0 || lexicon.MinorSense(s) {
			continue
		}
		for _, g := range before {
			if isVerbGloss(g) {
				verbs = append(verbs, g)
			} else {
				nouns = append(nouns, g)
			}
		}
		c := s
		c.Glosses = append(nouns, verbs...)
		counted = append(counted, c)
	}
	g := lexicon.DisplayGloss(counted, "")
	if g == "" {
		g = lexicon.DisplayGloss(all, "")
	}
	if clean := strings.TrimSpace(markup.ReplaceAllString(g, " ")); clean != "" {
		return clean
	}
	return g
}

// leadingNotes are parenthesised notes at the start of a gloss.
var leadingNotes = regexp.MustCompile(`^(?:\([^()]*\)\s*)+`)

// isVerbGloss: a gloss that reads "to …" after its leading notes.
func isVerbGloss(g string) bool {
	return strings.HasPrefix(leadingNotes.ReplaceAllString(g, ""), "to ")
}

// HasFallback reports whether 个 is acceptable but not idiomatic for the
// noun written (simplified) with these measure words: 个 is not among them,
// the first is one of FallbackAfter and the noun is not in FallbackNot.
func HasFallback(written string, measures []ChineseMeasure) bool {
	if len(measures) == 0 || slices.Contains(FallbackNot, written) {
		return false
	}
	if slices.ContainsFunc(measures, func(m ChineseMeasure) bool { return m.Simplified == FallbackMeasure.Simplified }) {
		return false
	}
	return slices.Contains(FallbackAfter, measures[0].Simplified)
}

// corrections is the project's correction table of the derived measure
// words (table/measures-zh.json).
type correction struct {
	Measures string `json:"measures,omitempty"`
	Add      string `json:"add,omitempty"`
	Gloss    string `json:"gloss,omitempty"`
}

type corrections struct {
	Version       int                   `json:"version"`
	ID            string                `json:"id"`
	Language      string                `json:"language"`
	Name          string                `json:"name"`
	License       string                `json:"license"`
	Attribution   string                `json:"attribution"`
	HumanReviewed bool                  `json:"humanReviewed"`
	Exclude       []string              `json:"exclude"`
	Nouns         map[string]correction `json:"nouns"`
}

// parseNote reads the measure words of a note written as CC-CEDICT writes
// one (個|个[ge4],位[wei4]).
func parseNote(note string) []ChineseMeasure {
	var out []ChineseMeasure
	for item := range strings.SplitSeq(note, ",") {
		if m, ok := parseItem(strings.TrimSpace(item)); ok {
			out = appendMeasure(out, m)
		}
	}
	return out
}

func appendMeasure(list []ChineseMeasure, m ChineseMeasure) []ChineseMeasure {
	if slices.ContainsFunc(list, func(o ChineseMeasure) bool { return o.Simplified == m.Simplified }) {
		return list
	}
	return append(list, m)
}

func hasMeasure(list []ChineseMeasure, simplified string) bool {
	return slices.ContainsFunc(list, func(m ChineseMeasure) bool { return m.Simplified == simplified })
}

// ChineseNoun is a Chinese noun as the drill asks it: the derived measure
// words (MeasuresOf) through the corrections (a noun left out, a list
// replaced or extended), 个 added after a people word (AsPeople), each
// equivalent added after its twin, the gloss shown (a corrected one, else
// ShownGloss) and the 个 fallback. ok is false when the noun is not drilled.
func ChineseNoun(written string, senses []lexicon.Sense) (measures []ChineseMeasure, gloss string, fallback, ok bool) {
	if slices.Contains(zhCorrections.Exclude, written) {
		return nil, "", false, false
	}
	fix := zhCorrections.Nouns[written]
	measures = MeasuresOf(senses)
	if fix.Measures != "" {
		measures = parseNote(fix.Measures)
	}
	for _, m := range parseNote(fix.Add) {
		measures = appendMeasure(measures, m)
	}
	if len(measures) == 0 {
		return nil, "", false, false
	}
	if slices.Contains(AsPeople, measures[0].Simplified) {
		measures = appendMeasure(measures, FallbackMeasure)
	}
	for _, eq := range Equivalents {
		i := slices.IndexFunc(measures, func(m ChineseMeasure) bool { return slices.Contains(eq, m.Simplified) })
		if i < 0 {
			continue
		}
		for _, w := range eq {
			// The equivalents are written alike in both scripts and read alike.
			measures = appendMeasure(measures, ChineseMeasure{Simplified: w, Traditional: w, Pinyin: measures[i].Pinyin})
		}
	}
	gloss = fix.Gloss
	if gloss == "" {
		gloss = ShownGloss(senses)
	}
	return measures, gloss, HasFallback(written, measures), true
}
