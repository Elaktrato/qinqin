package api

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// maxBookmarkBody caps the body of the bookmark write routes.
const maxBookmarkBody = 1 << 10

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
// of a book a 409.
func (s *server) handleAddBookmark(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBookmarkBody)
	var in struct {
		Position string `json:"position"`
		Label    string `json:"label"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		badBody(w, err)
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
	r.Body = http.MaxBytesReader(w, r.Body, maxBookmarkBody)
	var in struct {
		Label *string `json:"label"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		badBody(w, err)
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
