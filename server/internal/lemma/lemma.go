// Package lemma is the language-neutral lemmatizer engine: it decodes a
// per-language rule table (docs/contracts/lemma/README.md) and
// deinflects a surface form by chained suffix rewrites gated by word
// class. The engine knows no language; every language-specific fact —
// the rules, the word classes and their dictionary part-of-speech tags,
// compound suffixes, ranking hints — is data in the table.
package lemma

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Format is the newest table format this engine implements; it reads
// every format from 1 up to it. It changes when a rule field, hint, match
// mode or stem predicate is added (2: hints keepWhole, rule chainOnly).
const Format = 2

// Match modes of a rule.
const (
	MatchSuffix        = "suffix"          // a suffix leaving a non-empty stem (the default)
	MatchSuffixOrWhole = "suffix-or-whole" // a suffix or the whole surface
	MatchWhole         = "whole"           // only the whole surface
)

// Table is one language's rule table.
type Table struct {
	Format   int    `json:"format"`
	Language string `json:"language"`
	Version  string `json:"version"`
	// MaxDepth bounds how many rules chain on one surface.
	MaxDepth int `json:"maxDepth"`
	// Classes are the word classes rules produce, by name.
	Classes   map[string]Class `json:"classes"`
	Compounds []Compound       `json:"compounds,omitempty"`
	Hints     Hints            `json:"hints"`
	Rules     []Rule           `json:"rules"`
}

// Class is a word class: the dictionary part-of-speech tags that have it,
// exactly (Tags) or by prefix (Prefixes), or every entry (Any: for
// dictionaries without part-of-speech data). A class with none of them
// is an intermediate form (a polite stem, a te-form) no tag matches.
type Class struct {
	Tags     []string `json:"tags,omitempty"`
	Prefixes []string `json:"prefixes,omitempty"`
	Any      bool     `json:"any,omitempty"`
}

// Compound says that a deinflected form of Class ending in Suffix is also
// looked up by its stem (the text before Suffix), whose entry must have
// Class: JMdict tags vs on the noun 勉強, not on 勉強する.
type Compound struct {
	Suffix string `json:"suffix"`
	Class  string `json:"class"`
	// Stem, when set, must accept the stem (すし is not す + し).
	Stem *Pred `json:"stem,omitempty"`
}

// StemOK reports whether stem may be looked up as this compound's stem:
// non-empty and accepted by Stem.
func (c Compound) StemOK(stem string) bool {
	return stem != "" && (c.Stem == nil || c.Stem.holds(stem))
}

// Hints are the dictionary part-of-speech tags the ranking and
// segmentation rules read (docs/contracts/lemma/README.md, "Ranking").
type Hints struct {
	// ExpressionPOS marks a lexicalised expression (JMdict exp).
	ExpressionPOS []string `json:"expressionPos,omitempty"`
	// ParticlePOS marks a particle (JMdict prt).
	ParticlePOS []string `json:"particlePos,omitempty"`
	// ReadingScript: text written only in this script (kana for
	// Japanese) is also looked up by the plain form of the dictionary's
	// readings of type ReadingType. Empty: no reading lookups.
	ReadingScript string `json:"readingScript,omitempty"`
	ReadingType   string `json:"readingType,omitempty"`
	// KeepWhole (format 2) lists expressions the segmentation boundary
	// rule never splits, compared with an entry's written forms and
	// readings.
	KeepWhole []string `json:"keepWhole,omitempty"`
}

// KeepsWhole reports whether any of texts (an entry's forms and
// readings) is in KeepWhole.
func (h Hints) KeepsWhole(texts ...string) bool {
	return slices.ContainsFunc(texts, func(t string) bool { return t != "" && slices.Contains(h.KeepWhole, t) })
}

// InScript reports whether s is non-empty and every code point is in
// the script (one of the engine's script names; unknown: false).
func InScript(script, s string) bool {
	in := scripts[script]
	return in != nil && s != "" && !strings.ContainsFunc(s, func(r rune) bool { return !in(r) })
}

// Rule rewrites the suffix From of a form to To, producing a form of class
// Out. In lists the classes the rewritten form must have when it is the
// product of an earlier rule; a rule with an empty In applies only to
// the surface itself.
type Rule struct {
	From   string   `json:"from"`
	To     string   `json:"to"`
	Reason string   `json:"reason"`
	In     []string `json:"in,omitempty"`
	Out    string   `json:"out"`
	Match  string   `json:"match,omitempty"`
	// Stem, when set, must accept the text the rule leaves before From.
	Stem *Pred `json:"stem,omitempty"`
	// ChainOnly (format 2): the rule never rewrites the surface itself,
	// only a form an earlier rule produced (ないで of ないでください, not
	// the ないで of ないです).
	ChainOnly bool `json:"chainOnly,omitempty"`
}

// Pred is a declarative stem predicate. Every key set must hold.
type Pred struct {
	// MinRunes: the stem has at least this many code points.
	MinRunes int `json:"minRunes,omitempty"`
	// NotOnly: the stem has a code point outside this script.
	NotOnly string `json:"notOnly,omitempty"`
	// NotSuffix: the stem ends in none of these.
	NotSuffix []string `json:"notSuffix,omitempty"`
	AllOf     []Pred   `json:"allOf,omitempty"`
	AnyOf     []Pred   `json:"anyOf,omitempty"`
}

// Candidate is one possible dictionary form of a surface.
type Candidate struct {
	Form string
	// Reasons is the inflection chain in application order: the rule
	// applied to the surface first.
	Reasons []string
	// Class is the word class Form must have (see ClassMatches).
	Class string
}

// scripts are the script names a NotOnly predicate may use.
var scripts = map[string]func(rune) bool{
	"kana":     func(r rune) bool { return r == 'ー' || unicode.In(r, unicode.Hiragana, unicode.Katakana) },
	"hiragana": func(r rune) bool { return unicode.Is(unicode.Hiragana, r) },
	"katakana": func(r rune) bool { return r == 'ー' || unicode.Is(unicode.Katakana, r) },
	"han":      func(r rune) bool { return unicode.Is(unicode.Han, r) },
	"latin":    func(r rune) bool { return unicode.Is(unicode.Latin, r) },
}

// Parse decodes and validates a table. Unknown keys, classes, match
// modes, scripts and empty predicates are errors: a table either runs
// the same in every engine or not at all.
func Parse(data []byte) (*Table, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var t Table
	if err := dec.Decode(&t); err != nil {
		return nil, fmt.Errorf("lemma: %w", err)
	}
	if err := t.validate(); err != nil {
		return nil, fmt.Errorf("lemma: table %q: %w", t.Language, err)
	}
	return &t, nil
}

func (t *Table) validate() error {
	switch {
	case t.Format < 1 || t.Format > Format:
		return fmt.Errorf("format %d, want 1..%d", t.Format, Format)
	case slices.Contains(t.Hints.KeepWhole, ""):
		return errors.New("hints: empty keepWhole entry")
	case t.Format < 2 && (len(t.Hints.KeepWhole) > 0 || slices.ContainsFunc(t.Rules, func(r Rule) bool { return r.ChainOnly })):
		return errors.New("keepWhole and chainOnly need format 2")
	case t.Language == "":
		return errors.New("no language")
	case t.MaxDepth < 1 || t.MaxDepth > 8:
		return fmt.Errorf("maxDepth %d outside 1..8", t.MaxDepth)
	}
	if t.Hints.ReadingScript != "" && (scripts[t.Hints.ReadingScript] == nil || t.Hints.ReadingType == "") {
		return fmt.Errorf("hints: reading script %q needs a known script and a reading type", t.Hints.ReadingScript)
	}
	for name, c := range t.Classes {
		if c.Any && (len(c.Tags) > 0 || len(c.Prefixes) > 0) {
			return fmt.Errorf("class %q: any with tags or prefixes", name)
		}
	}
	for _, c := range t.Compounds {
		if c.Suffix == "" {
			return errors.New("compound without a suffix")
		}
		if _, ok := t.Classes[c.Class]; !ok {
			return fmt.Errorf("compound %q: unknown class %q", c.Suffix, c.Class)
		}
		if c.Stem != nil {
			if err := c.Stem.validate(); err != nil {
				return fmt.Errorf("compound %q: %w", c.Suffix, err)
			}
		}
	}
	for i, r := range t.Rules {
		if r.From == "" || r.Reason == "" {
			return fmt.Errorf("rule %d: empty from or reason", i)
		}
		if _, ok := t.Classes[r.Out]; !ok {
			return fmt.Errorf("rule %d (%s): unknown out class %q", i, r.From, r.Out)
		}
		for _, c := range r.In {
			if _, ok := t.Classes[c]; !ok {
				return fmt.Errorf("rule %d (%s): unknown in class %q", i, r.From, c)
			}
		}
		switch r.Match {
		case "", MatchSuffix, MatchSuffixOrWhole, MatchWhole:
		default:
			return fmt.Errorf("rule %d (%s): unknown match %q", i, r.From, r.Match)
		}
		if r.Stem != nil {
			if err := r.Stem.validate(); err != nil {
				return fmt.Errorf("rule %d (%s): %w", i, r.From, err)
			}
		}
	}
	return nil
}

func (p Pred) validate() error {
	if p.MinRunes == 0 && p.NotOnly == "" && len(p.NotSuffix) == 0 && len(p.AllOf) == 0 && len(p.AnyOf) == 0 {
		return errors.New("empty stem predicate")
	}
	if p.NotOnly != "" && scripts[p.NotOnly] == nil {
		return fmt.Errorf("unknown script %q", p.NotOnly)
	}
	for _, q := range append(slices.Clone(p.AllOf), p.AnyOf...) {
		if err := q.validate(); err != nil {
			return err
		}
	}
	return nil
}

// holds reports whether stem satisfies p.
func (p Pred) holds(stem string) bool {
	if p.MinRunes > 0 && utf8.RuneCountInString(stem) < p.MinRunes {
		return false
	}
	if p.NotOnly != "" && !strings.ContainsFunc(stem, func(r rune) bool { return !scripts[p.NotOnly](r) }) {
		return false
	}
	for _, s := range p.NotSuffix {
		if strings.HasSuffix(stem, s) {
			return false
		}
	}
	for _, q := range p.AllOf {
		if !q.holds(stem) {
			return false
		}
	}
	return len(p.AnyOf) == 0 || slices.ContainsFunc(p.AnyOf, func(q Pred) bool { return q.holds(stem) })
}

// Deinflect returns the possible dictionary forms of surface,
// breadth-first: shallowest chain first, then the order of the forms
// they came from, then rule order; never the surface itself, and each
// (form, class) pair once.
func (t *Table) Deinflect(surface string) []Candidate {
	type key struct{ form, class string }
	type node struct {
		key
		reasons []string
	}
	seen := map[key]bool{}
	var out []Candidate
	level := []node{{key: key{form: surface}}}
	for depth := 0; depth < t.MaxDepth && len(level) > 0; depth++ {
		var next []node
		for _, n := range level {
			for i := range t.Rules {
				r := &t.Rules[i]
				if depth > 0 && !slices.Contains(r.In, n.class) || depth == 0 && r.ChainOnly {
					continue
				}
				if !strings.HasSuffix(n.form, r.From) {
					continue
				}
				whole := len(n.form) == len(r.From)
				switch r.Match {
				case MatchWhole:
					if !whole {
						continue
					}
				case MatchSuffixOrWhole:
				default:
					if whole {
						continue
					}
				}
				stem := n.form[:len(n.form)-len(r.From)]
				if r.Stem != nil && !r.Stem.holds(stem) {
					continue
				}
				k := key{stem + r.To, r.Out}
				if k.form == surface || seen[k] {
					continue
				}
				seen[k] = true
				reasons := append(slices.Clone(n.reasons), r.Reason)
				next = append(next, node{k, reasons})
				out = append(out, Candidate{Form: k.form, Reasons: reasons, Class: k.class})
			}
		}
		level = next
	}
	return out
}

// ClassMatches reports whether any of the part-of-speech tags pos (one
// sense's) belongs to class. Unknown and intermediate classes match
// nothing.
func (t *Table) ClassMatches(class string, pos []string) bool {
	c, ok := t.Classes[class]
	if !ok {
		return false
	}
	if c.Any {
		return true
	}
	for _, p := range pos {
		if slices.Contains(c.Tags, p) || slices.ContainsFunc(c.Prefixes, func(pre string) bool { return strings.HasPrefix(p, pre) }) {
			return true
		}
	}
	return false
}
