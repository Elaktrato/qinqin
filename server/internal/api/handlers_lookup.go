package api

import (
	"log"
	"net/http"
	"slices"
	"strconv"
	"unicode/utf8"

	"qinqin/internal/freq"
	"qinqin/internal/lexicon"
	"qinqin/internal/lookup"
)

// lookupKinds are the values of the repeatable kind parameter.
var lookupKinds = []string{"word", "character"}

type lookupForm struct {
	Text  string   `json:"text"`
	Flags []string `json:"flags"`
}

type lookupReading struct {
	Type  string   `json:"type"`
	Value string   `json:"value"`
	Plain string   `json:"plain"`
	Flags []string `json:"flags"` // JMdict re_inf (sk, ik, ...): input of the display form rule
}

type lookupFrequency struct {
	PackID   int64  `json:"packId"`
	PackName string `json:"packName"`
	Rank     int    `json:"rank"`
	Display  string `json:"display,omitempty"`
}

type lookupLevel struct {
	Scheme string `json:"scheme"`
	Level  string `json:"level"`
}

type lookupSense struct {
	DictionaryID   int64    `json:"dictionaryId"`
	DictionaryName string   `json:"dictionaryName"`
	POS            []string `json:"pos"`
	Tags           []string `json:"tags"`
	Glosses        []string `json:"glosses"`
	Xrefs          []string `json:"xrefs"`
}

// lookupResult is the wire form of lookup.Result; its slices are never nil.
type lookupResult struct {
	EntryID     int64             `json:"entryId"`
	Kind        string            `json:"kind"`
	Term        string            `json:"term"`
	Reading     string            `json:"reading"`
	Forms       []lookupForm      `json:"forms"`
	Readings    []lookupReading   `json:"readings"`
	Matched     string            `json:"matched"`
	Start       int               `json:"start"`
	End         int               `json:"end"`
	Reasons     []string          `json:"reasons"`
	Tags        []string          `json:"tags"`
	Frequencies []lookupFrequency `json:"frequencies"`
	Senses      []lookupSense     `json:"senses"`
	Pri         int               `json:"pri"`
	// Levels: the entry's lowest level per installed levels scheme.
	Levels []lookupLevel `json:"levels"`
}

// nonNil returns s, or an empty slice for nil, so it encodes as [].
func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func toLookupResult(r lookup.Result) lookupResult {
	out := lookupResult{
		EntryID: r.EntryID, Kind: r.Kind, Term: r.Term, Reading: r.Reading,
		Forms:    make([]lookupForm, 0, len(r.Forms)),
		Readings: make([]lookupReading, 0, len(r.Readings)),
		Matched:  r.Matched, Start: r.Start, End: r.End,
		Reasons: nonNil(r.Reasons), Tags: nonNil(r.Tags),
		Frequencies: make([]lookupFrequency, 0, len(r.Frequencies)),
		Senses:      make([]lookupSense, 0, len(r.Senses)),
		Pri:         r.Pri,
		Levels:      make([]lookupLevel, 0, len(r.Levels)),
	}
	for _, l := range r.Levels {
		out.Levels = append(out.Levels, lookupLevel{Scheme: l.SchemeName, Level: l.LevelName})
	}
	for _, f := range r.Forms {
		out.Forms = append(out.Forms, lookupForm{Text: f.Text, Flags: nonNil(f.Flags)})
	}
	for _, rd := range r.Readings {
		out.Readings = append(out.Readings, lookupReading{Type: rd.Type, Value: rd.Value, Plain: rd.Plain, Flags: nonNil(rd.Flags)})
	}
	for _, f := range r.Frequencies {
		out.Frequencies = append(out.Frequencies, lookupFrequency{PackID: f.PackID, PackName: f.PackName, Rank: f.Rank, Display: f.Display})
	}
	for _, s := range r.Senses {
		out.Senses = append(out.Senses, lookupSense{
			DictionaryID: s.DictionaryID, DictionaryName: s.DictionaryName,
			POS: nonNil(s.POS), Tags: nonNil(s.Tags), Glosses: nonNil(s.Glosses), Xrefs: nonNil(s.Xrefs),
		})
	}
	return out
}

// handleLookup serves GET /api/lookup?lang=&text=&offset=&kind= with the
// ranked dictionary entries for the text at the code-point offset, as
// {"results": [...]}. The route is public. lang, text and an integer
// offset are required and kind (word or character, repeatable) is
// optional, otherwise 400; text over maxLookupRunes is 413. An offset
// outside the text is not an error: it finds nothing.
func (s *server) handleLookup(w http.ResponseWriter, r *http.Request) {
	params := r.URL.Query()
	language, text := params.Get("lang"), params.Get("text")
	offset, err := strconv.Atoi(params.Get("offset"))
	if language == "" || text == "" || err != nil {
		http.Error(w, "lang, text and integer offset required", http.StatusBadRequest)
		return
	}
	if !segmentable(language) {
		http.Error(w, "unsupported language", http.StatusBadRequest)
		return
	}
	kinds := params["kind"]
	for _, k := range kinds {
		if !slices.Contains(lookupKinds, k) {
			http.Error(w, "kind must be word or character", http.StatusBadRequest)
			return
		}
	}
	if utf8.RuneCountInString(text) > maxLookupRunes {
		http.Error(w, "text too long", http.StatusRequestEntityTooLarge)
		return
	}
	svc := s.lookupService()
	svc.WithLevels = true
	found, err := svc.Lookup(r.Context(), language, text, offset, kinds)
	if err != nil {
		log.Printf("lookup %s: %v", language, err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	results := make([]lookupResult, 0, len(found))
	for _, f := range found {
		results = append(results, toLookupResult(f))
	}
	writeJSON(w, http.StatusOK, map[string][]lookupResult{"results": results})
}

// lookupService is the lookup engine over the server's database.
func (s *server) lookupService() lookup.Service {
	return lookup.Service{Lexicon: lexicon.Store{DB: s.db}, Freq: freq.Store{DB: s.db}, DB: s.db}
}
