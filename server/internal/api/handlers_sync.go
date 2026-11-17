package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	chinsync "qinqin/internal/sync"
)

// handleSyncPull serves GET /api/sync/pull?cursor=: every row changed at
// or after the RFC 3339 cursor (absent = everything), tombstones
// included, plus the cursor to pull from next time. The optional
// collections= (comma-separated Delta collection names) limits the pull
// to those; the others come back empty, and an unknown name is 400. The
// returned cursor is valid only for the collections requested; a client
// that mixes subset pulls with one global cursor would miss changes.
// Authenticated.
func (s *server) handleSyncPull(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var cursor time.Time
	if raw := r.URL.Query().Get("cursor"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			http.Error(w, "cursor must be RFC 3339", http.StatusBadRequest)
			return
		}
		cursor = t
	}
	only, err := chinsync.ParseCollections(r.URL.Query().Get("collections"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	delta, err := chinsync.Pull(r.Context(), s.db, u.ID, cursor, only)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, delta)
}

// handleSyncPush serves POST /api/sync/push: a client's offline events,
// plugin data and typed study rows. Events are idempotent by id; plugin
// data and typed rows are last-write-wins. A malformed item is 400, a
// foreign or unknown workspace or plugin is 404, and then nothing in the
// push is applied; an item above 256 KiB is 413. Authenticated.
func (s *server) handleSyncPush(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var body chinsync.PushBody
	r.Body = http.MaxBytesReader(w, r.Body, maxPushBody)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		badBody(w, err)
		return
	}
	for _, d := range body.PluginData {
		if len(d.Data) > maxPluginDataValue {
			writeTooLarge(w) // the per-value cap of PUT /api/plugins/{id}/data/{key}
			return
		}
	}
	// A typed study row replaces a plugin-data row: the same per-item cap.
	for _, coll := range body.Typed() {
		for _, item := range coll.Items {
			if len(item) > maxPluginDataValue {
				writeTooLarge(w)
				return
			}
		}
	}
	res, err := chinsync.Push(r.Context(), s.db, u.ID, body)
	switch {
	case errors.Is(err, chinsync.ErrInvalid):
		http.Error(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, chinsync.ErrNotFound):
		http.Error(w, "workspace or plugin not found", http.StatusNotFound)
	case err != nil:
		http.Error(w, "internal error", http.StatusInternalServerError)
	default:
		writeJSON(w, http.StatusOK, res)
	}
}
