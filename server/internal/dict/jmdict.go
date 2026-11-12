package dict

import (
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"qinqin/internal/model"
)

// jmdictFile is the data file of a format "jmdict" dictionary pack: the
// JMdict XML document.
const jmdictFile = "jmdict.xml"

// Attrs the importer stores on each JMdict form's entry, all under
// jmdictAttrPrefix, which it owns: a re-import replaces them wholesale.
const (
	jmdictAttrPrefix = "jmdict."
	// attrJMdictPri is the form's priority score, 1–100 (see
	// priorityScore); absent when the score is 0.
	attrJMdictPri = jmdictAttrPrefix + "pri"
	// attrJMdictUK is "1" when a sense of the word is tagged uk (usually
	// written in kana alone); absent otherwise.
	attrJMdictUK = jmdictAttrPrefix + "uk"
)

// jmdictDoc is the decoded shape of a JMdict file: just the entries —
// every element the importer does not consume, part-of-speech codes and
// cross references among them, is skipped.
type jmdictDoc struct {
	Entries []jmdictEntry `xml:"entry"`
}

// jmdictEntry is one <entry> of a JMdict file: its sequence number, its
// kanji written forms, its kana readings, and its senses. A reading
// restricted to particular kanji forms is treated as a reading of the
// word as a whole — the forms share every reading, like a cedict
// traditional twin does.
type jmdictEntry struct {
	EntSeq int           `xml:"ent_seq"`
	KEles  []jmdictKEle  `xml:"k_ele"`
	REles  []jmdictREle  `xml:"r_ele"`
	Senses []jmdictSense `xml:"sense"`
}

// jmdictKEle is one <k_ele>: a kanji written form of the word, its
// priority tags (<ke_pri>, e.g. "ichi1", "nf12") and its info flags
// (<ke_inf>, entity references such as "&rK;").
type jmdictKEle struct {
	KEb string   `xml:"keb"`
	Pri []string `xml:"ke_pri"`
	Inf []string `xml:"ke_inf"`
}

// jmdictREle is one <r_ele>: a kana reading of the word, its priority
// tags (<re_pri>) and its info flags (<re_inf>, e.g. "&ik;").
type jmdictREle struct {
	Reb string   `xml:"reb"`
	Pri []string `xml:"re_pri"`
	Inf []string `xml:"re_inf"`
}

// jmdictSense is one <sense> of the word: its glosses and its misc tags
// (<misc>, entity references such as "&uk;").
type jmdictSense struct {
	Glosses []jmdictGloss `xml:"gloss"`
	Misc    []string      `xml:"misc"`
}

// jmdictGloss is one <gloss> of a sense — English when it carries no
// xml:lang, another language when it does.
type jmdictGloss struct {
	Lang string `xml:"lang,attr"`
	Text string `xml:",chardata"`
}

// ParseJMdict parses a JMdict file from r: one raw entry per word — its
// first kanji form the written form and the rest variant forms, every
// kana reading typed "kana", and the English glosses of its senses in
// order. A word without a kanji form is written as its first kana
// reading. Each form also gets its ranking attrs in FormAttrs (see
// jmdictFormAttrs). An entry with neither a form nor a reading, or with
// no English gloss, is an error naming its sequence number.
func ParseJMdict(r io.Reader) ([]RawEntry, error) {
	var doc jmdictDoc
	d := xml.NewDecoder(r)
	// JMdict references entities its DTD declares; Go's decoder does not
	// read the DTD, and with Strict off every entity reference — declared
	// or not — passes through as written: <misc>&uk;</misc> decodes to
	// the text "&uk;" (verified on the full JMdict). entityName strips the
	// markup.
	d.Strict = false
	if err := d.Decode(&doc); err != nil {
		return nil, fmt.Errorf("jmdict: parse: %w", err)
	}
	es := make([]RawEntry, 0, len(doc.Entries))
	for _, x := range doc.Entries {
		var (
			forms, readings []string
			kEles           []jmdictKEle // the k_ele of each form
		)
		for _, k := range x.KEles {
			if keb := strings.TrimSpace(k.KEb); keb != "" {
				forms = append(forms, keb)
				kEles = append(kEles, k)
			}
		}
		for _, re := range x.REles {
			if reb := strings.TrimSpace(re.Reb); reb != "" {
				readings = append(readings, reb)
			}
		}
		kanaScore := 0 // the best score among the word's readings
		for _, re := range x.REles {
			if strings.TrimSpace(re.Reb) != "" {
				kanaScore = max(kanaScore, formScore(re.Pri, re.Inf))
			}
		}
		uk := false
		for _, s := range x.Senses {
			for _, m := range s.Misc {
				uk = uk || entityName(m) == "uk"
			}
		}
		formAttrs := map[string]map[string]string{}
		if len(forms) == 0 {
			if len(readings) == 0 {
				return nil, fmt.Errorf("jmdict: entry %d carries no kanji form and no reading", x.EntSeq)
			}
			// A word without a kanji form is written as its kana and
			// scored by its readings.
			forms = []string{readings[0]}
			formAttrs[forms[0]] = jmdictAttrs(kanaScore, uk)
		}
		for i, k := range kEles {
			// A kanji form scores by its own priority tags, penalized
			// when the form is rare, outdated, irregular or search-only.
			// A uk word is read in kana, so its readings' score counts
			// for each of its forms too. A rarely used (rK) form keeps it
			// unpenalized: the kanji of a usually-kana word is expected to
			// be rare (為る/する and 居る/いる are rK), which says nothing
			// about how common the word is. A search-only, irregular or
			// outdated form (sK, iK, oK) is still penalized, so it ranks
			// below the word's real form.
			score := formScore(k.Pri, k.Inf)
			if uk {
				score = max(score, penalize(kanaScore, withoutFlag(k.Inf, "rK")))
			}
			formAttrs[forms[i]] = jmdictAttrs(score, uk)
		}
		var glosses []string
		for _, s := range x.Senses {
			for _, g := range s.Glosses {
				if (g.Lang == "" || g.Lang == "eng") && strings.TrimSpace(g.Text) != "" {
					glosses = append(glosses, strings.TrimSpace(g.Text))
				}
			}
		}
		if len(glosses) == 0 {
			return nil, fmt.Errorf("jmdict: entry %d carries no English glosses", x.EntSeq)
		}
		rs := make([]model.Reading, len(readings))
		for i, reb := range readings {
			rs[i] = model.Reading{Type: "kana", Value: reb}
		}
		es = append(es, RawEntry{
			Written:   forms[0],
			Forms:     forms[1:],
			Readings:  rs,
			Glosses:   glosses,
			FormAttrs: formAttrs,
		})
	}
	return es, nil
}

// jmdictAttrs returns the ranking attrs of one form: attrJMdictPri when
// score > 0, attrJMdictUK when uk. Never nil.
func jmdictAttrs(score int, uk bool) map[string]string {
	attrs := map[string]string{}
	if score > 0 {
		attrs[attrJMdictPri] = strconv.Itoa(score)
	}
	if uk {
		attrs[attrJMdictUK] = "1"
	}
	return attrs
}

// Priority scores (see priorityScore).
const (
	tier1Score  = 60 // news1, ichi1, spec1, gai1
	tier2Score  = 30 // news2, ichi2, spec2, gai2
	rarePenalty = 40 // subtracted from a rare/outdated/irregular/search-only form's score
)

// priorityScore maps JMdict priority tags (<ke_pri>/<re_pri> values) to a
// score from 0 (no or unknown tags) to 100 (most common), combining tags
// by max, never by sum:
//
//	tag                          score
//	nf01 … nf24                  100 … 77   (101 − NN; nf01 = the 500 most frequent words)
//	news1, ichi1, spec1, gai1     60        (tier 1)
//	nf25 … nf48                   53 … 30   (78 − NN)
//	news2, ichi2, spec2, gai2     30        (tier 2)
//	anything else                  0
//
// nfNN is the word's 500-word frequency bucket in the news corpus that
// news1/news2 split: nf01–nf24 are the news1 words, nf25–nf48 the news2
// ones. So every nf bucket outranks the next, any tier-1 word outranks
// any word whose best tag is tier 2, and within each tier the frequency
// bucket refines the order. Deterministic and pure.
func priorityScore(tags []string) int {
	best := 0
	for _, t := range tags {
		best = max(best, tagScore(strings.TrimSpace(t)))
	}
	return best
}

// tagScore is the score of one priority tag (see priorityScore).
func tagScore(tag string) int {
	switch tag {
	case "news1", "ichi1", "spec1", "gai1":
		return tier1Score
	case "news2", "ichi2", "spec2", "gai2":
		return tier2Score
	}
	if n, ok := strings.CutPrefix(tag, "nf"); ok && len(n) == 2 {
		nn, err := strconv.Atoi(n)
		switch {
		case err != nil || nn < 1 || nn > 48:
			return 0
		case nn <= 24:
			return 101 - nn
		default:
			return 78 - nn
		}
	}
	return 0
}

// rareFlags are the <ke_inf>/<re_inf> flags that mark a form as one a
// reader rarely meets: rarely used, outdated, irregular, or search-only
// kanji forms (rK, oK, iK, sK) and kana readings (rk, ok, ik, sk).
var rareFlags = map[string]bool{
	"rK": true, "oK": true, "iK": true, "sK": true,
	"rk": true, "ok": true, "ik": true, "sk": true,
}

// formScore is the score of one kanji form or kana reading: the
// priorityScore of its priority tags, penalized when its info flags mark
// it rare (see penalize).
func formScore(pri, inf []string) int {
	return penalize(priorityScore(pri), inf)
}

// penalize subtracts rarePenalty from score, floored at 0, when any of
// the info flags marks the form rare; one penalty however many flags.
func penalize(score int, inf []string) int {
	for _, f := range inf {
		if rareFlags[entityName(f)] {
			return max(0, score-rarePenalty)
		}
	}
	return score
}

// withoutFlag returns the info flags inf without the flag named name
// (as an entity reference or bare).
func withoutFlag(inf []string, name string) []string {
	var out []string
	for _, f := range inf {
		if entityName(f) != name {
			out = append(out, f)
		}
	}
	return out
}

// entityName returns the name of an entity reference as the decoder
// passes it through ("&uk;" -> "uk"); a bare name is returned as is.
func entityName(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "&") && strings.HasSuffix(s, ";") {
		return s[1 : len(s)-1]
	}
	return s
}

// readJMdictPack reads and parses the jmdict.xml of the format "jmdict"
// pack in dir, resolving each word into the pipeline's entry shape:
// kind word, one entry per kanji form, kana readings, glosses, ranking
// attrs. A form shared by several words gets all of their readings, the
// highest of their priority scores, and uk when any of them is uk.
func readJMdictPack(dir string) ([]entry, error) {
	f, err := openMaybeGz(filepath.Join(dir, jmdictFile))
	if err != nil {
		return nil, fmt.Errorf("%w: read %s of %s: %v", ErrInvalidPack, jmdictFile, dir, err)
	}
	defer f.Close()
	raw, err := ParseJMdict(f)
	if err != nil {
		return nil, fmt.Errorf("%w: parse %s of %s: %v", ErrInvalidPack, jmdictFile, dir, err)
	}
	// A kanji form can belong to several words (為る is する, and a form
	// of 成る read なる). Entries are keyed by written form and readings
	// replace wholesale on upsert, so each form carries the union of its
	// words' readings in file order — otherwise the last word would win
	// and する would vanish from 為る.
	// The ranking attrs merge the same way, so every word upserts the
	// form with the same attrs: the max score, uk if any word is uk.
	byForm := map[string][]model.Reading{}
	shared := map[string]bool{}
	attrsOf := map[string]map[string]string{}
	for _, r := range raw {
		for _, form := range append([]string{r.Written}, r.Forms...) {
			if _, seen := byForm[form]; seen {
				shared[form] = true
			}
			for _, rd := range r.Readings {
				if !slices.Contains(byForm[form], rd) {
					byForm[form] = append(byForm[form], rd)
				}
			}
			attrsOf[form] = mergeJMdictAttrs(attrsOf[form], r.FormAttrs[form])
		}
	}
	es := make([]entry, len(raw))
	for i, r := range raw {
		es[i] = entry{
			Written:   r.Written,
			Kind:      "word",
			Readings:  r.Readings,
			Glosses:   r.Glosses,
			Forms:     r.Forms,
			FormAttrs: map[string]map[string]string{},
		}
		for _, form := range append([]string{r.Written}, r.Forms...) {
			es[i].FormAttrs[form] = attrsOf[form]
			if shared[form] {
				if es[i].FormReadings == nil {
					es[i].FormReadings = map[string][]model.Reading{}
				}
				es[i].FormReadings[form] = byForm[form]
			}
		}
	}
	return es, nil
}

// mergeJMdictAttrs merges the ranking attrs of two words sharing a form:
// the higher priority score, and uk when either is uk. Never nil.
func mergeJMdictAttrs(a, b map[string]string) map[string]string {
	score := func(m map[string]string) int {
		n, _ := strconv.Atoi(m[attrJMdictPri])
		return n
	}
	return jmdictAttrs(max(score(a), score(b)), a[attrJMdictUK] == "1" || b[attrJMdictUK] == "1")
}
