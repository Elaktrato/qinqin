package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"qinqin/internal/lexicon"
	"qinqin/internal/library"
	"qinqin/internal/model"
	"qinqin/internal/pack"
	"qinqin/internal/sentences"
)

const (
	// maxSentenceBody bounds the request body of a sentence POST.
	maxSentenceBody = 16 << 10
	// maxSentenceRunes bounds each of hanzi, pinyin and translation.
	maxSentenceRunes = 2000
)

// sentenceRequest is the request body of POST /api/entries/{id}/sentences.
type sentenceRequest struct {
	Hanzi       string `json:"hanzi"`
	Pinyin      string `json:"pinyin"`
	Translation string `json:"translation"`
	// Source is where the reader met the sentence (#280): one of the caller's
	// books and the word's place in it; optional.
	Source *sentences.SourceRequest `json:"source"`
}

// handleAddSentence serves POST /api/entries/{id}/sentences: it stores
// the authenticated caller's example sentence on the entry — owned by
// them, never touched by pack imports — and responds with the stored
// sentence. The entry may be of any kind (word, character, ...): the
// word-only rule binds pack sentences, not a user's own. Only the text (hanzi) is required; pinyin and translation
// are optional (the reader saves book sentences as text only). A text the
// caller already sees on the entry (a pack sentence or their own, compared
// normalised) is answered with that sentence and 200; a new one is 201. Unknown
// and malformed ids are 404, unauthenticated calls 401, malformed bodies
// and a blank text 400, a field over 2000 characters 422 and a body over
// 16 KiB 413. An optional source (#280, docs/contracts/reader/sentence-sources.json)
// must be a place in one of the caller's books of the entry's language (422
// otherwise, another user's book alike); the title is the book's. On the
// same text, an own sentence without a source takes it.
func (s *server) handleAddSentence(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Entry not found.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSentenceBody)
	var req sentenceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		if errors.As(err, new(*http.MaxBytesError)) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", "Request body too large.")
			return
		}
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	if strings.TrimSpace(req.Hanzi) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "A sentence needs its text (hanzi).")
		return
	}
	for _, field := range []string{req.Hanzi, req.Pinyin, req.Translation} {
		if utf8.RuneCountInString(field) > maxSentenceRunes {
			writeError(w, http.StatusUnprocessableEntity, "invalid_request", "Sentence fields are limited to 2000 characters.")
			return
		}
	}
	entry, err := lexicon.Store{DB: s.db}.Get(r.Context(), id)
	if errors.Is(err, lexicon.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "Entry not found.")
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	var source *model.SentenceSource
	if req.Source != nil {
		var book *sentences.SourceBook
		b, err := s.library().Get(r.Context(), u.ID, req.Source.BookID)
		switch {
		case err == nil:
			book = &sentences.SourceBook{Language: b.Language, ChapterCount: b.ChapterCount, Title: b.Title}
		case !errors.Is(err, library.ErrNotFound):
			writeInternal(w, r)
			return
		}
		if err := sentences.CheckSource(*req.Source, book, entry.Language); err != nil {
			writeError(w, http.StatusUnprocessableEntity, "invalid_request", "The sentence's source is not a place in one of your books.")
			return
		}
		src := sentences.BookSource(*req.Source, book.Title)
		source = &src
	}
	// The same text (normalised, docs/contracts/reader/saved-sentences.json)
	// already on the entry for this caller is answered as it is (#279): a
	// second tab or the reader's automatic mode never makes two rows.
	same, found, err := sentences.FindSame(r.Context(), s.db, id, u.ID, req.Hanzi)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if found {
		if source != nil && same.UserID != nil && same.Source == nil {
			adopted, err := sentences.AdoptSource(r.Context(), s.db, u.ID, same.ID, *source)
			if err != nil {
				writeInternal(w, r)
				return
			}
			if adopted {
				if same, err = sentences.Get(r.Context(), s.db, same.ID, u.ID); err != nil {
					writeInternal(w, r)
					return
				}
			}
		}
		writeJSON(w, http.StatusOK, same)
		return
	}
	sid, err := sentences.AddUser(r.Context(), s.db, u.ID, id, model.Sentence{
		Hanzi: req.Hanzi, Pinyin: req.Pinyin, Translation: req.Translation, Source: source,
	})
	if err != nil {
		writeInternal(w, r)
		return
	}
	// The stored row is read back by id so the response carries the
	// sentence exactly as persisted, timestamps included.
	stored, err := sentences.Get(r.Context(), s.db, sid, u.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusCreated, stored)
}

// handleUninstallSentences serves DELETE /api/admin/sentences/{pack}:
// the pack's sentences are soft-deleted; user-owned ones never carry a
// source pack and survive. Admin upload routes dispatch packs by
// manifest type, so sentence packs install through their own importer —
// the seed CLI wires it.
func (s *server) handleUninstallSentences(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	s.packMu.Lock()
	defer s.packMu.Unlock()
	if err := sentences.Uninstall(r.Context(), s.db, r.PathValue("pack")); err != nil {
		if errors.Is(err, sentences.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not_found", "Sentence pack not found.")
			return
		}
		writeInternal(w, r)
		return
	}
	s.packChanged(pack.TypeSentences, r.PathValue("pack"), "")
	w.WriteHeader(http.StatusNoContent)
}
