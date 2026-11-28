package api

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"unicode"

	"qinqin/internal/lang"
	"qinqin/internal/levels"
	"qinqin/internal/lexicon"
)

const maxEntryCharacters = 8

// characterReading is one reading of a character row: the first reading the
// entry carries, without the display-only extras.
type characterReading struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// characterRadical is the radical's entry id and written form.
type characterRadical struct {
	ID      int64  `json:"id"`
	Written string `json:"written"`
}

// entryCharacter is one Han character of a word, as the entry page's side
// column shows it: its own entry, first reading and gloss, radical, stroke
// count and levels.
type entryCharacter struct {
	ID      int64             `json:"id"`
	Written string            `json:"written"`
	Reading *characterReading `json:"reading"`
	Gloss   string            `json:"gloss"`
	Radical *characterRadical `json:"radical"`
	Strokes int               `json:"strokes"`
	Levels  []lookupLevel     `json:"levels"`
}

// entryCharacters returns the distinct Han characters of a Han-script word
// written form in order, at most eight, each resolved to the character
// entry with that written form. An entry that merely folds the form in as
// a traditional variant (复 holds 覆) is not the character the word
// writes: the resolution prefers the candidate whose own first form is the
// rune (lexicon.Best's own-character rule) and shows the rune. Rows are
// deduplicated by entry id (two forms can fold into one entry) and capped
// after that. A fixed number of queries serves any word length: ByForm,
// Radicals, one GetMany for the radicals and one levels query. Characters
// without an entry are left out.
func entryCharacters(ctx context.Context, sqlDB *sql.DB, e *lexicon.Entry) ([]entryCharacter, error) {
	out := []entryCharacter{}
	if e.Kind != "word" || lang.ProfileOf(e.Language).Script != lang.ScriptHan {
		return out, nil
	}
	seenRunes := map[rune]bool{}
	forms := make([]string, 0, maxEntryCharacters)
	for _, r := range e.Headword() {
		if !unicode.Is(unicode.Han, r) || seenRunes[r] {
			continue
		}
		seenRunes[r] = true
		forms = append(forms, string(r))
	}
	if len(forms) == 0 {
		return out, nil
	}
	store := lexicon.Store{DB: sqlDB}
	byForm, err := store.ByForm(ctx, e.Language, forms)
	if err != nil {
		return nil, err
	}
	type resolvedCharacter struct {
		written string
		entry   lexicon.Entry
	}
	resolved := make([]resolvedCharacter, 0, len(forms))
	seenEntries := map[int64]bool{}
	for _, form := range forms {
		// ByForm orders candidates by id; the first is the fallback, but a
		// candidate whose own first form is the rune wins (Best's rule).
		var picked *lexicon.Entry
		for i := range byForm[form] {
			candidate := &byForm[form][i]
			if candidate.Kind != "character" {
				continue
			}
			if picked == nil {
				picked = candidate
			}
			if candidate.Headword() == form ||
				(len(candidate.Forms) > 0 && candidate.Forms[0].Text == form) {
				picked = candidate
				break
			}
		}
		if picked == nil || seenEntries[picked.ID] {
			continue
		}
		seenEntries[picked.ID] = true
		resolved = append(resolved, resolvedCharacter{written: form, entry: *picked})
		if len(resolved) == maxEntryCharacters {
			break
		}
	}
	if len(resolved) == 0 {
		return out, nil
	}
	chars := make([]lexicon.Entry, len(resolved))
	ids := make([]int64, len(resolved))
	for i, r := range resolved {
		chars[i] = r.entry
		ids[i] = r.entry.ID
	}
	radicals, err := store.Radicals(ctx, ids)
	if err != nil {
		return nil, err
	}
	radicalIDs := make([]int64, 0, len(chars))
	for _, c := range chars {
		if id := radicals[c.ID]; id != 0 {
			radicalIDs = append(radicalIDs, id)
		}
	}
	radicalEntries := map[int64]lexicon.Entry{}
	if len(radicalIDs) > 0 {
		list, err := store.GetMany(ctx, radicalIDs)
		if err != nil {
			return nil, err
		}
		for _, r := range list {
			radicalEntries[r.ID] = r
		}
	}
	lv, err := levels.LowestPerScheme(ctx, sqlDB, ids)
	if err != nil {
		return nil, err
	}
	for i, c := range chars {
		item := entryCharacter{
			ID:      c.ID,
			Written: resolved[i].written,
			Gloss:   firstEntryGloss(c),
			Strokes: strokesOf(c),
			Levels:  levelViews(lv[c.ID]),
		}
		if len(c.Readings) > 0 {
			item.Reading = &characterReading{Type: c.Readings[0].Type, Value: c.Readings[0].Value}
		}
		if id := radicals[c.ID]; id != 0 {
			if r, ok := radicalEntries[id]; ok {
				item.Radical = &characterRadical{ID: r.ID, Written: r.Headword()}
			}
		}
		out = append(out, item)
	}
	return out, nil
}

// firstEntryGloss is the one gloss of a character (see firstGloss).
func firstEntryGloss(e lexicon.Entry) string {
	return lexicon.DisplayGloss(e.Senses, "")
}

func strokesOf(e lexicon.Entry) int {
	n, _ := strconv.Atoi(strings.TrimSpace(e.Attrs["strokes"]))
	return n
}
