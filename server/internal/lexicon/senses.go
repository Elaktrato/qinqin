package lexicon

import (
	"regexp"
	"slices"
	"strings"
	"unicode"
)

// The sense display rule (contract: docs/contracts/senses/display.json;
// the web's lib/entry/senseDisplay.ts implements the same rule). It orders
// an entry's senses for display without changing what is stored: picture
// mappings and JMdict cross-references count stored senses.

// Unit classes, in display order.
const (
	ClassEveryday  = "everyday"
	ClassMinor     = "minor"
	ClassSensitive = "sensitive"
)

// TagReading prefixes a sense tag naming a reading the sense belongs to
// (a CC-CEDICT line's pinyin, a JMdict <stagr>): "reading:hē". A sense
// without one applies to every reading.
const TagReading = "reading:"

// Marks of a sensitive unit, strongest first.
const (
	MarkVulgar     = "vulg"
	MarkDerogatory = "derog"
	MarkSlang      = "sl"
)

// SenseUnit is one display unit of an entry's senses: glosses of the
// stored sense Sense (an index into the senses given) that share a class.
type SenseUnit struct {
	Sense   int
	Class   string
	Mark    string // "" for an everyday unit
	Folded  bool
	Glosses []string
}

// ExplicitWords are the whole words (any case) that mark a gloss vulgar
// where the dictionary left it unmarked (黄色 "vulgar; lewd; pornographic").
var ExplicitWords = []string{
	"fuck", "fucking", "fucked", "fucker", "cunt", "dick", "penis", "vagina", "testicles",
	"prostitute", "prostitutes", "prostitution", "whore", "whores", "slut", "sluts",
	"porn", "porno", "pornographic", "pornography", "lewd", "obscene", "masturbate", "masturbation",
}

// VulgarCharacters mark a gloss vulgar wherever they appear: CC-CEDICT
// points at them from lines it leaves unmarked (草 cào "variant of 肏").
var VulgarCharacters = []string{"肏", "屄", "屌"}

// MinorPrefixes start (ignoring case) the first gloss of a CC-CEDICT line
// that is not an everyday meaning: a surname, abbreviation, variant,
// cross-reference or archaic line (书 "abbr. for 書經", 水 "surname Shui").
var MinorPrefixes = []string{
	"surname ", "japanese surname", "abbr. for", "abbr. of", "short for", "short name for",
	"variant of", "old variant of", "(old) variant of", "archaic variant of", "(archaic) variant of",
	"(old) contracted variant of", "euphemistic variant of", "erhua variant of",
	"see ", "also written", "used in", "(archaic)", "(old)", "(classical)", "old name for",
}

// MinorTags are the JMdict sense tags of a minor sense (abbr is not one:
// 電話's "telephone (device)").
var MinorTags = []string{"arch", "obs", "rare", "dated", "surname"}

// MinorGloss reports whether g starts with one of MinorPrefixes, ignoring
// case.
func MinorGloss(g string) bool {
	for _, p := range MinorPrefixes {
		if len(g) >= len(p) && strings.EqualFold(g[:len(p)], p) {
			return true
		}
	}
	return false
}

// minorSense reports whether s is a minor sense: a minor tag, or a first
// gloss with a minor prefix.
func minorSense(s Sense) bool {
	for _, t := range s.Tags {
		if slices.Contains(MinorTags, t) {
			return true
		}
	}
	return len(s.Glosses) > 0 && MinorGloss(s.Glosses[0])
}

// readingKey is the form a pinned reading and a sense's reading tag
// compare in: lower case, without white space and apostrophes.
func readingKey(r string) string {
	return strings.Map(func(c rune) rune {
		if unicode.IsSpace(c) || c == '\'' || c == '’' {
			return -1
		}
		return unicode.ToLower(c)
	}, r)
}

// ofReading reports whether s belongs to the reading whose key is key: it
// has no reading tag, or one of its reading tags has that key.
func ofReading(s Sense, key string) bool {
	tagged := false
	for _, t := range s.Tags {
		if r, ok := strings.CutPrefix(t, TagReading); ok {
			tagged = true
			if readingKey(r) == key {
				return true
			}
		}
	}
	return !tagged
}

// SenseReadings returns the readings s is tagged with (TagReading), nil
// for a sense of every reading.
func SenseReadings(s Sense) []string {
	var out []string
	for _, t := range s.Tags {
		if r, ok := strings.CutPrefix(t, TagReading); ok {
			out = append(out, r)
		}
	}
	return out
}

var (
	explicitWord = regexp.MustCompile(`(?i)\b(?:` + strings.Join(ExplicitWords, "|") + `)\b`)
	// note is a parenthesised note of a gloss, CC-CEDICT's marker form.
	note       = regexp.MustCompile(`\(([^()]*)\)`)
	noteVulgar = regexp.MustCompile(`(?i)vulgar|expletive`)
	noteDerog  = regexp.MustCompile(`(?i)derog|pejorative|offensive`)
	noteSlang  = regexp.MustCompile(`(?i)slang`)
)

// tagMarks are the JMdict sense tags that mark every gloss of a sense.
var tagMarks = map[string]string{
	"vulg": MarkVulgar, "derog": MarkDerogatory, "sl": MarkSlang, "net-sl": MarkSlang, "m-sl": MarkSlang,
}

// markRank orders marks, the strongest highest; "" is no mark.
func markRank(m string) int {
	switch m {
	case MarkVulgar:
		return 3
	case MarkDerogatory:
		return 2
	case MarkSlang:
		return 1
	}
	return 0
}

func stronger(a, b string) string {
	if markRank(b) > markRank(a) {
		return b
	}
	return a
}

// glossMark is the mark of gloss g of a sense whose tag mark is tagMark.
func glossMark(g, tagMark string) string {
	m := tagMark
	for _, n := range note.FindAllStringSubmatch(g, -1) {
		switch {
		case noteVulgar.MatchString(n[1]):
			m = stronger(m, MarkVulgar)
		case noteDerog.MatchString(n[1]):
			m = stronger(m, MarkDerogatory)
		case noteSlang.MatchString(n[1]):
			m = stronger(m, MarkSlang)
		}
	}
	if explicitWord.MatchString(g) {
		m = MarkVulgar
	}
	for _, c := range VulgarCharacters {
		if strings.Contains(g, c) {
			m = MarkVulgar
		}
	}
	return m
}

// DisplaySenses returns the display units of senses (stored order). With a
// pinned reading, only the senses of that reading count (and those of
// every reading); a pin no sense with glosses has is ignored. Each sense's
// unmarked glosses are an everyday unit (a minor one for a minor sense),
// then its marked glosses a sensitive unit with their strongest mark;
// every everyday unit in sense order, then every minor one, then every
// sensitive one. Sensitive units are folded unless they are all there is.
// Never nil.
func DisplaySenses(senses []Sense, pinned string) []SenseUnit {
	keep := func(Sense) bool { return true }
	if key := readingKey(pinned); key != "" && slices.ContainsFunc(senses, func(s Sense) bool {
		return len(s.Glosses) > 0 && ofReading(s, key)
	}) {
		keep = func(s Sense) bool { return ofReading(s, key) }
	}
	everyday, minor, sensitive := []SenseUnit{}, []SenseUnit{}, []SenseUnit{}
	for i, s := range senses {
		if !keep(s) {
			continue
		}
		tagMark := ""
		for _, t := range s.Tags {
			tagMark = stronger(tagMark, tagMarks[t])
		}
		class := ClassEveryday
		if minorSense(s) {
			class = ClassMinor
		}
		plain := SenseUnit{Sense: i, Class: class}
		marked := SenseUnit{Sense: i, Class: ClassSensitive}
		for _, g := range s.Glosses {
			if m := glossMark(g, tagMark); m != "" {
				marked.Mark = stronger(marked.Mark, m)
				marked.Glosses = append(marked.Glosses, g)
			} else {
				plain.Glosses = append(plain.Glosses, g)
			}
		}
		switch {
		case len(plain.Glosses) == 0:
		case class == ClassMinor:
			minor = append(minor, plain)
		default:
			everyday = append(everyday, plain)
		}
		if len(marked.Glosses) > 0 {
			sensitive = append(sensitive, marked)
		}
	}
	if len(everyday)+len(minor) > 0 {
		for i := range sensitive {
			sensitive[i].Folded = true
		}
	}
	return append(append(everyday, minor...), sensitive...)
}

// DisplayGloss is the one gloss a list shows for senses (pinned as in
// DisplaySenses): the first gloss of the first display unit, "" without
// one.
func DisplayGloss(senses []Sense, pinned string) string {
	if u := DisplaySenses(senses, pinned); len(u) > 0 {
		return u[0].Glosses[0]
	}
	return ""
}
