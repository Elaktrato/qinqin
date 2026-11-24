package api

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"qinqin/internal/events"
	"qinqin/internal/model"
	"qinqin/internal/workspaces"
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
		writeError(w, http.StatusBadRequest, "bad_request", "Events array required.")
		return
	}
	// One ownership check per distinct workspace in the batch.
	owned := make(map[int64]bool, len(req.Events))
	for i := range req.Events {
		ev := &req.Events[i]
		if !events.ValidID(ev.ID) {
			writeError(w, http.StatusBadRequest, "bad_request", "Event id must be a ULID.")
			return
		}
		if ev.TS.IsZero() {
			writeError(w, http.StatusBadRequest, "bad_request", "Event ts is required.")
			return
		}
		if ev.WorkspaceID <= 0 {
			writeError(w, http.StatusBadRequest, "bad_request", "Event workspaceId is required.")
			return
		}
		if !owned[ev.WorkspaceID] {
			ok, err := workspaces.Owned(r.Context(), s.db, u.ID, ev.WorkspaceID)
			if err != nil {
				writeInternal(w, r)
				return
			}
			if !ok {
				writeError(w, http.StatusNotFound, "workspace_not_found", "No such workspace.")
				return
			}
			owned[ev.WorkspaceID] = true
		}
		ev.UserID = u.ID
	}
	accepted, duplicates, err := events.Append(r.Context(), s.db, req.Events)
	if err != nil {
		writeInternal(w, r)
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
		writeError(w, http.StatusBadRequest, "bad_request", "since must be RFC 3339.")
		return
	}
	var workspace *int64
	if raw := q.Get("workspace"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "workspace must be an integer.")
			return
		}
		ok, err := workspaces.Owned(r.Context(), s.db, u.ID, id)
		if err != nil {
			writeInternal(w, r)
			return
		}
		if !ok {
			writeError(w, http.StatusNotFound, "workspace_not_found", "No such workspace.")
			return
		}
		workspace = &id
		req.Workspace = id
	}
	if err == nil && req.Paged {
		var page events.Page
		if page, err = events.ListPage(r.Context(), s.db, u.ID, req); err == nil {
			w.Header().Set("Cache-Control", pageCacheControl)
			writeJSON(w, http.StatusOK, page)
			return
		}
	}
	if errors.Is(err, events.ErrPageInvalid) {
		writeError(w, http.StatusBadRequest, "events_page_invalid", "Read the log again from its first page. "+errDetail(err, events.ErrPageInvalid))
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
	out := &countingWriter{w: newDeadlineWriter(w, http.NewResponseController(w), streamWindow, time.Now)}
	stream := s.streamEvents
	if stream == nil {
		stream = events.StreamSince
	}
	if err := stream(r.Context(), out, s.db, u.ID, req.Since, workspace); err != nil && r.Context().Err() == nil {
		if out.n == 0 {
			h.Del("Deprecation")
			h.Del("Link")
			writeInternal(w, r)
			return
		}
		// The status and part of the body are out. Reset the connection
		// (the server aborts without the chunked terminator), so no client
		// can take the cut array for a complete one; it retries, as after
		// a network cut.
		log.Printf("event list (legacy) of user %d: %v", u.ID, err)
		panic(http.ErrAbortHandler)
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
		writeError(w, http.StatusBadRequest, "bad_request", "workspace is required.")
		return
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "workspace must be an integer.")
		return
	}
	ok, err := workspaces.Owned(r.Context(), s.db, u.ID, id)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "workspace_not_found", "No such workspace.")
		return
	}
	n, err := events.DeleteLookups(r.Context(), s.db, u.ID, id)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"deleted": n})
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

// pageCacheControl is the Cache-Control of a paged answer (the events
// pages and the v2 pull pages): no shared cache keeps it and a browser
// revalidates it, but it may be stored — the web service worker saves the
// pages for offline study and skips anything that says no-store.
// Pinned by docs/contracts/events/page.json and sync/pull-page.json.
const pageCacheControl = "private, no-cache"
