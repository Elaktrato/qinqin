package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"qinqin/internal/keyed"
	"qinqin/internal/workspaces"
)

// The keyed settings rows (internal/keyed, docs/contracts/keyed/): one row per
// key of an accepted family, scoped by ?workspace= (absent: user-global).

// rowScope resolves ?workspace=: absent or empty is the user-global nil;
// otherwise one of the caller's workspaces (400 when not an integer, 404 when
// unknown or foreign).
func (s *server) rowScope(w http.ResponseWriter, r *http.Request, userID int64) (*int64, bool) {
	raw := r.URL.Query().Get("workspace")
	if raw == "" {
		return nil, true
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "workspace must be an integer.")
		return nil, false
	}
	ok, err := workspaces.Owned(r.Context(), s.db, userID, id)
	if err != nil {
		writeInternal(w, r)
		return nil, false
	}
	if !ok {
		writeError(w, http.StatusNotFound, "workspace_not_found", "No such workspace.")
		return nil, false
	}
	return &id, true
}

// rowKeyAllowed answers for a key the store would refuse: 404 for a key of
// no family (as for a missing row), 400 for one in the wrong scope. True
// when the key may be used.
func rowKeyAllowed(w http.ResponseWriter, key string, ws *int64) bool {
	switch err := keyed.Check(key, ws); {
	case errors.Is(err, keyed.ErrUnknownKey):
		writeError(w, http.StatusNotFound, "not_found", "No row family has this key (docs/contracts/keyed/families.json).")
		return false
	case errors.Is(err, keyed.ErrWrongScope):
		if ws == nil {
			writeError(w, http.StatusBadRequest, "bad_request", "This row belongs to a workspace: name it with ?workspace=.")
		} else {
			writeError(w, http.StatusBadRequest, "bad_request", "This row is user-global: send it without ?workspace=.")
		}
		return false
	}
	return true
}

// handleListRows serves GET /api/rows?workspace=&prefix=: the caller's live
// rows of the scope whose key starts with prefix, ordered by key.
func (s *server) handleListRows(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	ws, ok := s.rowScope(w, r, u.ID)
	if !ok {
		return
	}
	list, err := keyed.List(r.Context(), s.db, u.ID, ws, r.URL.Query().Get("prefix"))
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleGetRow serves GET /api/rows/{key}?workspace=: the live row, or 404.
func (s *server) handleGetRow(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	ws, ok := s.rowScope(w, r, u.ID)
	if !ok {
		return
	}
	key := r.PathValue("key")
	if !rowKeyAllowed(w, key, ws) {
		return
	}
	row, err := keyed.Get(r.Context(), s.db, u.ID, ws, key)
	if errors.Is(err, keyed.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "Row not found.")
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// handlePutRow serves PUT /api/rows/{key}?workspace= with the value (any JSON
// document) as the body: the stored row, versioned up, a tombstone revived.
func (s *server) handlePutRow(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	ws, ok := s.rowScope(w, r, u.ID)
	if !ok {
		return
	}
	key := r.PathValue("key")
	if !rowKeyAllowed(w, key, ws) {
		return
	}
	body, ok := readBody(w, r, maxRowValue)
	if !ok {
		return
	}
	if !json.Valid(body) {
		writeError(w, http.StatusBadRequest, "bad_request", "data must be valid JSON.")
		return
	}
	row, err := keyed.Put(r.Context(), s.db, u.ID, ws, key, json.RawMessage(body), nil)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// handleDeleteRow serves DELETE /api/rows/{key}?workspace=: the row is
// tombstoned (204); a missing or deleted row is 404.
func (s *server) handleDeleteRow(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	ws, ok := s.rowScope(w, r, u.ID)
	if !ok {
		return
	}
	key := r.PathValue("key")
	if !rowKeyAllowed(w, key, ws) {
		return
	}
	err := keyed.Delete(r.Context(), s.db, u.ID, ws, key, time.Time{})
	if errors.Is(err, keyed.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "Row not found.")
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
