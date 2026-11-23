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
	"io"
	"regexp"
	"slices"
	"strings"
	"sync/atomic"
	"unicode"
	"unicode/utf8"
)

// Format is the newest table format this engine implements; it reads
// every format from 1 up to it. It changes when a rule field, hint, match
// mode or stem predicate is added (2: hints keepWhole, rule chainOnly).
const Format = 2

// Limits of a table (docs/contracts/lemma/README.md, "Limits"): Parse
// rejects a table over any of them, so no table — built in or installed
// from a pack — can make the engine slow or large.
const (
	MaxRules       = 1024 // rules
	MaxClasses     = 64   // word classes
	MaxClassTags   = 256  // tags plus prefixes of one class
	MaxCompounds   = 64   // compounds
	MaxIn          = 64   // classes in one rule's in
	MaxKeepWhole   = 2048 // hints.keepWhole entries
	MaxPOSHints    = 64   // entries of hints.expressionPos and of hints.particlePos
	MaxNameRunes   = 32   // a class name, a tag, a prefix, a part-of-speech hint
	MaxAffixRunes  = 32   // from, to, a compound suffix, a notSuffix or keepWhole entry
	MaxReasonRunes = 64   // a reason; the version
	MaxPredDepth   = 4    // nesting of stem predicates (a predicate alone is 1)
	MaxNotSuffix   = 256  // notSuffix entries of one predicate
	MaxMinRunes    = 64   // minRunes

	MaxPredChildren   = 16   // children of one allOf or anyOf
	MaxTableNotSuffix = 4096 // notSuffix entries of all predicates of a table
	MaxTablePredNodes = 4096 // predicates (every nested one counts) of a table
)

// MaxCandidates bounds one Deinflect call: it stops once it has produced
// this many candidates, keeping the first ones in output order. A table
// whose rules keep matching what earlier rules produced would otherwise
// multiply its candidates at every depth.
const MaxCandidates = 64

// MaxWork bounds the work of one Deinflect call: one unit per (form, rule)
// pair considered and one per predicate leaf evaluated (a minRunes or
// notOnly test, one notSuffix entry). When the budget is spent the call
// stops and returns the candidates produced so far; a predicate cut short
// produces nothing. The order of evaluation is fixed
// (docs/contracts/lemma/README.md, "Bound"), so every engine stops at the
// same place.
const MaxWork = 16384

// workDone counts the work of every Deinflect call (WorkDone).
var workDone atomic.Int64

// WorkDone is the total work units every Deinflect call of this process
// has spent (tests measure whole segmentations with it).
func WorkDone() int64 { return workDone.Load() }

// budget is the work left to one call.
type budget struct {
	used, max int
	out       bool
}

// spend takes one unit; false (and out) when none is left.
func (b *budget) spend() bool {
	if b.used >= b.max {
		b.out = true
		return false
	}
	b.used++
	return true
}

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
// non-empty and accepted by Stem. Its predicate leaves are counted in w,
// the lookup's compound budget (NewWork); a spent budget accepts nothing.
func (c Compound) StemOK(stem string, w *Work) bool {
	if stem == "" {
		return false
	}
	if c.Stem == nil {
		return true
	}
	ok := c.Stem.holds(stem, &w.b)
	return ok && !w.b.out
}

// Work is a work budget shared by several predicate checks: a lookup's
// compound stem checks (lookup.MaxCompoundWork).
type Work struct{ b budget }

// NewWork returns a budget of n units.
func NewWork(n int) *Work { return &Work{b: budget{max: n}} }

// Used is the units spent.
func (w *Work) Used() int { return w.b.used }

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

	// in is In as a set (Parse).
	in map[string]bool
}

// takes reports whether class is in the rule's In.
func (r *Rule) takes(class string) bool { return r.in[class] }

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
// modes, scripts, empty predicates and anything over a limit (MaxRules,
// ...) are errors: a table either runs the same in every engine or not at
// all.
func Parse(data []byte) (*Table, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var t Table
	if err := dec.Decode(&t); err != nil {
		return nil, fmt.Errorf("lemma: %w", err)
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return nil, errors.New("lemma: trailing data after the table")
	}
	if err := noDuplicateKeys(data); err != nil {
		return nil, fmt.Errorf("lemma: %w", err)
	}
	if err := t.validate(); err != nil {
		return nil, fmt.Errorf("lemma: table %q: %w", t.Language, err)
	}
	return &t, nil
}

// noDuplicateKeys reports a key named twice in one object of data (one
// well-formed JSON value; encoding/json keeps the last silently).
func noDuplicateKeys(data []byte) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	type frame struct {
		object bool
		keys   map[string]bool
		key    bool // the next token of an object is a key
	}
	var stack []*frame
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		var top *frame
		if len(stack) > 0 {
			top = stack[len(stack)-1]
		}
		if d, ok := tok.(json.Delim); ok {
			switch d {
			case '{', '[':
				if top != nil && top.object {
					top.key = true // the value of a key is done once it closes
				}
				stack = append(stack, &frame{object: d == '{', keys: map[string]bool{}, key: d == '{'})
			default:
				stack = stack[:len(stack)-1]
			}
			continue
		}
		if top == nil || !top.object {
			continue
		}
		if top.key {
			k := tok.(string)
			if top.keys[k] {
				return fmt.Errorf("duplicate key %q", k)
			}
			top.keys[k] = true
			top.key = false
		} else {
			top.key = true
		}
	}
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
	case !languageCode.MatchString(t.Language):
		return fmt.Errorf("language %q is not a lowercase language code like es or pt-br", t.Language)
	case t.MaxDepth < 1 || t.MaxDepth > 8:
		return fmt.Errorf("maxDepth %d outside 1..8", t.MaxDepth)
	}
	if err := t.checkLimits(); err != nil {
		return err
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
	for i := range t.Rules {
		t.Rules[i].in = map[string]bool{}
		for _, c := range t.Rules[i].In {
			t.Rules[i].in[c] = true
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

func (p Pred) validate() error { return p.validateAt(1) }

func (p Pred) validateAt(depth int) error {
	switch {
	case depth > MaxPredDepth:
		return fmt.Errorf("stem predicate nested deeper than %d", MaxPredDepth)
	case p.MinRunes < 0 || p.MinRunes > MaxMinRunes:
		return fmt.Errorf("stem predicate minRunes %d outside 0..%d", p.MinRunes, MaxMinRunes)
	case len(p.AllOf) > MaxPredChildren || len(p.AnyOf) > MaxPredChildren:
		return fmt.Errorf("stem predicate has more than %d allOf or anyOf children", MaxPredChildren)
	case len(p.NotSuffix) > MaxNotSuffix:
		return fmt.Errorf("stem predicate has %d notSuffix entries, at most %d", len(p.NotSuffix), MaxNotSuffix)
	}
	for _, s := range p.NotSuffix {
		if utf8.RuneCountInString(s) > MaxAffixRunes {
			return fmt.Errorf("stem predicate notSuffix entry longer than %d code points", MaxAffixRunes)
		}
	}
	if p.MinRunes == 0 && p.NotOnly == "" && len(p.NotSuffix) == 0 && len(p.AllOf) == 0 && len(p.AnyOf) == 0 {
		return errors.New("empty stem predicate")
	}
	if p.NotOnly != "" && scripts[p.NotOnly] == nil {
		return fmt.Errorf("unknown script %q", p.NotOnly)
	}
	for _, q := range append(slices.Clone(p.AllOf), p.AnyOf...) {
		if err := q.validateAt(depth + 1); err != nil {
			return err
		}
	}
	return nil
}

// languageCode is the shape of a table's language: lang.ValidCode's
// normalised form (this package cannot import lang).
var languageCode = regexp.MustCompile(`^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$`)

// checkLimits enforces the size limits (MaxRules, ...).
func (t *Table) checkLimits() error {
	longer := func(s string, n int) bool { return utf8.RuneCountInString(s) > n }
	switch {
	case longer(t.Version, MaxReasonRunes):
		return fmt.Errorf("version longer than %d code points", MaxReasonRunes)
	case len(t.Rules) > MaxRules:
		return fmt.Errorf("%d rules, at most %d", len(t.Rules), MaxRules)
	case len(t.Classes) > MaxClasses:
		return fmt.Errorf("%d classes, at most %d", len(t.Classes), MaxClasses)
	case len(t.Compounds) > MaxCompounds:
		return fmt.Errorf("%d compounds, at most %d", len(t.Compounds), MaxCompounds)
	case len(t.Hints.KeepWhole) > MaxKeepWhole:
		return fmt.Errorf("hints: %d keepWhole entries, at most %d", len(t.Hints.KeepWhole), MaxKeepWhole)
	case len(t.Hints.ExpressionPOS) > MaxPOSHints:
		return fmt.Errorf("hints: %d expressionPos entries, at most %d", len(t.Hints.ExpressionPOS), MaxPOSHints)
	case len(t.Hints.ParticlePOS) > MaxPOSHints:
		return fmt.Errorf("hints: %d particlePos entries, at most %d", len(t.Hints.ParticlePOS), MaxPOSHints)
	case longer(t.Hints.ReadingType, MaxNameRunes):
		return fmt.Errorf("hints: readingType longer than %d code points", MaxNameRunes)
	}
	for _, s := range t.Hints.KeepWhole {
		if longer(s, MaxAffixRunes) {
			return fmt.Errorf("hints: keepWhole entry longer than %d code points", MaxAffixRunes)
		}
	}
	for _, s := range append(slices.Clone(t.Hints.ExpressionPOS), t.Hints.ParticlePOS...) {
		if longer(s, MaxNameRunes) {
			return fmt.Errorf("hints: expressionPos or particlePos entry longer than %d code points", MaxNameRunes)
		}
	}
	for name, c := range t.Classes {
		switch {
		case longer(name, MaxNameRunes):
			return fmt.Errorf("class name longer than %d code points", MaxNameRunes)
		case len(c.Tags)+len(c.Prefixes) > MaxClassTags:
			return fmt.Errorf("class %q: %d tags and prefixes, at most %d", name, len(c.Tags)+len(c.Prefixes), MaxClassTags)
		}
		for _, tag := range append(slices.Clone(c.Tags), c.Prefixes...) {
			if longer(tag, MaxNameRunes) {
				return fmt.Errorf("class %q: tag or prefix longer than %d code points", name, MaxNameRunes)
			}
		}
	}
	for _, c := range t.Compounds {
		if longer(c.Suffix, MaxAffixRunes) {
			return fmt.Errorf("compound suffix longer than %d code points", MaxAffixRunes)
		}
	}
	nodes, notSuffix := 0, 0
	var size func(p *Pred)
	size = func(p *Pred) {
		if p == nil {
			return
		}
		nodes++
		notSuffix += len(p.NotSuffix)
		for i := range p.AllOf {
			size(&p.AllOf[i])
		}
		for i := range p.AnyOf {
			size(&p.AnyOf[i])
		}
	}
	for i := range t.Rules {
		size(t.Rules[i].Stem)
	}
	for i := range t.Compounds {
		size(t.Compounds[i].Stem)
	}
	switch {
	case nodes > MaxTablePredNodes:
		return fmt.Errorf("%d predicate nodes, at most %d per table", nodes, MaxTablePredNodes)
	case notSuffix > MaxTableNotSuffix:
		return fmt.Errorf("%d notSuffix entries, at most %d per table", notSuffix, MaxTableNotSuffix)
	}
	for i, r := range t.Rules {
		switch {
		case longer(r.From, MaxAffixRunes):
			return fmt.Errorf("rule %d: from longer than %d code points", i, MaxAffixRunes)
		case longer(r.To, MaxAffixRunes):
			return fmt.Errorf("rule %d: to longer than %d code points", i, MaxAffixRunes)
		case longer(r.Reason, MaxReasonRunes):
			return fmt.Errorf("rule %d: reason longer than %d code points", i, MaxReasonRunes)
		case len(r.In) > MaxIn:
			return fmt.Errorf("rule %d: %d in classes, at most %d", i, len(r.In), MaxIn)
		}
	}
	return nil
}

// holds reports whether stem satisfies p, spending one unit of b per leaf
// test in this order: minRunes, notOnly, each notSuffix entry, then the
// allOf children (stopping at the first false), then the anyOf children
// (stopping at the first true). A spent budget makes it false.
func (p Pred) holds(stem string, b *budget) bool {
	if p.MinRunes > 0 && (!b.spend() || utf8.RuneCountInString(stem) < p.MinRunes) {
		return false
	}
	if p.NotOnly != "" && (!b.spend() || !strings.ContainsFunc(stem, func(r rune) bool { return !scripts[p.NotOnly](r) })) {
		return false
	}
	for _, s := range p.NotSuffix {
		if !b.spend() || strings.HasSuffix(stem, s) {
			return false
		}
	}
	for _, q := range p.AllOf {
		if !q.holds(stem, b) {
			return false
		}
	}
	if len(p.AnyOf) == 0 {
		return true
	}
	for _, q := range p.AnyOf {
		if q.holds(stem, b) {
			return true
		}
		if b.out {
			return false
		}
	}
	return false
}

// Deinflect returns the possible dictionary forms of surface,
// breadth-first: shallowest chain first, then the order of the forms
// they came from, then rule order; never the surface itself, and each
// (form, class) pair once. It stops at MaxCandidates candidates or when
// MaxWork is spent.
func (t *Table) Deinflect(surface string) []Candidate {
	out, _ := t.DeinflectBudget(surface, MaxWork)
	return out
}

// DeinflectBudget is Deinflect with a budget of max work units; it also
// returns the units spent (docs/contracts/lemma/budget.json).
func (t *Table) DeinflectBudget(surface string, max int) ([]Candidate, int) {
	b := budget{max: max}
	out := t.deinflect(surface, &b)
	workDone.Add(int64(b.used))
	return out, b.used
}

func (t *Table) deinflect(surface string, b *budget) []Candidate {
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
				if !b.spend() {
					return out
				}
				if depth > 0 && !r.takes(n.class) || depth == 0 && r.ChainOnly {
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
				if r.Stem != nil && !r.Stem.holds(stem, b) {
					if b.out {
						return out
					}
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
				if len(out) == MaxCandidates {
					return out
				}
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
