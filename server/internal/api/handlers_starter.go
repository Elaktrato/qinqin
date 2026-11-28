package api

import (
	"net/http"
	"sort"

	"qinqin/internal/lexicon"
	"qinqin/internal/model"
	"qinqin/internal/starter"
)

type starterSetJSON struct {
	ID            string `json:"id"`
	Language      string `json:"language"`
	Name          string `json:"name"`
	License       string `json:"license"`
	Attribution   string `json:"attribution"`
	WordCount     int    `json:"wordCount"`
	HumanReviewed bool   `json:"humanReviewed"`
}

// handleListStarterSets serves GET /api/starter-sets: the Starter sets that ship with the server
// (docs/contracts/starter/). Public, like the pack lists: a set is a short word list, not user data.
func (s *server) handleListStarterSets(w http.ResponseWriter, r *http.Request) {
	sets, err := starter.Sets()
	if err != nil {
		writeInternal(w, r)
		return
	}
	out := make([]starterSetJSON, 0, len(sets))
	for _, set := range sets {
		out = append(out, starterSetJSON{set.ID, set.Language, set.Name, set.License, set.Attribution, len(set.Words), set.HumanReviewed})
	}
	writeJSON(w, http.StatusOK, out)
}

type starterSetEntryBody struct {
	model.EntryBase
	// Reading is the reading the set pins the word to ("" for none): a card copied from the set keeps it, and its
	// back shows only that reading's meanings (docs/contracts/senses).
	Reading string `json:"reading"`
	// Gloss is the entry's one gloss for that reading (the sense display rule), for the list that lets a learner
	// tell words apart.
	Gloss string `json:"gloss"`
	// PictureConcept is the picture the set expects for the word in its images pack; whether that pack is
	// installed is not known here (the client asks GET /api/images/entries/{id}).
	PictureConcept string `json:"pictureConcept"`
}

// handleStarterSet serves GET /api/starter-sets/{id}: the set's words resolved to dictionary entries in
// the set's order, with the base fields of GET /api/schemes/{id}/entries. A word the installed dictionaries
// lack is left out. Shared data (no overlay); signed-in users only, like the other starter decks.
func (s *server) handleStarterSet(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	sets, err := starter.Sets()
	if err != nil {
		writeInternal(w, r)
		return
	}
	var set *starter.Set
	for i := range sets {
		if sets[i].ID == r.PathValue("id") {
			set = &sets[i]
		}
	}
	if set == nil {
		writeError(w, http.StatusNotFound, "not_found", "No such starter set.")
		return
	}
	store := lexicon.Store{DB: s.db}
	resolved, err := starter.Resolve(r.Context(), starter.Lexicon{Store: store}, *set)
	if err != nil {
		writeInternal(w, r)
		return
	}
	entries := []starterSetEntryBody{}
	for start := 0; start < len(resolved); start += maxEntryBasesIDs {
		chunk := resolved[start:min(start+maxEntryBasesIDs, len(resolved))]
		ids := make([]int64, len(chunk))
		for i, rs := range chunk {
			ids[i] = rs.EntryID
		}
		es, err := store.GetMany(r.Context(), ids)
		if err != nil {
			writeInternal(w, r)
			return
		}
		bases, err := entryBases(r.Context(), store, es)
		if err != nil {
			writeInternal(w, r)
			return
		}
		byID := make(map[int64]starter.Word, len(chunk))
		for _, rs := range chunk {
			byID[rs.EntryID] = rs.Word
		}
		for i, b := range bases {
			word := byID[b.ID]
			// The deck shows, and a copy snapshots, the word as the set lists it: a kana row stays kana.
			b.Written = es[i].DisplayForm(word.Form)
			entries = append(entries, starterSetEntryBody{EntryBase: b, Reading: word.Reading,
				Gloss: lexicon.DisplayGloss(es[i].Senses, word.Reading), PictureConcept: word.Picture.Concept})
		}
	}
	// GetMany does not promise the order of ids: the set's order is the deck's order.
	order := make(map[int64]int, len(resolved))
	for i, rs := range resolved {
		order[rs.EntryID] = i
	}
	sortStarterEntries(entries, order)
	writeJSON(w, http.StatusOK, map[string]any{
		"id": set.ID, "language": set.Language, "name": set.Name, "license": set.License,
		"attribution": set.Attribution, "humanReviewed": set.HumanReviewed, "entries": entries,
	})
}

func sortStarterEntries(entries []starterSetEntryBody, order map[int64]int) {
	sort.SliceStable(entries, func(i, j int) bool { return order[entries[i].ID] < order[entries[j].ID] })
}
