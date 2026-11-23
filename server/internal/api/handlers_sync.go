package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"qinqin/internal/auth"
	chinsync "qinqin/internal/sync"
)

// handleSyncPull serves GET /api/sync/pull: the paged form with v=2
// (handleSyncPullV2), the legacy form otherwise.
//
// The legacy form, ?cursor= (deprecated, until v0.5.0): every row of the
// caller changed at or after the RFC 3339 cursor (absent = live rows
// only), tombstones included, plus the cursor to pull from next time,
// streamed row by row (sync.StreamLegacy). The optional collections=
// (comma-separated Delta collection names) limits the pull to those; the
// others come back empty. An unknown name or a bad cursor is a plain-text
// 400; a lexicon collection is 400 sync_collection_moved (JSON). The
// returned cursor is valid only for the collections requested. Answers
// carry Deprecation and a Link to the paged form. Authenticated.
func (s *server) handleSyncPull(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r)
	if p == nil {
		return
	}
	u := &p.User
	q := r.URL.Query()
	if q.Get("v") == "2" {
		s.handleSyncPullV2(w, r, p)
		return
	}
	var cursor time.Time
	if raw := q.Get("cursor"); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "cursor must be RFC 3339.")
			return
		}
		cursor = t
	}
	only, err := chinsync.ParseCollections(q.Get("collections"))
	if errors.Is(err, chinsync.ErrMoved) {
		writeError(w, http.StatusBadRequest, "sync_collection_moved", "The lexicon collections moved to data packages: read GET /api/packages. "+err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/json")
	h.Set("Deprecation", "true")
	h.Set("Link", `</api/sync/pull?v=2>; rel="successor-version"`)
	// A stalled client is cut one window after the last row went out.
	out := newDeadlineWriter(w, http.NewResponseController(w), legacyPullWindow, time.Now)
	if err := chinsync.StreamLegacy(r.Context(), out, s.db, u.ID, cursor, only); err != nil && r.Context().Err() == nil {
		// The status and part of the body are out: the JSON stays truncated
		// and the client retries, as after a network cut.
		log.Printf("sync pull (legacy) of user %d: %v", u.ID, err)
	}
}

// handleSyncPullV2 serves GET /api/sync/pull?v=2: one page of the caller's
// own rows (docs/contracts/sync/). Errors are JSON {error, message}:
// sync_page_invalid and sync_collection_moved 400, not_found 404 for a
// workspace= the caller does not own, sync_cursor_expired 410. Pages are
// never kept by shared caches and always revalidated (pageCacheControl),
// but they may be stored: the service worker keeps its own copies for
// offline study (a no-store answer it would never save).
func (s *server) handleSyncPullV2(w http.ResponseWriter, r *http.Request, p *auth.Principal) {
	req, err := chinsync.ParsePageRequest(r.URL.Query())
	if err == nil {
		var page chinsync.Page
		page, err = chinsync.PullPage(r.Context(), s.db, p.User.ID, req, s.syncCatalogueETag(p))
		if err == nil {
			w.Header().Set("Cache-Control", pageCacheControl)
			writeJSON(w, http.StatusOK, page)
			return
		}
	}
	switch {
	case errors.Is(err, chinsync.ErrMoved):
		writeError(w, http.StatusBadRequest, "sync_collection_moved", "The lexicon collections moved to data packages: read GET /api/packages. "+err.Error())
	case errors.Is(err, chinsync.ErrPageInvalid):
		writeError(w, http.StatusBadRequest, "sync_page_invalid", "Start the round again without page. "+err.Error())
	case errors.Is(err, chinsync.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "No such workspace.")
	case errors.Is(err, chinsync.ErrCursorExpired):
		writeError(w, http.StatusGone, "sync_cursor_expired", "Discard local user data and pull again without since.")
	default:
		writeInternal(w, r)
	}
}

// syncCatalogueETag is the scope.catalogue of a paged pull: the ETag of the
// catalogue GET /api/packages gives the same caller by default (its
// workspace languages, the same registry, the same catalogueAdmin rule).
func (s *server) syncCatalogueETag(p *auth.Principal) chinsync.CatalogueFunc {
	reg, admin := s.packageRegistry(), catalogueAdmin(p)
	return func(ctx context.Context, languages []string) (string, error) {
		c, err := reg.Catalogue(ctx, languages, admin)
		return c.ETag, err
	}
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
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
	case errors.Is(err, chinsync.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "No such workspace or plugin.")
	case err != nil:
		writeInternal(w, r)
	default:
		writeJSON(w, http.StatusOK, res)
	}
}
