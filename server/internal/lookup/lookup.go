// Package lookup resolves the text at a cursor to a ranked list of
// dictionary entries, the way Yomitan does: every prefix of the text
// from the cursor (and, for a language with a lemmatizer rule table, every part-of-speech-checked
// deinflection of it) is looked up, each matching entry is kept once
// with its best match, and the entries are ordered by the sort chain in
// rank.go. Offsets are Unicode code points.
package lookup

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"slices"
	"strings"
	"unicode"

	"qinqin/internal/freq"
	"qinqin/internal/lang"
	"qinqin/internal/lemma"
	"qinqin/internal/lexicon"
)

const (
	// MaxWindowRunes is the longest source text, in code points, a
	// lookup tries to match. The web client sends and caches exactly
	// this window: keep LOOKUP_WINDOW in apps/web/src/lib/api/lookup.ts
	// equal to it.
	MaxWindowRunes = 12
	// MaxEntries caps the results of one lookup, after ranking.
	MaxEntries = 30
	// MaxWindowWork is the Deinflect work (lemma.MaxWork units) all
	// prefixes of one window share: each prefix's call gets what is left,
	// at most lemma.MaxWork (docs/contracts/lemma/README.md, Lookup bounds).
	MaxWindowWork = 8192
	// MaxCompoundWork is the predicate work the compound stem checks of one
	// window share (lemma.Compound.StemOK).
	MaxCompoundWork = 4096
	// MaxProbes caps the probes of one window; later probes are dropped.
	MaxProbes = 128
	// ProbeCost is what each probe beyond a prefix itself (a deinflected
	// form, a compound stem) costs the request budget: the dictionary query
	// it adds.
	ProbeCost = 16
	// MaxRequestWork is the work (Deinflect and compound units) all windows
	// of one segmentation request share (Budget): once it is spent, the rest
	// of the text is matched exactly, without deinflection.
	MaxRequestWork = 16_000_000
)

// Budget is the work left to one request (MaxRequestWork); windows draw on
// it in text order. The zero value is spent; nil in Lang means unlimited
// (a single lookup has its window budgets only).
type Budget struct{ left int }

// NewBudget returns a request budget of n units.
func NewBudget(n int) *Budget { return &Budget{left: n} }

// Left is the units not yet spent.
func (b *Budget) Left() int { return b.left }

// tagUsuallyKana marks an entry JMdict says is usually written in kana.
const tagUsuallyKana = "usually kana"

// tagUK is JMdict's sense tag "usually written in kana alone".
const tagUK = "uk"

// flagTrad marks a CC-CEDICT traditional form.
const flagTrad = "trad"

// Entry kinds.
const (
	kindWord      = "word"
	kindCharacter = "character"
)

// Frequency is one frequency pack's rank for an entry: the best rank
// among the entry's terms in that pack.
type Frequency struct {
	PackID   int64
	PackName string
	Rank     int
	Display  string
}

// SenseOut is one sense of a result, with the name of its dictionary.
type SenseOut struct {
	DictionaryID              int64
	DictionaryName            string
	POS, Tags, Glosses, Xrefs []string
}

// Result is one ranked entry.
type Result struct {
	EntryID int64
	// Kind is word or character. Term is the headword shown: for a
	// Japanese form match the written form that MATCHED (解る, not
	// 分かる); otherwise (a reading match, or Chinese) the entry's
	// headword — its first form, or its first reading for an entry
	// without forms (a kana-only word). Reading is the reading that
	// matched, else the first one.
	Kind, Term, Reading string
	Forms               []lexicon.Form
	Readings            []lexicon.Reading
	// Matched is the source text the entry matched, at code-point offsets
	// [Start, End) of the request text.
	Matched    string
	Start, End int
	// Reasons is the inflection chain in application order; empty when
	// the match is exact.
	Reasons []string
	// Tags are entry-level tags such as "usually kana" (its first sense is uk).
	Tags []string
	// Frequencies holds one value per frequency pack with data for the
	// entry, in pack priority order.
	Frequencies []Frequency
	// Senses are the entry's senses as stored: grouped by dictionary.
	Senses []SenseOut
	// Levels holds the entry's lowest level in each installed levels
	// scheme, in scheme order; empty (not nil) when Service.WithLevels is
	// set and the entry is in no scheme, nil when levels were not asked for.
	Levels []Level
	Pri    int
	// Lemma is the dictionary form of Matched: the deinflected form for
	// an inflected match (する for した, 電話する for 電話した), Matched
	// itself for an exact one. Not part of the lookup wire format; the
	// tokenizer reports it.
	Lemma string
	// ViaReading is true when the entry matched by one of its readings
	// rather than by a written form. Not part of the lookup wire format.
	ViaReading bool
	// Stem is the compound stem the entry matched (勉強 for 勉強した,
	// lemma 勉強する); empty otherwise. Not part of the lookup wire format.
	Stem string
	// WeakReading is the kana fit key's weak match (see rank.go): matched
	// through a reading not as written, or of a word usually written in
	// kanji. Not part of the lookup wire format.
	WeakReading bool
}

// Service looks text up in the lexicon and ranks it with the frequency
// packs. DB is the database both stores read, used for dictionary names.
type Service struct {
	Lexicon lexicon.Store
	Freq    freq.Store
	DB      *sql.DB
	// WithLevels adds each result's levels (one batched query). The
	// lookup route sets it; the segmenter, which looks up every token,
	// does not need them.
	WithLevels bool
}

// probe is one dictionary-side text tried for a prefix of the source.
type probe struct {
	term    string   // text looked up: the prefix, a deinflected form or a する-compound stem
	form    string   // dictionary form of the prefix: the prefix or the deinflected form
	length  int      // code points of source text it accounts for
	reasons []string // inflection chain; nil when exact
	class   string   // word class an entry must have (lemma.Table.ClassMatches); "" = any
	// compound: the probe is a compound's stem (term is the stem of form).
	compound bool
}

// compoundKey is a compound stem probe of one prefix length.
type compoundKey struct {
	stem, class string
	length      int
}

// Lang is a language with the code pack and the rule table in effect,
// taken once: one request reads one table even when the tables are
// reloaded meanwhile (a lemma-rules install).
type Lang struct {
	Code  string
	Pack  lang.Pack
	Rules *lemma.Table // nil: no deinflection
	// Budget, when set, is the request's shared work budget.
	Budget *Budget
}

// LangOf takes the pack and rule table of language now.
func LangOf(language string) Lang {
	l := Lang{Code: language, Pack: lang.For(language)}
	if d, ok := l.Pack.(lang.Deinflector); ok {
		l.Rules = d.Rules()
	}
	return l
}

// match is an entry's best probe.
type match struct {
	entry   lexicon.Entry
	probe   probe
	reading int // index of the reading that matched, -1 for a form match
}

// Lookup returns the entries matching text at the code-point offset,
// best first by the sort chain (see compareCandidates), at most
// MaxEntries, one result per entry. kinds limits the entry kinds (word,
// character); empty means both. An offset outside the text, or one not
// at a letter (Latin letters excluded for zh and ja), finds nothing.
//
// Candidates are the prefixes of 1..MaxWindowRunes code points from the
// offset, looked up by written form (CC-CEDICT stores simplified and
// traditional forms, so either script matches) and, when the
// language's rule table names a reading script (Japanese: kana), text
// written only in it also by the plain form of a word's readings. For a
// language with a lemmatizer rule table (lang.Deinflector) prefixes also
// yield their deinflections, kept only when a sense of the entry has the
// deinflection's word class. A compound of the table (勉強した → 勉強する)
// is also looked up by its stem (勉強), accepted when the stem has the
// compound's class (JMdict tags vs on the noun). Each category is one
// batched store call, whatever the window length. An entry whose senses
// all belonged to uninstalled dictionaries is not a result.
func (s Service) Lookup(ctx context.Context, language, text string, offset int, kinds []string) ([]Result, error) {
	return s.LookupIn(ctx, LangOf(language), text, offset, kinds)
}

// LookupIn is Lookup with the language's pack and table taken already.
func (s Service) LookupIn(ctx context.Context, l Lang, text string, offset int, kinds []string) ([]Result, error) {
	language := l.Code
	runes := []rune(text)
	if offset < 0 || offset >= len(runes) || !wordStart(language, runes[offset]) {
		return []Result{}, nil
	}
	window := runes[offset:min(offset+MaxWindowRunes, len(runes))]
	pack, rules := l.Pack, l.Rules
	limit := MaxWindowWork + MaxCompoundWork
	if l.Budget != nil {
		limit = l.Budget.left
	}
	probes, work := buildProbes(rules, window, limit)
	if l.Budget != nil {
		l.Budget.left = max(0, l.Budget.left-work)
	}
	var hints lemma.Hints
	if rules != nil {
		hints = rules.Hints
	}

	var forms, plains []string
	seenForm, seenPlain := map[string]bool{}, map[string]bool{}
	for _, p := range probes {
		if !seenForm[p.term] {
			seenForm[p.term] = true
			forms = append(forms, p.term)
		}
		if pl, ok := readingPlain(pack, hints, p.term); ok && !seenPlain[pl] {
			seenPlain[pl] = true
			plains = append(plains, pl)
		}
	}
	byForm, err := s.Lexicon.ByForm(ctx, language, forms)
	if err != nil {
		return nil, fmt.Errorf("lookup: %w", err)
	}
	// Reading hits are words only: a character entry is found by its
	// character, as its on and kun readings would make any kana text hit
	// kanji. ByReadingKind never loads those entries.
	var byReading map[string][]lexicon.Entry
	if len(plains) > 0 && (len(kinds) == 0 || slices.Contains(kinds, kindWord)) {
		if byReading, err = s.Lexicon.ByReadingKind(ctx, language, kindWord, plains); err != nil {
			return nil, fmt.Errorf("lookup: %w", err)
		}
	}

	// Keep each entry's best match: longest source text, then shortest
	// chain; on a tie the first one found (probes run shortest prefix
	// first, form hits before reading hits) stays.
	best := map[int64]*match{}
	var order []int64
	consider := func(e lexicon.Entry, p probe, reading int) {
		if len(kinds) > 0 && !slices.Contains(kinds, e.Kind) || !hasClass(rules, e, p.class) {
			return
		}
		cur := best[e.ID]
		if cur == nil {
			order = append(order, e.ID)
		} else if p.length < cur.probe.length || p.length == cur.probe.length && len(p.reasons) >= len(cur.probe.reasons) {
			return
		}
		best[e.ID] = &match{entry: e, probe: p, reading: reading}
	}
	for _, p := range probes {
		for _, e := range byForm[p.term] {
			consider(e, p, -1)
		}
		pl, ok := readingPlain(pack, hints, p.term)
		if !ok {
			continue
		}
		for _, e := range byReading[pl] {
			consider(e, p, slices.IndexFunc(e.Readings, func(r lexicon.Reading) bool { return r.Plain == pl }))
		}
	}
	if order, err = s.dropRetired(ctx, order, best); err != nil {
		return nil, err
	}
	if len(order) == 0 {
		return []Result{}, nil
	}

	matches := make([]*match, len(order))
	entries := make([]lexicon.Entry, len(order))
	for i, id := range order {
		matches[i], entries[i] = best[id], best[id].entry
	}
	freqs, packIDs := s.frequencies(ctx, language, entries)
	ranks := rankingRanks(packIDs, freqs)

	cands := make([]candidate, len(matches))
	expression := make([]bool, len(matches))
	for i, m := range matches {
		cands[i] = rankKeys(pack, hints, language, m)
		cands[i].freqRank = ranks[i]
		cands[i].at = i
		expression[i] = len(m.entry.Forms) == 0 && allSensesTagged(m.entry, hints.ExpressionPOS)
		cands[i].expressionSense = anySenseTagged(m.entry, hints.ExpressionPOS)
	}
	markYields(cands, expression)
	sortCandidates(cands)
	cands = cands[:min(len(cands), MaxEntries)]

	names, err := s.dictionaryNames(ctx, cands, matches)
	if err != nil {
		return nil, err
	}
	out := make([]Result, len(cands))
	for i, c := range cands {
		out[i] = result(language, matches[c.at], freqs[c.at], names, window, offset)
	}
	if s.WithLevels {
		ids := make([]int64, len(out))
		for i, r := range out {
			ids[i] = r.EntryID
		}
		lv, err := s.levels(ctx, ids)
		if err != nil {
			return nil, err
		}
		for i := range out {
			out[i].Levels = append([]Level{}, lv[out[i].EntryID]...)
		}
	}
	return out, nil
}

// buildProbes lists the probes of every prefix of window, shortest
// prefix first: the prefix itself, then its deinflections (when the
// language has a rule table), each followed by the stem probe of every
// compound of the table it ends in (勉強する -> 勉強), at most one per
// (stem, class) of a prefix. The window's Deinflect calls share MaxWindowWork, its
// compound checks MaxCompoundWork, and at most MaxProbes probes are kept
// (docs/contracts/lemma/README.md, Lookup bounds); limit (the request's
// units left) caps both budgets. It also returns the work spent, Deinflect
// and compound units together.
func buildProbes(rules *lemma.Table, window []rune, limit int) ([]probe, int) {
	var probes []probe
	work := 0
	deinflectMax := min(MaxWindowWork, max(0, limit))
	compoundWork := lemma.NewWork(min(MaxCompoundWork, max(0, limit)))
	seenCompound := map[compoundKey]bool{}
	extra := 0 // probes beyond the prefixes themselves
	add := func(p probe) bool {
		if len(probes) >= MaxProbes {
			return false
		}
		if p.reasons != nil || p.compound || p.term != p.form {
			extra++
		}
		probes = append(probes, p)
		return true
	}
	for n := 1; n <= len(window); n++ {
		prefix := string(window[:n])
		if !add(probe{term: prefix, form: prefix, length: n}) {
			break
		}
		if rules == nil || work >= deinflectMax {
			continue
		}
		cs, spent := rules.DeinflectBudget(prefix, min(lemma.MaxWork, deinflectMax-work))
		work += spent
		for _, d := range cs {
			p := probe{term: d.Form, form: d.Form, length: n, reasons: d.Reasons, class: d.Class}
			if !add(p) {
				return probes, work + compoundWork.Used() + ProbeCost*extra
			}
			// JMdict tags vs on the noun (勉強: n, vs), not on 勉強する.
			for _, c := range rules.Compounds {
				stem, ok := strings.CutSuffix(d.Form, c.Suffix)
				if !ok || d.Class != c.Class || seenCompound[compoundKey{stem, c.Class, n}] || !c.StemOK(stem, compoundWork) {
					continue
				}
				seenCompound[compoundKey{stem, c.Class, n}] = true
				p.term, p.compound = stem, true
				if !add(p) {
					return probes, work + compoundWork.Used() + ProbeCost*extra
				}
			}
		}
	}
	return probes, work + compoundWork.Used() + ProbeCost*extra
}

// hasClass reports whether any sense of e has a part of speech of class
// in the rule table rules; the empty class (an exact match) always holds.
func hasClass(rules *lemma.Table, e lexicon.Entry, class string) bool {
	if class == "" {
		return true
	}
	return rules != nil && slices.ContainsFunc(e.Senses, func(s lexicon.Sense) bool { return rules.ClassMatches(class, s.POS) })
}

// weakReading reports whether m is a weak reading match: a reading match
// is strong only when the reading is the probe text itself (not just its
// plain form: アメ for あめ) and the word is usually written that way (no
// written form, or usually kana: the entry flag uk, set when any sense is).
func weakReading(m *match) bool {
	e := m.entry
	return m.reading >= 0 && (e.Readings[m.reading].Value != m.probe.term || len(e.Forms) > 0 && !e.UK)
}

// readingPlain is the plain reading form text is also looked up by, when
// the rule table's hints say text in its script is (Japanese: kana-only
// text, by the plain form of its kana readings).
func readingPlain(pack lang.Pack, hints lemma.Hints, text string) (string, bool) {
	if hints.ReadingScript == "" || !lemma.InScript(hints.ReadingScript, text) {
		return "", false
	}
	return pack.NormalizeReading(hints.ReadingType, text), true
}

// allSensesTagged reports whether e has senses and every one has a
// part-of-speech tag in tags.
func allSensesTagged(e lexicon.Entry, tags []string) bool {
	return len(tags) > 0 && len(e.Senses) > 0 && !slices.ContainsFunc(e.Senses, func(s lexicon.Sense) bool {
		return !slices.ContainsFunc(s.POS, func(p string) bool { return slices.Contains(tags, p) })
	})
}

// anySenseTagged reports whether a sense of e has a part-of-speech tag in
// tags.
func anySenseTagged(e lexicon.Entry, tags []string) bool {
	return slices.ContainsFunc(e.Senses, func(s lexicon.Sense) bool {
		return slices.ContainsFunc(s.POS, func(p string) bool { return slices.Contains(tags, p) })
	})
}

// rankKeys computes the sort keys of m except the frequency rank and
// yields (markYields).
func rankKeys(pack lang.Pack, hints lemma.Hints, language string, m *match) candidate {
	e, term := m.entry, m.probe.term
	plain, _ := readingPlain(pack, hints, term)
	readingIs := func(r lexicon.Reading) bool {
		return r.Value == term || plain != "" && r.Plain == plain
	}
	c := candidate{
		matchedLen: m.probe.length,
		chainLen:   len(m.probe.reasons),
		dictOrder:  math.MaxInt64,
		ukPri:      e.UK && e.Pri > 0,
		pri:        e.Pri,
		headword:   displayTerm(language, m),
		entryID:    e.ID,
		weakKana:   weakReading(m),
	}
	// Primary: the text that matched the dictionary is the headword — the
	// first reading or first form. A traditional form (CC-CEDICT's trad
	// flag) is the same headword in the other script, so 學習 is as
	// primary for 学习 as 学习 itself.
	c.primary = len(e.Readings) > 0 && readingIs(e.Readings[0]) ||
		len(e.Forms) > 0 && e.Forms[0].Text == term ||
		slices.ContainsFunc(e.Forms, func(f lexicon.Form) bool {
			return f.Text == term && slices.Contains(f.Flags, flagTrad)
		})
	for _, f := range e.Forms {
		if f.Text == term {
			c.exactCount++
		}
	}
	// A reading counts once per plain form: する and スる are one match.
	var counted []string
	for _, r := range e.Readings {
		if readingIs(r) && !slices.Contains(counted, r.Plain) {
			counted = append(counted, r.Plain)
			c.exactCount++
		}
	}
	for _, s := range e.Senses {
		c.dictOrder = min(c.dictOrder, s.DictionaryID)
	}
	return c
}

// displayTerm is the headword a result shows: for Japanese the written form
// that matched (解る, not 分かる) unless it is search-only (之 shows の);
// otherwise — a reading match, or Chinese, whose traditional match still
// shows the simplified headword — the entry's display form
// (lexicon.Entry.Headword: the kana of a usually-kana word).
func displayTerm(language string, m *match) string {
	if language == "ja" && m.reading < 0 && !slices.ContainsFunc(m.entry.Forms, func(f lexicon.Form) bool {
		return f.Text == m.probe.term && slices.Contains(f.Flags, flagSearchOnly)
	}) {
		return m.probe.term
	}
	return m.entry.Headword()
}

// flagSearchOnly is JMdict's search-only kanji form flag (sK).
const flagSearchOnly = "sK"

// result renders a ranked match.
func result(language string, m *match, freqs []Frequency, names map[int64]string, window []rune, offset int) Result {
	e := m.entry
	r := Result{
		EntryID:     e.ID,
		Kind:        e.Kind,
		Term:        displayTerm(language, m),
		Forms:       e.Forms,
		Readings:    e.Readings,
		Matched:     string(window[:m.probe.length]),
		Start:       offset,
		End:         offset + m.probe.length,
		Reasons:     append([]string{}, m.probe.reasons...),
		Tags:        []string{},
		Frequencies: append([]Frequency{}, freqs...),
		Senses:      make([]SenseOut, len(e.Senses)),
		Pri:         e.Pri,
		Lemma:       m.probe.form,
		ViaReading:  m.reading >= 0,
		WeakReading: weakReading(m),
	}
	if m.probe.term != m.probe.form {
		r.Stem = m.probe.term
	}
	switch {
	case m.reading >= 0:
		r.Reading = e.Readings[m.reading].Value
	case len(e.Readings) > 0:
		r.Reading = e.Readings[0].Value
	}
	// "usually kana" follows the first sense, as the display form does
	// (docs/contracts/frequency/display-form.json): 目 and 山 are uk only in
	// a side sense. Ranking keeps e.UK (any sense: how kana text matches).
	if len(e.Senses) > 0 && slices.Contains(e.Senses[0].Tags, tagUK) {
		r.Tags = append(r.Tags, tagUsuallyKana)
	}
	for i, s := range e.Senses {
		r.Senses[i] = SenseOut{
			DictionaryID: s.DictionaryID, DictionaryName: names[s.DictionaryID],
			POS: s.POS, Tags: s.Tags, Glosses: s.Glosses, Xrefs: s.Xrefs,
		}
	}
	return r
}

// dropRetired removes from order the entries that have no active sense
// (of an installed dictionary) but did have senses: the words of an
// uninstalled dictionary, whose entries survive with tombstoned senses.
// An entry that never had a sense — a character created only from
// Unihan's or KANJIDIC2's character data — stays. One query, run only
// when some entry has no active sense. It relies on sense tombstones not
// being purged: a purge of an uninstalled dictionary's senses would make
// its words look like sense-less characters again.
func (s Service) dropRetired(ctx context.Context, order []int64, best map[int64]*match) ([]int64, error) {
	var ids []any
	for _, id := range order {
		if len(best[id].entry.Senses) == 0 {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return order, nil
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT DISTINCT entry_id FROM senses WHERE entry_id IN (`+
		strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")+`)`, ids...)
	if err != nil {
		return nil, fmt.Errorf("lookup: retired entries: %w", err)
	}
	defer rows.Close()
	retired := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("lookup: retired entries: %w", err)
		}
		retired[id] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("lookup: retired entries: %w", err)
	}
	return slices.DeleteFunc(order, func(id int64) bool { return retired[id] }), nil
}

// dictionaryNames returns the names of the dictionaries the senses of
// the ranked candidates come from, in one query; a dictionary without a
// name is named by its pack id.
func (s Service) dictionaryNames(ctx context.Context, cands []candidate, matches []*match) (map[int64]string, error) {
	var ids []any
	seen := map[int64]bool{}
	for _, c := range cands {
		for _, sn := range matches[c.at].entry.Senses {
			if !seen[sn.DictionaryID] {
				seen[sn.DictionaryID] = true
				ids = append(ids, sn.DictionaryID)
			}
		}
	}
	names := map[int64]string{}
	if len(ids) == 0 {
		return names, nil
	}
	// A handful of dictionaries: one IN list stays far below SQLite's
	// variable limit.
	rows, err := s.DB.QueryContext(ctx, `SELECT id, name, pack_id FROM dictionaries WHERE id IN (`+
		strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")+`)`, ids...)
	if err != nil {
		return nil, fmt.Errorf("lookup: dictionary names: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id           int64
			name, packID string
		)
		if err := rows.Scan(&id, &name, &packID); err != nil {
			return nil, fmt.Errorf("lookup: dictionary names: %w", err)
		}
		if name == "" {
			name = packID
		}
		names[id] = name
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("lookup: dictionary names: %w", err)
	}
	return names, nil
}

// wordStart reports whether r can begin a word: a letter, except Latin
// letters in zh/ja text.
func wordStart(language string, r rune) bool {
	if !unicode.IsLetter(r) {
		return false
	}
	return !((language == "zh" || language == "ja") && unicode.Is(unicode.Latin, r))
}
