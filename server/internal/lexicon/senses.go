package lexicon

import (
	"regexp"
	"strings"
)

// The sense display rule (contract: docs/contracts/senses/display.json;
// the web's lib/entry/senseDisplay.ts implements the same rule). It orders
// an entry's senses for display without changing what is stored: picture
// mappings and JMdict cross-references count stored senses.

// Unit classes.
const (
	ClassEveryday  = "everyday"
	ClassSensitive = "sensitive"
)

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

// DisplaySenses returns the display units of senses (stored order): each
// sense's unmarked glosses as an everyday unit, then its marked glosses as a
// sensitive unit with their strongest mark; every everyday unit in sense
// order, then every sensitive one. Sensitive units are folded unless there
// is no everyday unit. Never nil.
func DisplaySenses(senses []Sense) []SenseUnit {
	everyday, sensitive := []SenseUnit{}, []SenseUnit{}
	for i, s := range senses {
		tagMark := ""
		for _, t := range s.Tags {
			tagMark = stronger(tagMark, tagMarks[t])
		}
		plain := SenseUnit{Sense: i, Class: ClassEveryday}
		marked := SenseUnit{Sense: i, Class: ClassSensitive}
		for _, g := range s.Glosses {
			if m := glossMark(g, tagMark); m != "" {
				marked.Mark = stronger(marked.Mark, m)
				marked.Glosses = append(marked.Glosses, g)
			} else {
				plain.Glosses = append(plain.Glosses, g)
			}
		}
		if len(plain.Glosses) > 0 {
			everyday = append(everyday, plain)
		}
		if len(marked.Glosses) > 0 {
			sensitive = append(sensitive, marked)
		}
	}
	if len(everyday) > 0 {
		for i := range sensitive {
			sensitive[i].Folded = true
		}
	}
	return append(everyday, sensitive...)
}

// DisplayGloss is the one gloss a list shows for senses: the first gloss
// of the first display unit, "" without one.
func DisplayGloss(senses []Sense) string {
	if u := DisplaySenses(senses); len(u) > 0 {
		return u[0].Glosses[0]
	}
	return ""
}
