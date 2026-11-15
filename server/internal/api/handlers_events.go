package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"qinqin/internal/events"
	"qinqin/internal/model"
)

// eventBatch is the request body of POST /api/events/batch: the
// events an offline client recorded, each keyed by its client-generated
// ULID.
type eventBatch struct {
	Events []model.StudyEvent `json:"events"`
}

// handleEventBatch serves POST /api/events/batch: it appends a batch of
// offline-recorded events. Each event's id — the client-generated ULID
// — makes retries harmless: an already-stored id counts as a duplicate,
// never an error. The events' user is the token's user, overwriting
// whatever the body claims; their timestamps are the client's own, kept
// verbatim. Each event's workspace must belong to the caller: unknown
// and foreign ids are 404.
func (s *server) handleEventBatch(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var req eventBatch
	r.Body = http.MaxBytesReader(w, r.Body, maxBatchBody)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badBody(w, err)
		return
	}
	if req.Events == nil {
		http.Error(w, "events array required", http.StatusBadRequest)
		return
	}
	// One ownership check per distinct workspace in the batch.
	owned := make(map[int64]bool, len(req.Events))
	for i := range req.Events {
		ev := &req.Events[i]
		if !events.ValidID(ev.ID) {
			http.Error(w, "event id must be a ULID", http.StatusBadRequest)
			return
		}
		if ev.TS.IsZero() {
			http.Error(w, "event ts is required", http.StatusBadRequest)
			return
		}
		if ev.WorkspaceID <= 0 {
			http.Error(w, "event workspaceId is required", http.StatusBadRequest)
			return
		}
		if !owned[ev.WorkspaceID] {
			ok, err := s.workspaceOwned(r.Context(), u.ID, ev.WorkspaceID)
			if err != nil {
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			if !ok {
				http.Error(w, "workspace not found", http.StatusNotFound)
				return
			}
			owned[ev.WorkspaceID] = true
		}
		ev.UserID = u.ID
	}
	accepted, duplicates, err := events.Append(r.Context(), s.db, req.Events)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"accepted": accepted, "duplicates": duplicates})
}

// handleListEvents serves GET /api/events with the caller's events
// only, from the since instant (RFC 3339, inclusive) onward. Without
// workspace the list spans all the caller's workspaces — the combined
// view; with one it lists that workspace's events. Unknown and foreign
// workspaces are invisible: both are 404.
func (s *server) handleListEvents(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var since time.Time
	if raw := r.URL.Query().Get("since"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			http.Error(w, "since must be RFC 3339", http.StatusBadRequest)
			return
		}
		since = t
	}
	var workspace *int64
	if raw := r.URL.Query().Get("workspace"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			http.Error(w, "workspace must be an integer", http.StatusBadRequest)
			return
		}
		ok, err := s.workspaceOwned(r.Context(), u.ID, id)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if !ok {
			http.Error(w, "workspace not found", http.StatusNotFound)
			return
		}
		workspace = &id
	}
	evts, err := events.Since(r.Context(), s.db, u.ID, since, workspace)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, evts)
}

// workspaceOwned reports whether the workspace belongs to userID. The
// lookup keys on (id, user_id), so unknown and foreign ids are
// indistinguishable to the caller.
func (s *server) workspaceOwned(ctx context.Context, userID, workspaceID int64) (bool, error) {
	var one int
	err := s.db.QueryRowContext(ctx, `
		SELECT 1 FROM workspaces WHERE id = ? AND user_id = ?`, workspaceID, userID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}
