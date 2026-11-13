package api

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"qinqin/internal/library"
)

// maxHighlightBody caps the body of the highlight write routes.
const maxHighlightBody = 8 << 10

// highlightID reads the {hid} path value; a malformed id is a missing
// highlight.
func highlightID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("hid"), 10, 64)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return 0, false
	}
	return id, true
}

// highlightError maps a highlight store error to a response: an overlap
// is a 409 with {error, existingId}, the cap a 409 with {error}, an
// invalid highlight a 422; anything else goes to libraryError.
func highlightError(w http.ResponseWriter, err error) {
	var overlap *library.OverlapError
	switch {
	case errors.As(err, &overlap):
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":      "the text is already highlighted",
			"existingId": overlap.ExistingID,
		})
	case errors.Is(err, library.ErrTooMany):
		writeJSON(w, http.StatusConflict, map[string]string{
			"error": fmt.Sprintf("this book already has %d highlights", library.MaxHighlights),
		})
	case errors.Is(err, library.ErrHighlightRange):
		http.Error(w, "highlight range out of bounds", http.StatusUnprocessableEntity)
	case errors.Is(err, library.ErrHighlightColor):
		http.Error(w, "colour must be yellow, green, blue or pink", http.StatusUnprocessableEntity)
	case errors.Is(err, library.ErrHighlightText):
		http.Error(w, fmt.Sprintf("text must be 1 to %d characters", library.MaxHighlightText), http.StatusUnprocessableEntity)
	case errors.Is(err, library.ErrNoteTooLong):
		http.Error(w, fmt.Sprintf("note is longer than %d characters", library.MaxNoteLen), http.StatusUnprocessableEntity)
	default:
		libraryError(w, err)
	}
}

// handleListHighlights serves GET /api/library/books/{id}/highlights:
// the book's highlights ordered by chapter, paragraph and start.
func (s *server) handleListHighlights(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	list, err := s.library().ListHighlights(r.Context(), u.ID, id)
	if err != nil {
		highlightError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleAddHighlight serves POST /api/library/books/{id}/highlights with
// the body {"chapter", "paragraph", "start", "end": int, "text": string,
// "color"?: string, "note"?: string}: 201 with the new highlight. An
// overlap with a highlight of the same paragraph is a 409 with
// {error, existingId}, the 2001st highlight of a book a 409 with
// {error}, an invalid range, colour, text or note a 422. Bodies over
// 8 KiB are a 413; unknown keys and trailing data a 400.
func (s *server) handleAddHighlight(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	var in struct {
		Chapter   int    `json:"chapter"`
		Paragraph int    `json:"paragraph"`
		Start     int    `json:"start"`
		End       int    `json:"end"`
		Text      string `json:"text"`
		Color     string `json:"color"`
		Note      string `json:"note"`
	}
	if !decodeStrictBody(w, r, &in, maxHighlightBody) {
		return
	}
	h, err := s.library().AddHighlight(r.Context(), u.ID, id, library.Highlight{
		Chapter: in.Chapter, Paragraph: in.Paragraph, Start: in.Start, End: in.End,
		Text: in.Text, Color: in.Color, Note: in.Note,
	})
	if err != nil {
		highlightError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, h)
}

// handleUpdateHighlight serves PUT /api/library/books/{id}/highlights/{hid}
// with the body {"color"?: string, "note"?: string} (at least one) and
// answers with the highlight; the range and text cannot change.
func (s *server) handleUpdateHighlight(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	hid, ok := highlightID(w, r)
	if !ok {
		return
	}
	var in struct {
		Color *string `json:"color"`
		Note  *string `json:"note"`
	}
	if !decodeStrictBody(w, r, &in, maxHighlightBody) {
		return
	}
	if in.Color == nil && in.Note == nil {
		http.Error(w, "color or note required", http.StatusBadRequest)
		return
	}
	h, err := s.library().UpdateHighlight(r.Context(), u.ID, id, hid, in.Color, in.Note)
	if err != nil {
		highlightError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, h)
}

// handleDeleteHighlight serves DELETE /api/library/books/{id}/highlights/{hid}.
func (s *server) handleDeleteHighlight(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	hid, ok := highlightID(w, r)
	if !ok {
		return
	}
	if err := s.library().DeleteHighlight(r.Context(), u.ID, id, hid); err != nil {
		highlightError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
