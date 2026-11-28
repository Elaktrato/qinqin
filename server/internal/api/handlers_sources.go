package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"time"

	"qinqin/internal/library"
	"qinqin/internal/library/epub"
	"qinqin/internal/library/sources"
	"qinqin/internal/library/sources/graded"
	"qinqin/internal/studyday"
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

	defaultBrowseLimit = 12
	maxBrowseLimit     = 50
	maxBrowseSeedLen   = 64
	maxLanguageLen     = 16
)

// sourceInfo is how a known source is presented to clients; a source
// not listed here shows under its id with no languages.
var sourceInfo = map[string]struct {
	name      string
	languages []string
}{
	graded.SourceID: {"Graded readers", graded.Languages()},
	"aozora":        {"Aozora Bunko", []string{"ja"}},
	"gutenberg":     {"Project Gutenberg", []string{"zh", "ja"}},
}

// source returns the source named by the {source} path value, or answers
// 404 itself.
func (s *server) source(w http.ResponseWriter, r *http.Request) (sources.Source, bool) {
	for _, src := range s.sources {
		if src.ID() == r.PathValue("source") {
			return src, true
		}
	}
	writeError(w, http.StatusNotFound, "not_found", "Unknown source.")
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
			writeError(w, http.StatusBadRequest, "bad_request", "limit must be a non-negative integer.")
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

// handleBrowseSource serves GET /api/library/sources/{source}/browse
// ?language=&seed=&limit=: an assortment of the source's works in the
// language ("" for any), the same for the same seed (default: the
// caller's learner date today) and another for another seed. limit
// defaults to 12 and is clamped to 1..50. A source without an assortment is a 501; a language
// the source holds no books of is an empty list.
func (s *server) handleBrowseSource(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	src, ok := s.source(w, r)
	if !ok {
		return
	}
	b, ok := src.(sources.Browser)
	if !ok {
		writeError(w, http.StatusNotImplemented, "not_implemented", "This source has no browse assortment.")
		return
	}
	q := r.URL.Query()
	limit := defaultBrowseLimit
	if q.Has("limit") {
		n, err := strconv.Atoi(q.Get("limit"))
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "limit must be an integer.")
			return
		}
		limit = min(max(n, 1), maxBrowseLimit)
	}
	language := q.Get("language")
	if !validLanguageParam(language) {
		writeError(w, http.StatusBadRequest, "bad_request", "language must be a language code such as ja or zh.")
		return
	}
	seed := q.Get("seed")
	if len(seed) > maxBrowseSeedLen {
		writeError(w, http.StatusBadRequest, "bad_request", "seed too long.")
		return
	}
	if seed == "" {
		hist, _, err := studyday.Load(r.Context(), s.db, u.ID)
		if err != nil {
			writeInternal(w, r)
			return
		}
		seed = hist.DayOf(s.now()).String()
	}
	if language != "" && !sourceServes(src.ID(), language) {
		writeJSON(w, http.StatusOK, []sources.Result{})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), importTimeout)
	defer cancel()
	results, err := b.Browse(ctx, language, seed, limit)
	if err != nil {
		sourceError(w, err)
		return
	}
	if results == nil {
		results = []sources.Result{}
	}
	writeJSON(w, http.StatusOK, results)
}

// validLanguageParam accepts "" or a short code of lowercase letters,
// digits and hyphens.
func validLanguageParam(s string) bool {
	if len(s) > maxLanguageLen {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return true
}

// sourceError maps a source failure to a response. Messages are fixed
// strings: errors from the source may carry URLs or addresses.
func sourceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, sources.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Work not found in source.")
	case errors.Is(err, epub.ErrInvalid):
		writeError(w, http.StatusUnprocessableEntity, "epub_unreadable", "The source's epub is not readable.")
	default:
		writeError(w, http.StatusBadGateway, "source_unavailable", "The source is unavailable, try again later.")
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

// sourceServes reports whether a source can hold books of language: a
// source without listed languages may hold any.
func sourceServes(sourceID, language string) bool {
	info, ok := sourceInfo[sourceID]
	return !ok || slices.Contains(info.languages, language)
}

// handleGradedCatalogue serves GET /api/library/graded?language=: the graded readers' catalogue
// (docs/contracts/graded/README.md, Catalogue), every language or one; a language without texts is an empty list.
func (s *server) handleGradedCatalogue(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	language := r.URL.Query().Get("language")
	if !validLanguageParam(language) {
		writeError(w, http.StatusBadRequest, "bad_request", "language must be a language code such as ja or zh.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"texts": graded.Catalogue(language)})
}

// handleImportSource serves POST /api/library/sources/{source}/import
// with the body {"sourceId": string, "workspaceId": number}: the work is
// stored in the library of that workspace of the caller (404 when it is
// not the caller's), whose language the work must have (422 otherwise).
// A work already in that workspace is a 409; another workspace may hold
// its own copy.
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
		SourceID    string `json:"sourceId"`
		WorkspaceID int64  `json:"workspaceId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		badBody(w, err)
		return
	}
	if in.SourceID == "" || len(in.SourceID) > maxSourceIDLen {
		writeError(w, http.StatusBadRequest, "bad_request", "sourceId required.")
		return
	}
	if in.WorkspaceID <= 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "workspaceId required.")
		return
	}
	store := s.library()
	wsLang, err := store.WorkspaceLanguage(r.Context(), u.ID, in.WorkspaceID)
	if err != nil {
		libraryError(w, err)
		return
	}
	// A source without books of the workspace's language is refused
	// before anything is downloaded.
	if !sourceServes(src.ID(), wsLang) {
		writeError(w, http.StatusUnprocessableEntity, "source_language_unavailable", "This source has no books in the workspace language "+wsLang+".")
		return
	}
	if !s.startImport(u.ID) {
		writeError(w, http.StatusTooManyRequests, "import_busy", "Another import is already running.")
		return
	}
	defer s.endImport(u.ID)

	ctx, cancel := context.WithTimeout(r.Context(), importTimeout)
	defer cancel()

	// Skip the download when the work is already in the workspace; the
	// unique constraint below still decides races.
	has, err := store.HasSource(ctx, u.ID, in.WorkspaceID, src.ID(), in.SourceID)
	if err != nil {
		libraryError(w, err)
		return
	}
	if has {
		libraryError(w, library.ErrDuplicate)
		return
	}

	// A source that knows the work's language from its catalog has a
	// mismatch refused before the download; Create below stays the check
	// for sources that cannot tell (or a catalog without a language).
	if d, ok := src.(sources.Describer); ok {
		res, err := d.Describe(ctx, in.SourceID)
		if err != nil {
			sourceError(w, err)
			return
		}
		if res.Language != "" && res.Language != wsLang {
			libraryError(w, &library.LanguageMismatchError{Workspace: wsLang, Book: res.Language})
			return
		}
	}

	imp, err := src.Fetch(ctx, in.SourceID)
	if err != nil {
		sourceError(w, err)
		return
	}
	imp.Meta.UserID = u.ID
	imp.Meta.WorkspaceID = in.WorkspaceID
	// Create refuses a work whose language is not the workspace's.
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
