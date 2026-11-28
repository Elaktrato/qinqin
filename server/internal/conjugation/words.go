package conjugation

import (
	"context"
	"database/sql"
	"fmt"
	"slices"

	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/model"
	"qinqin/internal/overlay"
)

// Language is the only language the engine conjugates.
const Language = "ja"

// FormAnswer is one accepted answer as the route serves it: written, kana
// and romaji (for the romanisation switch).
type FormAnswer struct {
	Written string `json:"written"`
	Reading string `json:"reading"`
	Romaji  string `json:"romaji"`
}

// Reading is one reading of the word as the route serves it.
type Reading struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// DrillWord is one entry of POST /api/drills/conjugation/words.
type DrillWord struct {
	ID       int64                   `json:"id"`
	Class    string                  `json:"class"`
	Written  string                  `json:"written"`
	Reading  string                  `json:"reading"`
	Readings []Reading               `json:"readings"`
	Families []string                `json:"families"`
	Forms    map[string][]FormAnswer `json:"forms"`
}

// Words are the drilled words among the entries ids for userID, in
// first-occurrence order: Japanese word entries with a class, conjugated on
// the headword and the first kana reading after the user's own entry patch
// (as POST /api/entries/bases), the entry's other spellings accepted.
// Unknown, other-language, non-word and not drilled entries are absent.
func Words(ctx context.Context, db *sql.DB, userID int64, ids []int64) ([]DrillWord, error) {
	entries, err := lexicon.Store{DB: db}.GetMany(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := []DrillWord{}
	seen := map[int64]bool{}
	for _, e := range entries {
		if seen[e.ID] || e.Language != Language || e.Kind != "word" {
			continue
		}
		seen[e.ID] = true
		pos := make([][]string, len(e.Senses))
		for i, s := range e.Senses {
			pos[i] = s.POS
		}
		class := Classify(pos)
		if class == "" {
			continue
		}
		base := model.EntryBase{ID: e.ID, Written: e.Headword()}
		for _, r := range e.Readings {
			base.Readings = append(base.Readings, model.Reading{Type: r.Type, Value: r.Value, Plain: r.Plain, Ord: r.Ord})
		}
		if err := overlay.Apply(ctx, db, userID, &base); err != nil {
			return nil, fmt.Errorf("conjugation words: %w", err)
		}
		kana := ""
		for _, r := range base.Readings {
			if r.Type == "kana" {
				kana = r.Value
				break
			}
		}
		var spellings []string
		for _, f := range e.Forms {
			if f.Text != base.Written && !slices.Contains(f.Flags, "sK") && !slices.Contains(spellings, f.Text) {
				spellings = append(spellings, f.Text)
			}
		}
		w, ok := Conjugate(class, base.Written, kana, spellings...)
		if !ok {
			continue
		}
		dw := DrillWord{ID: e.ID, Class: class, Written: base.Written, Reading: kana, Readings: []Reading{},
			Families: w.Families, Forms: map[string][]FormAnswer{}}
		for _, r := range base.Readings {
			dw.Readings = append(dw.Readings, Reading{Type: r.Type, Value: r.Value})
		}
		for id, answers := range w.Forms {
			list := make([]FormAnswer, len(answers))
			for i, a := range answers {
				list[i] = FormAnswer{Written: a.Written, Reading: a.Reading, Romaji: romaji(a.Reading)}
			}
			dw.Forms[id] = list
		}
		out = append(out, dw)
	}
	return out, nil
}

// romaji is the romaji of a kana reading by the Japanese pack's rule.
func romaji(kana string) string {
	for _, r := range (lang.Ja{}).DeriveReadings([]model.Reading{{Type: "kana", Value: kana}}) {
		if r.Type == "romaji" {
			return r.Value
		}
	}
	return ""
}
