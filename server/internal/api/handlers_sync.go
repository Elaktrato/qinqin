package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"qinqin/internal/auth"
	chinsync "qinqin/internal/sync"
)

// handleSyncPull serves GET /api/sync/pull: the paged form, v=2
// (handleSyncPullV2). The legacy streaming form (?cursor=, v0.3.x web
// shells) was removed in #198: any request without v=2 is 404 not_found.
// Authenticated.
func (s *server) handleSyncPull(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r)
	if p == nil {
		return
	}
	if r.URL.Query().Get("v") != "2" {
		writeError(w, http.StatusNotFound, "not_found", "The pull is GET /api/sync/pull?v=2 (docs/contracts/sync/); the legacy form was removed.")
		return
	}
	s.handleSyncPullV2(w, r, p)
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
		writeError(w, http.StatusBadRequest, "sync_collection_moved", "The lexicon collections moved to data packages: read GET /api/packages. Moved: "+errDetail(err, chinsync.ErrMoved))
	case errors.Is(err, chinsync.ErrPageInvalid):
		writeError(w, http.StatusBadRequest, "sync_page_invalid", "Start the round again without page. "+errDetail(err, chinsync.ErrPageInvalid))
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

// writeStoredUnreadable answers a write onto a stored study row this server
// cannot read back (study.ErrUnreadableStored): 409 study_row_unreadable,
// nothing applied (docs/contracts/sync/README.md, "Reading rows").
func writeStoredUnreadable(w http.ResponseWriter) {
	writeError(w, http.StatusConflict, "study_row_unreadable",
		"A stored study row this write would replace was saved in a form this server version cannot read; it is kept unchanged. Update the server or leave the row alone.")
}

// handleSyncPush serves POST /api/sync/push: a client's offline events,
// keyed rows and typed study rows. Events are idempotent by id; keyed and
// typed rows are last-write-wins. A malformed item is 400, a foreign or
// unknown workspace is 404, and then nothing in the
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
	for _, d := range body.Rows {
		if len(d.Data) > maxRowValue {
			writeTooLarge(w) // the per-value cap of PUT /api/rows/{key}
			return
		}
	}
	// A typed study row: the same per-item cap.
	for _, coll := range body.Typed() {
		for _, item := range coll.Items {
			if len(item) > maxRowValue {
				writeTooLarge(w)
				return
			}
		}
	}
	res, err := chinsync.Push(r.Context(), s.db, u.ID, body)
	switch {
	case errors.Is(err, chinsync.ErrInvalid):
		writeError(w, http.StatusBadRequest, "bad_request", errDetail(err, chinsync.ErrInvalid))
	case errors.Is(err, chinsync.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "No such workspace.")
	case errors.Is(err, chinsync.ErrStoredUnreadable):
		writeStoredUnreadable(w)
	case err != nil:
		writeInternal(w, r)
	default:
		writeJSON(w, http.StatusOK, res)
	}
}
