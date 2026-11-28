package counters

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
	"strings"

	"qinqin/internal/lexicon"
	"qinqin/internal/model"
	"qinqin/internal/overlay"
	"qinqin/internal/pinyin"
)

// Reading is one reading as the route serves it.
type Reading struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// Measure is one right answer of a noun drill (a measure word or a
// counter) or one wrong choice of a pool: its written form shown, the other
// spellings accepted, its readings (pinyin and bopomofo, or kana and
// romaji), and for a counter its id and what it counts.
type Measure struct {
	Written  string    `json:"written"`
	Variants []string  `json:"variants"`
	Readings []Reading `json:"readings"`
	Counter  string    `json:"counter,omitempty"`
	Counts   string    `json:"counts,omitempty"`
}

// DrillNoun is one noun of POST /api/drills/measure-words/words: the
// entry's written form and readings after the caller's own patch, the gloss
// shown, its measure words or counters (canonical first) and, for Chinese,
// 个 when it is acceptable but not idiomatic.
type DrillNoun struct {
	ID       int64     `json:"id"`
	Language string    `json:"language"`
	Written  string    `json:"written"`
	Readings []Reading `json:"readings"`
	Gloss    string    `json:"gloss"`
	Measures []Measure `json:"measures"`
	Fallback *Measure  `json:"fallback"`
	// Traditional: a Chinese noun shown in traditional characters, its
	// measure words too (a pool's variant is its traditional form).
	Traditional bool `json:"traditional"`
}

// WordsAnswer is the route's answer: the nouns in first-occurrence order
// and, per language of a noun, the pool wrong choices are taken from.
type WordsAnswer struct {
	Words []DrillNoun          `json:"words"`
	Pools map[string][]Measure `json:"pools"`
}

// chinese reports whether a language code is Chinese (zh, zh-Hant, …).
func chinese(language string) bool { return language == "zh" || strings.HasPrefix(language, "zh-") }

// Words are the drilled nouns among the entries ids for userID: Chinese
// word and character entries with a CL note (measures.json) and Japanese
// word entries of the counters table. Unknown and other-language entries,
// Japanese kanji entries and nouns without data are absent.
func Words(ctx context.Context, db *sql.DB, userID int64, ids []int64) (WordsAnswer, error) {
	out := WordsAnswer{Words: []DrillNoun{}, Pools: map[string][]Measure{}}
	entries, err := lexicon.Store{DB: db}.GetMany(ctx, ids)
	if err != nil {
		return out, err
	}
	seen := map[int64]bool{}
	for _, e := range entries {
		// CC-CEDICT stores a one-hanzi word (书, 猫) as a character entry.
		if seen[e.ID] || (e.Kind != "word" && !(chinese(e.Language) && e.Kind == "character")) {
			continue
		}
		seen[e.ID] = true
		var noun DrillNoun
		var ok bool
		switch {
		case chinese(e.Language):
			noun, ok = chineseNoun(e)
		case e.Language == "ja":
			noun, ok = japaneseNoun(e)
		}
		if !ok {
			continue
		}
		base := model.EntryBase{ID: e.ID, Written: noun.Written}
		for _, r := range e.Readings {
			base.Readings = append(base.Readings, model.Reading{Type: r.Type, Value: r.Value, Plain: r.Plain, Ord: r.Ord})
		}
		if err := overlay.Apply(ctx, db, userID, &base); err != nil {
			return out, fmt.Errorf("measure-word words: %w", err)
		}
		if chinese(e.Language) {
			showTraditional(&noun, e, base.Written)
		}
		noun.Written = base.Written
		noun.Readings = []Reading{}
		for _, r := range base.Readings {
			noun.Readings = append(noun.Readings, Reading{Type: r.Type, Value: r.Value})
		}
		out.Words = append(out.Words, noun)
		if _, done := out.Pools[noun.Language]; !done {
			out.Pools[noun.Language] = poolOf(noun.Language)
		}
	}
	return out, nil
}

func chineseMeasure(m ChineseMeasure) Measure {
	out := Measure{Written: m.Simplified, Variants: []string{}, Readings: []Reading{{Type: "pinyin", Value: m.Pinyin}}}
	if m.Traditional != m.Simplified {
		out.Variants = append(out.Variants, m.Traditional)
	}
	if b, err := pinyin.ToBopomofo(m.Pinyin); err == nil {
		out.Readings = append(out.Readings, Reading{Type: "bopomofo", Value: b})
	}
	// Other accepted readings come after the shown ones (a client shows the first of each type).
	for _, alt := range AltPinyin[m.Simplified] {
		if alt != m.Pinyin {
			out.Readings = append(out.Readings, Reading{Type: "pinyin", Value: alt})
		}
	}
	return out
}

func chineseNoun(e lexicon.Entry) (DrillNoun, bool) {
	written := e.Headword()
	ms, gloss, fallback, ok := ChineseNoun(simplifiedOf(e, written), e.Senses)
	if !ok {
		return DrillNoun{}, false
	}
	noun := DrillNoun{ID: e.ID, Language: e.Language, Written: written, Gloss: gloss}
	for _, m := range ms {
		noun.Measures = append(noun.Measures, chineseMeasure(m))
	}
	if fallback {
		f := chineseMeasure(FallbackMeasure)
		noun.Fallback = &f
	}
	return noun, true
}

// simplifiedOf is the entry's simplified form (its first form not flagged
// trad), else written.
func simplifiedOf(e lexicon.Entry, written string) string {
	for _, f := range e.Forms {
		if !slices.Contains(f.Flags, "trad") {
			return f.Text
		}
	}
	return written
}

// showTraditional shows the measure words in traditional characters when
// the noun is shown in a traditional form that differs from its simplified
// one (the simplified forms stay accepted).
func showTraditional(noun *DrillNoun, e lexicon.Entry, written string) {
	if written == simplifiedOf(e, written) || !slices.ContainsFunc(e.Forms, func(f lexicon.Form) bool {
		return f.Text == written && slices.Contains(f.Flags, "trad")
	}) {
		return
	}
	noun.Traditional = true
	swap := func(m *Measure) {
		if len(m.Variants) > 0 {
			m.Written, m.Variants[0] = m.Variants[0], m.Written
		}
	}
	for i := range noun.Measures {
		swap(&noun.Measures[i])
	}
	if noun.Fallback != nil {
		swap(noun.Fallback)
	}
}

func japaneseMeasure(c Counter) Measure {
	return Measure{Written: c.Written, Variants: append([]string{}, c.Variants...), Counter: c.ID, Counts: c.Counts,
		Readings: []Reading{{Type: "kana", Value: c.Reading}, {Type: "romaji", Value: romaji(c.Reading)}}}
}

// tableNoun is the first noun of the table the entry is: its written form
// is one of the entry's spellings (not search-only) or kana readings, and
// its reading one of the entry's kana readings.
func tableNoun(e lexicon.Entry) (Noun, bool) {
	var spellings, kana []string
	for _, f := range e.Forms {
		if !slices.Contains(f.Flags, "sK") {
			spellings = append(spellings, f.Text)
		}
	}
	for _, r := range e.Readings {
		if r.Type == "kana" {
			kana = append(kana, r.Value)
		}
	}
	for _, n := range table.Nouns {
		if (slices.Contains(spellings, n.Written) || slices.Contains(kana, n.Written)) && slices.Contains(kana, n.Reading) {
			return n, true
		}
	}
	return Noun{}, false
}

func japaneseNoun(e lexicon.Entry) (DrillNoun, bool) {
	n, ok := tableNoun(e)
	if !ok {
		return DrillNoun{}, false
	}
	noun := DrillNoun{ID: e.ID, Language: e.Language, Written: e.Headword(), Gloss: lexicon.DisplayGloss(e.Senses, n.Reading)}
	for _, id := range n.Counters {
		if c, ok := CounterByID(id); ok {
			noun.Measures = append(noun.Measures, japaneseMeasure(c))
		}
	}
	return noun, len(noun.Measures) > 0
}

// poolOf is a language's pool of wrong choices: the common Chinese measure
// words, or the counters of the table that count a noun.
func poolOf(language string) []Measure {
	out := []Measure{}
	if chinese(language) {
		for _, m := range ChinesePool {
			out = append(out, chineseMeasure(m))
		}
		return out
	}
	for _, c := range table.Counters {
		if slices.ContainsFunc(table.Nouns, func(n Noun) bool { return slices.Contains(n.Counters, c.ID) }) {
			out = append(out, japaneseMeasure(c))
		}
	}
	return out
}
