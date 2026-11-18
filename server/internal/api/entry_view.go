package api

import (
	"context"
	"database/sql"
	"fmt"

	"qinqin/internal/levels"
	"qinqin/internal/lexicon"
	"qinqin/internal/model"
	"qinqin/internal/sentences"
)

// entryResponse is the body of GET and PUT /api/entries/{id}: a lexicon
// entry's base fields (headword, flattened readings, attrs, radical)
// with its written forms, its senses twice — Senses one row per gloss
// (the flat shape the web's entry page and flashcards read), SenseGroups
// one row per sense with part of speech, tags and cross-references — and
// its variants, scheme badges and example sentences. Senses are ordered
// by dictionary, then sense order, then gloss order. A user's overlay
// patches the embedded EntryBase only (written and readings); Forms,
// Senses and SenseGroups always show the SHARED dictionary values, so
// a patched written form need not appear among forms.
type entryResponse struct {
	model.EntryBase
	Forms       []formView        `json:"forms"`
	Senses      []model.SenseView `json:"senses"`
	SenseGroups []senseGroup      `json:"senseGroups"`
	Variants    []model.EntryBase `json:"variants"`
	Badges      []model.Badge     `json:"badges"`
	Sentences   []model.Sentence  `json:"sentences"`
	Characters  []entryCharacter  `json:"characters"`
}

// formView is one written form of an entry: its text, its source flags
// (rK, oK, trad, ...) and its ranking score when it has one.
type formView struct {
	Text  string   `json:"text"`
	Flags []string `json:"flags"`
	Pri   int      `json:"pri,omitempty"`
}

// senseGroup is one sense of an entry as one dictionary gives it, with
// the dictionary's credit line.
type senseGroup struct {
	DictionaryID   int64    `json:"dictionaryId"`
	DictionaryName string   `json:"dictionaryName"`
	PackID         string   `json:"packId"`
	License        string   `json:"license"`
	Attribution    string   `json:"attribution"`
	POS            []string `json:"pos"`
	Tags           []string `json:"tags"`
	Glosses        []string `json:"glosses"`
	Xrefs          []string `json:"xrefs"`
}

// searchGloss is the first gloss of one dictionary for a search hit.
type searchGloss struct {
	DictionaryID int64  `json:"dictionaryId"`
	Gloss        string `json:"gloss"`
}

// searchHit is one element of GET /api/search: the entry's base fields,
// why it matched ("written", "gloss", or a reading type), the first gloss
// of each dictionary and the lowest level per scheme.
type searchHit struct {
	model.EntryBase
	Source  string        `json:"source"`
	Glosses []searchGloss `json:"glosses"`
	Levels  []lookupLevel `json:"levels"`
}

// entryBase maps a lexicon entry onto the API's base view: Written is
// the display form (lexicon.Entry.Headword), readings keep their
// stored order, attrs are never nil, and radicalID is the radical entry
// a character is classified under (nil for none).
func entryBase(e lexicon.Entry, radicalID *int64) model.EntryBase {
	b := model.EntryBase{
		ID:        e.ID,
		Language:  e.Language,
		Kind:      e.Kind,
		Written:   e.Headword(),
		Readings:  make([]model.Reading, 0, len(e.Readings)),
		Attrs:     e.Attrs,
		RadicalID: radicalID,
		UpdatedAt: e.UpdatedAt,
	}
	if b.Attrs == nil {
		b.Attrs = map[string]string{}
	}
	for _, r := range e.Readings {
		b.Readings = append(b.Readings, model.Reading{Type: r.Type, Value: r.Value, Plain: r.Plain, Ord: r.Ord})
	}
	return b
}

// entryBases maps lexicon entries onto base views in order, filling each
// character's radical with one query. It returns a non-nil slice.
func entryBases(ctx context.Context, store lexicon.Store, es []lexicon.Entry) ([]model.EntryBase, error) {
	ids := make([]int64, len(es))
	for i, e := range es {
		ids[i] = e.ID
	}
	radicals, err := store.Radicals(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make([]model.EntryBase, 0, len(es))
	for _, e := range es {
		var rad *int64
		if r, ok := radicals[e.ID]; ok {
			rad = &r
		}
		out = append(out, entryBase(e, rad))
	}
	return out, nil
}

// buildEntryResponse assembles the full entry body of e: base fields,
// forms, senses and sense groups (with their dictionaries' credit
// lines), variants, badges and the sentences viewerID may see (pack
// sentences plus the viewer's own; 0 for an anonymous caller). A user's
// overlay is applied by the caller on the returned EntryBase.
func buildEntryResponse(ctx context.Context, sqlDB *sql.DB, e *lexicon.Entry, viewerID int64) (*entryResponse, error) {
	store := lexicon.Store{DB: sqlDB}
	bases, err := entryBases(ctx, store, []lexicon.Entry{*e})
	if err != nil {
		return nil, fmt.Errorf("entry %d: %w", e.ID, err)
	}
	resp := &entryResponse{
		EntryBase:   bases[0],
		Forms:       make([]formView, 0, len(e.Forms)),
		Senses:      []model.SenseView{},
		SenseGroups: make([]senseGroup, 0, len(e.Senses)),
	}
	for _, f := range e.Forms {
		resp.Forms = append(resp.Forms, formView{Text: f.Text, Flags: f.Flags, Pri: f.Pri})
	}

	dicts, err := dictionaryCredits(ctx, sqlDB, e.Senses)
	if err != nil {
		return nil, fmt.Errorf("entry %d: %w", e.ID, err)
	}
	for _, sn := range e.Senses {
		d := dicts[sn.DictionaryID]
		resp.SenseGroups = append(resp.SenseGroups, senseGroup{
			DictionaryID: d.ID, DictionaryName: d.Name, PackID: d.PackID, License: d.License, Attribution: d.Attribution,
			POS: sn.POS, Tags: sn.Tags, Glosses: sn.Glosses, Xrefs: sn.Xrefs,
		})
		for _, g := range sn.Glosses {
			resp.Senses = append(resp.Senses, model.SenseView{
				DictionaryID: d.ID, DictionaryName: d.Name, PackID: d.PackID, License: d.License, Attribution: d.Attribution,
				Gloss: g,
			})
		}
	}

	variants, err := store.Variants(ctx, e.ID)
	if err != nil {
		return nil, err
	}
	if resp.Variants, err = entryBases(ctx, store, variants); err != nil {
		return nil, fmt.Errorf("variants of entry %d: %w", e.ID, err)
	}
	if resp.Badges, err = levels.ForEntry(ctx, sqlDB, e.ID); err != nil {
		return nil, err
	}
	if resp.Sentences, err = sentences.ForEntry(ctx, sqlDB, e.ID, viewerID); err != nil {
		return nil, err
	}
	if resp.Characters, err = entryCharacters(ctx, sqlDB, e); err != nil {
		return nil, err
	}
	return resp, nil
}

// dictionaryCredits loads the dictionaries rows the senses come from,
// keyed by id. Senses only load for active dictionaries, so every id is
// found.
func dictionaryCredits(ctx context.Context, sqlDB *sql.DB, senses []lexicon.Sense) (map[int64]model.Dictionary, error) {
	out := map[int64]model.Dictionary{}
	for _, sn := range senses {
		if _, ok := out[sn.DictionaryID]; ok {
			continue
		}
		var d model.Dictionary
		if err := sqlDB.QueryRowContext(ctx, `
			SELECT id, pack_id, name, license, attribution FROM dictionaries WHERE id = ?`,
			sn.DictionaryID).Scan(&d.ID, &d.PackID, &d.Name, &d.License, &d.Attribution); err != nil {
			return nil, fmt.Errorf("dictionary %d: %w", sn.DictionaryID, err)
		}
		out[sn.DictionaryID] = d
	}
	return out, nil
}
