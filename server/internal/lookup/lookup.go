// Package lookup resolves the text at a cursor to a ranked list of
// dictionary entries, the way Yomitan does: every prefix of the text
// from the cursor (and, for Japanese, every part-of-speech-checked
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
	"qinqin/internal/lexicon"
)

const (
	// MaxWindowRunes is the longest source text, in code points, a
	// lookup tries to match.
	MaxWindowRunes = 12
	// MaxEntries caps the results of one lookup, after ranking.
	MaxEntries = 30
)

// tagUsuallyKana marks an entry JMdict says is usually written in kana.
const tagUsuallyKana = "usually kana"

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
	// Kind is word or character. Term is the entry's headword — its first
	// form, or its first reading for an entry without forms (a kana-only
	// word) — and Reading the reading that matched, else the first one.
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
	// Tags are entry-level tags such as "usually kana".
	Tags []string
	// Frequencies holds one value per frequency pack with data for the
	// entry, in pack priority order.
	Frequencies []Frequency
	// Senses are the entry's senses as stored: grouped by dictionary.
	Senses []SenseOut
	Pri    int
}

// Service looks text up in the lexicon and ranks it with the frequency
// packs. DB is the database both stores read, used for dictionary names.
type Service struct {
	Lexicon lexicon.Store
	Freq    freq.Store
	DB      *sql.DB
}

// probe is one dictionary-side text tried for a prefix of the source.
type probe struct {
	term    string   // text looked up: the prefix, a deinflected form or a する-compound stem
	length  int      // code points of source text it accounts for
	reasons []string // inflection chain; nil when exact
	class   string   // word class an entry must have (lang.ClassMatches); "" = any
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
// traditional forms, so either script matches) and, for Japanese
// kana-only text, by the plain form of a word's readings. Japanese
// prefixes also yield their deinflections, kept only when a sense of the
// entry has the deinflection's word class. A する compound (勉強した →
// 勉強する) is also looked up by its stem (勉強), accepted when the stem
// is a する noun (JMdict tags vs on the noun). Each category is one
// batched store call, whatever the window length.
func (s Service) Lookup(ctx context.Context, language, text string, offset int, kinds []string) ([]Result, error) {
	runes := []rune(text)
	if offset < 0 || offset >= len(runes) || !wordStart(language, runes[offset]) {
		return []Result{}, nil
	}
	window := runes[offset:min(offset+MaxWindowRunes, len(runes))]
	pack := lang.For(language)
	probes := buildProbes(pack, window)

	var forms, plains []string
	for _, p := range probes {
		if !slices.Contains(forms, p.term) {
			forms = append(forms, p.term)
		}
		if language == "ja" && kanaOnly(p.term) {
			if pl := pack.NormalizeReading("kana", p.term); !slices.Contains(plains, pl) {
				plains = append(plains, pl)
			}
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
		if len(kinds) > 0 && !slices.Contains(kinds, e.Kind) || !hasClass(e, p.class) {
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
		if language != "ja" || !kanaOnly(p.term) {
			continue
		}
		pl := pack.NormalizeReading("kana", p.term)
		for _, e := range byReading[pl] {
			consider(e, p, slices.IndexFunc(e.Readings, func(r lexicon.Reading) bool { return r.Plain == pl }))
		}
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
	for i, m := range matches {
		cands[i] = rankKeys(pack, language, m)
		cands[i].freqRank = ranks[i]
		cands[i].at = i
	}
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
	return out, nil
}

// buildProbes lists the probes of every prefix of window, shortest
// prefix first: the prefix itself, then its deinflections (when the
// language deinflects), each followed by its する-compound stem probe.
func buildProbes(pack lang.Pack, window []rune) []probe {
	deinflector, _ := pack.(lang.Deinflector)
	var probes []probe
	for n := 1; n <= len(window); n++ {
		prefix := string(window[:n])
		probes = append(probes, probe{term: prefix, length: n})
		if deinflector == nil {
			continue
		}
		for _, d := range deinflector.Deinflect(prefix) {
			p := probe{term: d.Form, length: n, reasons: d.Reasons, class: d.Class}
			probes = append(probes, p)
			// JMdict tags vs on the noun (勉強: n, vs), not on 勉強する.
			if stem, ok := strings.CutSuffix(d.Form, "する"); ok && stem != "" && d.Class == lang.ClassVs {
				p.term = stem
				probes = append(probes, p)
			}
		}
	}
	return probes
}

// hasClass reports whether any sense of e has a part of speech of class;
// the empty class (an exact match) always holds.
func hasClass(e lexicon.Entry, class string) bool {
	if class == "" {
		return true
	}
	return slices.ContainsFunc(e.Senses, func(s lexicon.Sense) bool { return lang.ClassMatches(class, s.POS) })
}

// rankKeys computes the sort keys of m except the frequency rank.
func rankKeys(pack lang.Pack, language string, m *match) candidate {
	e, term := m.entry, m.probe.term
	plain := ""
	if kanaOnly(term) {
		plain = pack.NormalizeReading("kana", term)
	}
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
// that matched (解る, not 分かる); otherwise — a reading match, or
// Chinese, whose traditional match still shows the simplified headword
// — the entry's headword.
func displayTerm(language string, m *match) string {
	if language == "ja" && m.reading < 0 {
		return m.probe.term
	}
	return headword(m.entry)
}

// headword is an entry's first form, or its first reading when it has
// no form.
func headword(e lexicon.Entry) string {
	if len(e.Forms) > 0 {
		return e.Forms[0].Text
	}
	if len(e.Readings) > 0 {
		return e.Readings[0].Value
	}
	return ""
}

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
	}
	switch {
	case m.reading >= 0:
		r.Reading = e.Readings[m.reading].Value
	case len(e.Readings) > 0:
		r.Reading = e.Readings[0].Value
	}
	if e.UK {
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

// kanaOnly reports whether s is non-empty and made of hiragana, katakana
// and the prolonged sound mark only.
func kanaOnly(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r != 'ー' && !unicode.In(r, unicode.Hiragana, unicode.Katakana) {
			return false
		}
	}
	return true
}

// wordStart reports whether r can begin a word: a letter, except Latin
// letters in zh/ja text.
func wordStart(language string, r rune) bool {
	if !unicode.IsLetter(r) {
		return false
	}
	return !((language == "zh" || language == "ja") && unicode.Is(unicode.Latin, r))
}
