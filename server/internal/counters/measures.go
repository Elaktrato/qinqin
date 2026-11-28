package counters

import (
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

// FallbackMeasure is 个, the general measure word.
var FallbackMeasure = ChineseMeasure{Simplified: "个", Traditional: "個", Pinyin: "gè"}

// FallbackAfter are the measure words (simplified) of single, countable
// things: a noun whose first measure word is one of them takes 个 as an
// acceptable but not idiomatic answer (measures.json). Containers, pairs,
// portions and kinds are not among them (一个水, 一个鞋 are wrong).
var FallbackAfter = []string{"只", "条", "张", "件", "辆", "台", "把", "位", "名", "颗", "棵", "座", "家", "所", "间", "头", "匹", "枝", "支", "部", "架", "顶", "门", "首", "道", "根", "块"}

// FallbackNot are nouns (simplified) for which 个 is not acceptable even
// after one of FallbackAfter (纸: 一个纸 is wrong).
var FallbackNot = []string{"纸"}

// ChinesePool are the common measure words wrong choices are taken from.
var ChinesePool = []ChineseMeasure{
	{"个", "個", "gè"}, {"本", "本", "běn"}, {"张", "張", "zhāng"}, {"只", "隻", "zhī"}, {"条", "條", "tiáo"},
	{"件", "件", "jiàn"}, {"辆", "輛", "liàng"}, {"台", "臺", "tái"}, {"把", "把", "bǎ"}, {"位", "位", "wèi"},
	{"杯", "杯", "bēi"}, {"瓶", "瓶", "píng"}, {"双", "雙", "shuāng"}, {"块", "塊", "kuài"}, {"支", "支", "zhī"},
	{"棵", "棵", "kē"}, {"座", "座", "zuò"}, {"家", "家", "jiā"}, {"头", "頭", "tóu"}, {"匹", "匹", "pǐ"},
	{"封", "封", "fēng"}, {"片", "片", "piàn"}, {"篇", "篇", "piān"}, {"首", "首", "shǒu"}, {"部", "部", "bù"},
	{"间", "間", "jiān"}, {"套", "套", "tào"}, {"碗", "碗", "wǎn"}, {"颗", "顆", "kē"}, {"朵", "朵", "duǒ"},
	{"门", "門", "mén"}, {"份", "份", "fèn"}, {"所", "所", "suǒ"}, {"架", "架", "jià"}, {"顶", "頂", "dǐng"},
	{"根", "根", "gēn"}, {"副", "副", "fù"}, {"节", "節", "jié"}, {"道", "道", "dào"}, {"场", "場", "chǎng"},
	{"口", "口", "kǒu"}, {"层", "層", "céng"}, {"面", "面", "miàn"}, {"枝", "枝", "zhī"},
}

// clNote matches a CL note: a gloss "CL:…" or a note "(CL:…)" in a gloss.
var clNote = regexp.MustCompile(`(?:^|\()CL:([^()]*)`)

// clItem is one measure word of a note: 個|个[ge4] or 本[ben3].
var clItem = regexp.MustCompile(`^([^\[\]|,]+)(?:\|([^\[\]|,]+))?\[([^\[\]]+)\]$`)

// noteIn strips a CL note from a gloss: "cat (CL:隻|只[zhi1])" → "cat",
// "CL:本[ben3]" → "".
var noteIn = regexp.MustCompile(`\s*\(CL:[^()]*\)|^CL:.*$`)

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

// ShownGloss is the one gloss the drill shows for an entry: the sense
// display rule's (lexicon.DisplayGloss) after the CL notes are taken out,
// which would give the answer away.
func ShownGloss(senses []lexicon.Sense) string {
	stripped := make([]lexicon.Sense, len(senses))
	for i, s := range senses {
		var keep []string
		for _, g := range s.Glosses {
			if g = strings.TrimSpace(noteIn.ReplaceAllString(g, "")); g != "" {
				keep = append(keep, g)
			}
		}
		s.Glosses = keep
		stripped[i] = s
	}
	return lexicon.DisplayGloss(stripped, "")
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
