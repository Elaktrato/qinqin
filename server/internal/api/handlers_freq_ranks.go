package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"qinqin/internal/freq"
	"qinqin/internal/lexicon"
	"qinqin/internal/model"
)

// rankPackBody names the ranking pack of POST /api/entries/frequency-ranks
// with the credits a starter deck shows.
type rankPackBody struct {
	ID          int64  `json:"id"`
	PackID      string `json:"packId"`
	Name        string `json:"name"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
}

type entryRankBody struct {
	ID   int64 `json:"id"`
	Rank int   `json:"rank"`
}

// handleFrequencyRanks serves POST /api/entries/frequency-ranks
// {"language","ids"}: each entry's rank in the language's ranking pack
// (its first installed frequency pack by priority), in first-occurrence
// order. Entries without data in that pack, of another language or
// unknown are omitted; pack is null (and ranks empty) when the language
// has no pack. It reads shared data only: every user gets the same
// answer. A new-card order "most frequent first" asks only for the
// entries of new cards (docs/contracts/frequency/README.md).
func (s *server) handleFrequencyRanks(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	body, ok := readBody(w, r, maxEntryBasesBody)
	if !ok {
		return
	}
	var req struct {
		Language string  `json:"language"`
		IDs      []int64 `json:"ids"`
	}
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&req); err != nil ||
		len(req.IDs) == 0 || len(req.IDs) > maxEntryBasesIDs {
		writeError(w, http.StatusBadRequest, "bad_request", "Ids must be 1 to 500 entry ids.")
		return
	}
	seen := make(map[int64]bool, len(req.IDs))
	ids := make([]int64, 0, len(req.IDs))
	for _, id := range req.IDs {
		if id <= 0 {
			writeError(w, http.StatusBadRequest, "bad_request", "Ids must be 1 to 500 entry ids.")
			return
		}
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	language := strings.ToLower(strings.TrimSpace(req.Language))
	if language == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "Language is required.")
		return
	}
	es, err := lexicon.Store{DB: s.db}.GetMany(r.Context(), ids)
	if err != nil {
		writeInternal(w, r)
		return
	}
	mine := es[:0:0]
	for _, e := range es {
		if e.Language == language {
			mine = append(mine, e)
		}
	}
	pack, ranks, err := s.lookupService().EntryRanks(r.Context(), language, mine)
	if err != nil {
		writeInternal(w, r)
		return
	}
	out := struct {
		Pack  *rankPackBody   `json:"pack"`
		Ranks []entryRankBody `json:"ranks"`
	}{Ranks: []entryRankBody{}}
	if pack != nil {
		out.Pack = &rankPackBody{ID: pack.ID, PackID: pack.PackID, Name: pack.Name,
			License: pack.License, Attribution: pack.Attribution}
		for i, e := range mine {
			if ranks[i] > 0 {
				out.Ranks = append(out.Ranks, entryRankBody{ID: e.ID, Rank: ranks[i]})
			}
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// starterSizes are the starter deck sizes GET /api/frequency-packs/{id}/top
// serves.
var starterSizes = map[string]int{"500": 500, "1000": 1000, "2000": 2000}

type starterEntryBody struct {
	model.EntryBase
	Rank int `json:"rank"`
	// Gloss is the first gloss of the entry's first sense ("" without one):
	// a list tells two words of one display form apart by it (なる 成る / 生る).
	Gloss string `json:"gloss"`
}

// firstGloss is the first gloss of e's first sense, "" without one.
func firstGloss(e lexicon.Entry) string {
	if len(e.Senses) == 0 || len(e.Senses[0].Glosses) == 0 {
		return ""
	}
	return e.Senses[0].Glosses[0]
}

// handleFrequencyTop serves GET /api/frequency-packs/{id}/top?size=: the
// starter deck "Top <size>" of an installed frequency pack, its words in
// deck order with the base fields of GET /api/schemes/{id}/entries and
// the rank of the row that took each. Resolution is freq.Store.Top; the
// top 2000 is resolved once per pack content (s.freqTop). Shared data,
// no overlay: every user gets the same answer. Signed in because the
// first call per pack is expensive.
func (s *server) handleFrequencyTop(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	size, ok := starterSizes[r.URL.Query().Get("size")]
	if !ok {
		writeError(w, http.StatusBadRequest, "bad_request", "Size must be 500, 1000 or 2000.")
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "No such frequency pack.")
		return
	}
	fs := freq.Store{DB: s.db}
	packs, err := fs.Packs(r.Context())
	if err != nil {
		writeInternal(w, r)
		return
	}
	var pack *freq.PackInfo
	for i := range packs {
		if packs[i].ID == id {
			pack = &packs[i]
		}
	}
	if pack == nil {
		writeError(w, http.StatusNotFound, "not_found", "No such frequency pack.")
		return
	}
	store := lexicon.Store{DB: s.db}
	// A dictionary install or edit changes what the rows resolve to and the
	// entries' base fields: the lexicon version is part of every cache key.
	version, err := store.CharactersVersion(r.Context())
	if err != nil {
		writeInternal(w, r)
		return
	}
	key := starterBodyKey{pack.ID, pack.ContentHash, version, size}
	if body, ok := s.freqTopBodies.get(key); ok {
		writeRawJSON(w, body)
		return
	}
	top, err := s.freqTop.Get(r.Context(), fs, freq.StarterResolver{Lexicon: store}, *pack, version, size)
	if err != nil {
		writeInternal(w, r)
		return
	}
	ids := make([]int64, len(top))
	byID := make(map[int64]freq.TopEntry, len(top))
	for i, t := range top {
		ids[i] = t.EntryID
		byID[t.EntryID] = t
	}
	entries := []starterEntryBody{}
	for start := 0; start < len(ids); start += maxEntryBasesIDs {
		es, err := store.GetMany(r.Context(), ids[start:min(start+maxEntryBasesIDs, len(ids))])
		if err != nil {
			writeInternal(w, r)
			return
		}
		bases, err := entryBases(r.Context(), store, es)
		if err != nil {
			writeInternal(w, r)
			return
		}
		for i, b := range bases {
			// The deck shows, and a copy snapshots, the row's kana when it
			// is a reading of the entry (freq.Written).
			b.Written = freq.Written(es[i], byID[b.ID])
			entries = append(entries, starterEntryBody{EntryBase: b, Rank: byID[b.ID].Rank, Gloss: firstGloss(es[i])})
		}
	}
	body, err := json.Marshal(struct {
		PackID  string             `json:"packId"`
		Name    string             `json:"name"`
		Size    int                `json:"size"`
		Entries []starterEntryBody `json:"entries"`
	}{pack.PackID, pack.Name, size, entries})
	if err != nil {
		writeInternal(w, r)
		return
	}
	s.freqTopBodies.put(key, body)
	writeRawJSON(w, body)
}

func writeRawJSON(w http.ResponseWriter, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(body)
}

// starterBodyKey identifies one answer of GET /api/frequency-packs/{id}/top:
// the pack's content, the lexicon version and the size.
type starterBodyKey struct {
	pack    int64
	hash    string
	lexicon string
	size    int
}

// starterBodies keeps the latest answer per (pack, size) — the shared
// response has no per-user data — so a cached deck is not rebuilt from
// 2000 entry loads per request. An answer under an older key is replaced.
type starterBodies struct {
	mu     sync.Mutex
	bodies map[[2]int64]starterBody
}

type starterBody struct {
	key  starterBodyKey
	body []byte
}

func (c *starterBodies) get(key starterBodyKey) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	b, ok := c.bodies[[2]int64{key.pack, int64(key.size)}]
	if !ok || b.key != key {
		return nil, false
	}
	return b.body, true
}

func (c *starterBodies) put(key starterBodyKey, body []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.bodies == nil {
		c.bodies = map[[2]int64]starterBody{}
	}
	c.bodies[[2]int64{key.pack, int64(key.size)}] = starterBody{key, body}
}
