package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
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
// whatever the body claims; their timestamps are the client's own,
// stored as UTC whole seconds (fraction truncated). Each event's workspace must belong to the caller: unknown
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
// only, from the since instant (RFC 3339, inclusive) onward, in (ts, id)
// order. Without workspace the list spans all the caller's workspaces —
// the combined view; with one it lists that workspace's events. Unknown
// and foreign workspaces are invisible: both are 404 (checked on every
// page). With limit or page it answers one page (events.ListPage,
// docs/contracts/events/page.json); a continuation repeats the first
// page's workspace (the access token gate reads it) and nothing else.
// Without them it streams the whole legacy array (deprecated; old shells).
func (s *server) handleListEvents(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	q := r.URL.Query()
	req, err := events.ParsePageRequest(q)
	if errors.Is(err, events.ErrSinceInvalid) {
		http.Error(w, "since must be RFC 3339", http.StatusBadRequest)
		return
	}
	var workspace *int64
	if raw := q.Get("workspace"); raw != "" {
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
		req.Workspace = id
	}
	if err == nil && req.Paged {
		var page events.Page
		if page, err = events.ListPage(r.Context(), s.db, u.ID, req); err == nil {
			w.Header().Set("Cache-Control", "no-store")
			writeJSON(w, http.StatusOK, page)
			return
		}
	}
	if errors.Is(err, events.ErrPageInvalid) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "events_page_invalid",
			"message": "Read the log again from its first page. " + err.Error()})
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/json")
	h.Set("Deprecation", "true")
	h.Set("Link", `</api/events?limit=500>; rel="successor-version"`)
	// A stalled client is cut one window after the last bytes went out.
	out := &countingWriter{w: newDeadlineWriter(w, http.NewResponseController(w), legacyPullWindow, time.Now)}
	if err := events.StreamSince(r.Context(), out, s.db, u.ID, req.Since, workspace); err != nil && r.Context().Err() == nil {
		if out.n == 0 {
			h.Del("Deprecation")
			h.Del("Link")
			writeInternal(w, r)
			return
		}
		// The status and part of the body are out: the JSON stays
		// truncated and the client retries, as after a network cut.
		log.Printf("event list (legacy) of user %d: %v", u.ID, err)
	}
}

// handleDeleteLookupEvents serves DELETE /api/events/lookups?workspace=:
// the caller erases their "lookup" events of one workspace (the lookup
// history's Clear, #72) and gets {"deleted": n}. The workspace is
// required; unknown and foreign workspaces are 404. No other event type is
// ever deleted.
func (s *server) handleDeleteLookupEvents(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	raw := r.URL.Query().Get("workspace")
	if raw == "" {
		http.Error(w, "workspace is required", http.StatusBadRequest)
		return
	}
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
	n, err := events.DeleteLookups(r.Context(), s.db, u.ID, id)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"deleted": n})
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

// countingWriter counts the bytes that went out, so a stream that failed
// before its first byte can still answer an error status.
type countingWriter struct {
	w io.Writer
	n int
}

func (c *countingWriter) Write(p []byte) (int, error) {
	n, err := c.w.Write(p)
	c.n += n
	return n, err
}
