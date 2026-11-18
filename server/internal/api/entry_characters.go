package api

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"unicode"

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

// entryCharacters returns the distinct Han characters of a zh/ja word's
// written form in order, at most eight, each resolved to the character
// entry with that written form (lowest id). A fixed number of queries
// serves any word length: ByForm, Radicals, one GetMany for the radicals
// and one levels query. Characters without an entry are left out.
func entryCharacters(ctx context.Context, sqlDB *sql.DB, e *lexicon.Entry) ([]entryCharacter, error) {
	out := []entryCharacter{}
	if e.Kind != "word" || (e.Language != "zh" && e.Language != "ja") {
		return out, nil
	}
	seen := map[rune]bool{}
	forms := make([]string, 0, maxEntryCharacters)
	for _, r := range e.Headword() {
		if !unicode.Is(unicode.Han, r) || seen[r] {
			continue
		}
		seen[r] = true
		forms = append(forms, string(r))
		if len(forms) == maxEntryCharacters {
			break
		}
	}
	if len(forms) == 0 {
		return out, nil
	}
	store := lexicon.Store{DB: sqlDB}
	byForm, err := store.ByForm(ctx, e.Language, forms)
	if err != nil {
		return nil, err
	}
	chars := make([]lexicon.Entry, 0, len(forms))
	for _, form := range forms {
		for _, candidate := range byForm[form] {
			if candidate.Kind == "character" {
				chars = append(chars, candidate)
				break
			}
		}
	}
	if len(chars) == 0 {
		return out, nil
	}
	ids := make([]int64, len(chars))
	for i, c := range chars {
		ids[i] = c.ID
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
	for _, c := range chars {
		item := entryCharacter{
			ID:      c.ID,
			Written: c.Headword(),
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

func firstEntryGloss(e lexicon.Entry) string {
	for _, sense := range e.Senses {
		if len(sense.Glosses) > 0 {
			return sense.Glosses[0]
		}
	}
	return ""
}

func strokesOf(e lexicon.Entry) int {
	n, _ := strconv.Atoi(strings.TrimSpace(e.Attrs["strokes"]))
	return n
}
