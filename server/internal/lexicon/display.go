package lexicon

import "slices"

// The display form rule (contract: docs/contracts/frequency/display-form.json;
// the web's lib/entry/displayForm.ts implements the same rule).

// tagUK is JMdict's sense misc tag "usually written in kana alone".
const tagUK = "uk"

// rareFormFlags mark a written form a reader rarely meets: rarely used,
// outdated, irregular or search-only kanji (JMdict ke_inf); sK is never
// displayed.
var rareFormFlags = []string{"rK", "oK", "iK", "sK"}

// rareReadingFlags are the same flags of a kana reading (JMdict re_inf).
var rareReadingFlags = []string{"rk", "ok", "ik", "sk"}

// DisplayForm is the text an entry is shown and snapshotted as. listForm,
// when not empty, is how a word list (a frequency pack row) writes the
// word. In order:
//
//  1. listForm, when it is written only in kana and is the value of one
//     of the entry's kana readings that is not search-only (sk);
//  2. for an entry whose first sense is tagged uk (usually kana), its best
//     kana reading;
//  3. its best written form;
//  4. its best kana reading (else its first kana reading), else its first
//     reading of any type, else "".
//
// Best is the first item without a rare flag, else the first that is not
// search-only; a search-only written form (sK) is never displayed. Only the
// first sense counts for uk: JMdict marks minor senses of 犬, 見る or 山 uk.
func (e Entry) DisplayForm(listForm string) string {
	if listForm != "" && AllKana(listForm) && slices.ContainsFunc(e.Readings, func(r Reading) bool {
		return r.Type == "kana" && r.Value == listForm && !slices.Contains(r.Flags, "sk")
	}) {
		return listForm
	}
	kana := e.kanaReadings()
	if len(kana) > 0 && len(e.Senses) > 0 && slices.Contains(e.Senses[0].Tags, tagUK) {
		return bestKana(kana)
	}
	forms := make([]flagged, len(e.Forms))
	for i, f := range e.Forms {
		forms[i] = flagged{f.Text, f.Flags}
	}
	if t, ok := best(forms, rareFormFlags, "sK"); ok {
		return t
	}
	if len(kana) > 0 {
		return bestKana(kana)
	}
	if len(e.Readings) > 0 {
		return e.Readings[0].Value
	}
	return ""
}

// Headword is the entry's display form without a list form (see
// DisplayForm).
func (e Entry) Headword() string { return e.DisplayForm("") }

type flagged struct {
	text  string
	flags []string
}

func (e Entry) kanaReadings() []flagged {
	var out []flagged
	for _, r := range e.Readings {
		if r.Type == "kana" {
			out = append(out, flagged{r.Value, r.Flags})
		}
	}
	return out
}

// bestKana is the best kana reading, else the first one (an entry shows
// something even when its only reading is search-only).
func bestKana(kana []flagged) string {
	if t, ok := best(kana, rareReadingFlags, "sk"); ok {
		return t
	}
	return kana[0].text
}

// best returns the first item without any of the rare flags, else the
// first without the hidden flag.
func best(items []flagged, rare []string, hidden string) (string, bool) {
	for _, it := range items {
		if !slices.ContainsFunc(it.flags, func(f string) bool { return slices.Contains(rare, f) }) {
			return it.text, true
		}
	}
	for _, it := range items {
		if !slices.Contains(it.flags, hidden) {
			return it.text, true
		}
	}
	return "", false
}

// AllKana reports a non-empty text of hiragana, katakana and ー only.
func AllKana(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if !(c >= 0x3041 && c <= 0x3096) && !(c >= 0x30a1 && c <= 0x30fa) && c != 0x30fc {
			return false
		}
	}
	return true
}
