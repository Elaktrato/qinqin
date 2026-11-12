package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"qinqin/internal/library"
	"qinqin/internal/library/epub"
	"qinqin/internal/library/sources"
)

const (
	// importTimeout bounds one whole import: catalog, download, parse, store.
	importTimeout = 60 * time.Second
	// maxImportBody caps the {"sourceId"} request body.
	maxImportBody = 1 << 10
	// maxSourceIDLen caps a sourceId; real ones are a few digits.
	maxSourceIDLen = 64

	defaultSearchLimit = 25
	maxSearchLimit     = 100
)

// sourceInfo is how a known source is presented to clients; a source
// not listed here shows under its id with no languages.
var sourceInfo = map[string]struct {
	name      string
	languages []string
}{
	"aozora":    {"Aozora Bunko", []string{"ja"}},
	"gutenberg": {"Project Gutenberg", []string{"zh", "ja"}},
}

// source returns the source named by the {source} path value, or answers
// 404 itself.
func (s *server) source(w http.ResponseWriter, r *http.Request) (sources.Source, bool) {
	for _, src := range s.sources {
		if src.ID() == r.PathValue("source") {
			return src, true
		}
	}
	http.Error(w, "unknown source", http.StatusNotFound)
	return nil, false
}

// handleListSources serves GET /api/library/sources.
func (s *server) handleListSources(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	type entry struct {
		ID        string   `json:"id"`
		Name      string   `json:"name"`
		Languages []string `json:"languages"`
	}
	out := make([]entry, 0, len(s.sources))
	for _, src := range s.sources {
		e := entry{ID: src.ID(), Name: src.ID(), Languages: []string{}}
		if info, ok := sourceInfo[e.ID]; ok {
			e.Name, e.Languages = info.name, info.languages
		}
		out = append(out, e)
	}
	writeJSON(w, http.StatusOK, out)
}

// handleSearchSource serves GET /api/library/sources/{source}/search.
func (s *server) handleSearchSource(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	src, ok := s.source(w, r)
	if !ok {
		return
	}
	limit := defaultSearchLimit
	if r.URL.Query().Has("limit") {
		n, err := strconv.Atoi(r.URL.Query().Get("limit"))
		if err != nil || n < 0 {
			http.Error(w, "limit must be a non-negative integer", http.StatusBadRequest)
			return
		}
		if n > 0 {
			limit = min(n, maxSearchLimit)
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), importTimeout)
	defer cancel()
	results, err := src.Search(ctx, r.URL.Query().Get("q"), limit)
	if err != nil {
		sourceError(w, err)
		return
	}
	if results == nil {
		results = []sources.Result{}
	}
	writeJSON(w, http.StatusOK, results)
}

// sourceError maps a source failure to a response. Messages are fixed
// strings: errors from the source may carry URLs or addresses.
func sourceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, sources.ErrNotFound):
		http.Error(w, "work not found in source", http.StatusNotFound)
	case errors.Is(err, epub.ErrInvalid):
		http.Error(w, "the source's epub is not readable", http.StatusUnprocessableEntity)
	default:
		http.Error(w, "the source is unavailable, try again later", http.StatusBadGateway)
	}
}

// startImport reserves the user's single import slot.
func (s *server) startImport(userID int64) bool {
	s.importMu.Lock()
	defer s.importMu.Unlock()
	if s.importing[userID] {
		return false
	}
	if s.importing == nil {
		s.importing = map[int64]bool{}
	}
	s.importing[userID] = true
	return true
}

func (s *server) endImport(userID int64) {
	s.importMu.Lock()
	delete(s.importing, userID)
	s.importMu.Unlock()
}

// handleImportSource serves POST /api/library/sources/{source}/import
// with the body {"sourceId": string}.
func (s *server) handleImportSource(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	src, ok := s.source(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxImportBody)
	var in struct {
		SourceID string `json:"sourceId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		badBody(w, err)
		return
	}
	if in.SourceID == "" || len(in.SourceID) > maxSourceIDLen {
		http.Error(w, "sourceId required", http.StatusBadRequest)
		return
	}
	if !s.startImport(u.ID) {
		http.Error(w, "another import is already running", http.StatusTooManyRequests)
		return
	}
	defer s.endImport(u.ID)

	ctx, cancel := context.WithTimeout(r.Context(), importTimeout)
	defer cancel()
	store := s.library()

	// Skip the download when the work is already in the library; the
	// unique constraint below still decides races.
	books, err := store.List(ctx, u.ID)
	if err != nil {
		libraryError(w, err)
		return
	}
	for _, b := range books {
		if b.Source == src.ID() && b.SourceID == in.SourceID {
			libraryError(w, library.ErrDuplicate)
			return
		}
	}

	imp, err := src.Fetch(ctx, in.SourceID)
	if err != nil {
		sourceError(w, err)
		return
	}
	imp.Meta.UserID = u.ID
	book, err := store.Create(ctx, imp.Meta, imp.Chapters)
	if err != nil {
		if ctx.Err() != nil {
			sourceError(w, ctx.Err())
			return
		}
		libraryError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, book)
}
