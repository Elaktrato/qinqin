package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
)

// maxBookmarkBody caps the body of the bookmark write routes.
const maxBookmarkBody = 1 << 10

// errTrailingJSON reports data after the JSON body.
var errTrailingJSON = errors.New("trailing data after the JSON body")

// decodeBookmarkBody reads a bookmark write body into v strictly (see
// decodeStrictJSON) with the maxBookmarkBody cap. It answers a failure
// itself (413 or 400, see badBody) and reports success.
func decodeBookmarkBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := decodeStrictJSON(w, r, v, maxBookmarkBody); err != nil {
		badBody(w, err)
		return false
	}
	return true
}

// decodeStrictJSON reads a JSON body into v strictly: at most limit
// bytes (an *http.MaxBytesError beyond), no unknown keys, nothing after
// the value.
func decodeStrictJSON(w http.ResponseWriter, r *http.Request, v any, limit int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if extra := dec.Decode(&json.RawMessage{}); extra != io.EOF {
		var tooBig *http.MaxBytesError
		if errors.As(extra, &tooBig) {
			return extra
		}
		return errTrailingJSON
	}
	return nil
}

// bookmarkID reads the {bid} path value; a malformed id is a missing
// bookmark.
func bookmarkID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("bid"), 10, 64)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return 0, false
	}
	return id, true
}

// handleListBookmarks serves GET /api/library/books/{id}/bookmarks: the
// book's bookmarks in creation order.
func (s *server) handleListBookmarks(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	list, err := s.library().ListBookmarks(r.Context(), u.ID, id)
	if err != nil {
		libraryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleAddBookmark serves POST /api/library/books/{id}/bookmarks with
// the body {"position": string, "label"?: string}: 201 with the new
// bookmark, or 200 with the one already at that position. An empty
// position or a label over 120 characters is a 422, the 201st bookmark
// of a book a 409. Unknown keys and trailing data are a 400.
func (s *server) handleAddBookmark(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	var in struct {
		Position string `json:"position"`
		Label    string `json:"label"`
	}
	if !decodeBookmarkBody(w, r, &in) {
		return
	}
	m, created, err := s.library().AddBookmark(r.Context(), u.ID, id, in.Position, in.Label)
	if err != nil {
		libraryError(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, m)
}

// handleRenameBookmark serves PUT /api/library/books/{id}/bookmarks/{bid}
// with the body {"label": string} and answers with the bookmark.
func (s *server) handleRenameBookmark(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	bid, ok := bookmarkID(w, r)
	if !ok {
		return
	}
	var in struct {
		Label *string `json:"label"`
	}
	if !decodeBookmarkBody(w, r, &in) {
		return
	}
	if in.Label == nil {
		http.Error(w, "label required", http.StatusBadRequest)
		return
	}
	m, err := s.library().RenameBookmark(r.Context(), u.ID, id, bid, *in.Label)
	if err != nil {
		libraryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

// handleDeleteBookmark serves DELETE /api/library/books/{id}/bookmarks/{bid}.
func (s *server) handleDeleteBookmark(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	bid, ok := bookmarkID(w, r)
	if !ok {
		return
	}
	if err := s.library().DeleteBookmark(r.Context(), u.ID, id, bid); err != nil {
		libraryError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
