package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"

	"qinqin/internal/model"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

// The legacy view on the plugin-data routes (docs/contracts/study/README.md,
// spec Q9): a cached v0.3.x web shell reads and writes the typed study
// families as qinqin-flashcards rows. Those requests are served from the
// typed tables; a key only a leftover plugin row holds (one the migration
// could not read) falls back to plugin data. Deprecated from v0.4.0.

// legacyKey reports whether a plugin-data request in workspaceID addresses
// a typed study row (the study namespace, a typed-family key, a workspace).
func legacyKey(pluginID, key string, workspaceID *int64) bool {
	if pluginID != rows.Namespace || workspaceID == nil {
		return false
	}
	_, typed := rows.FamilyOf(key)
	return typed
}

// legacyGet answers GET of a typed key: true when the typed table decided
// (the row, or 404 for a tombstone that shadows any leftover).
func (s *server) legacyGet(w http.ResponseWriter, r *http.Request, userID, workspaceID int64, key string) bool {
	row, held, live, err := study.LegacyGet(r.Context(), s.db, userID, workspaceID, key)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return true
	}
	if !held {
		return false
	}
	if !live {
		http.Error(w, "plugin data not found", http.StatusNotFound)
		return true
	}
	writeJSON(w, http.StatusOK, row)
	return true
}

// mergeLegacyList merges the typed rows under prefix into a plugin-data
// list of the study namespace: a typed row wins a key both hold.
func (s *server) mergeLegacyList(r *http.Request, userID, workspaceID int64, prefix string, list []model.PluginData) ([]model.PluginData, error) {
	typed, held, err := study.LegacyList(r.Context(), s.db, userID, workspaceID, prefix)
	if err != nil {
		return nil, err
	}
	out := typed
	for _, d := range list {
		if !held[d.Key] {
			out = append(out, d)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out, nil
}

// legacyPut writes a typed key's data to its typed table at the server
// clock (last-write-wins, like a push stamped now) and answers the stored
// legacy row. Data the codec refuses is 400 study_row_invalid.
func (s *server) legacyPut(w http.ResponseWriter, r *http.Request, userID int64, workspaceID *int64, key string, body []byte) {
	if workspaceID == nil {
		writeAuthError(w, http.StatusBadRequest, "study_row_invalid", "Study rows of this key belong to a workspace: send ?workspace=.")
		return
	}
	row := model.PluginData{PluginID: rows.Namespace, Key: key, UserID: userID, WorkspaceID: workspaceID, Data: json.RawMessage(body)}
	_, err := study.ApplyLegacy(r.Context(), s.db, userID, row, study.Now())
	if errors.Is(err, rows.ErrUnreadable) || errors.Is(err, rows.ErrInvalid) {
		writeAuthError(w, http.StatusBadRequest, "study_row_invalid", "The data is not a readable study row for this key.")
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	stored, held, live, err := study.LegacyGet(r.Context(), s.db, userID, *workspaceID, key)
	if err != nil || !held || !live {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, stored)
}

// legacyDelete tombstones a typed key's row: true when the typed table
// decided (204, or 404 for a row already deleted); false when no typed row
// holds the key and the caller deletes plugin data.
func (s *server) legacyDelete(w http.ResponseWriter, r *http.Request, userID, workspaceID int64, key string) bool {
	row := model.PluginData{PluginID: rows.Namespace, Key: key, UserID: userID, WorkspaceID: &workspaceID}
	now := study.Now()
	row.DeletedAt = &now
	applied, err := study.ApplyLegacy(r.Context(), s.db, userID, row, now)
	if errors.Is(err, study.ErrNoTypedRow) {
		return false
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return true
	}
	if !applied {
		http.Error(w, "plugin data not found", http.StatusNotFound)
		return true
	}
	w.WriteHeader(http.StatusNoContent)
	return true
}
