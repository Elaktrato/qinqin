package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"qinqin/internal/datapkg"
	"qinqin/internal/model"
	chinsync "qinqin/internal/sync"
)

// handleSyncPull serves GET /api/sync/pull: the paged form with v=2
// (handleSyncPullV2), the legacy form otherwise.
//
// The legacy form, ?cursor=: every row changed at
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
	if r.URL.Query().Get("v") == "2" {
		s.handleSyncPullV2(w, r, u)
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

// handleSyncPullV2 serves GET /api/sync/pull?v=2: one page of the caller's
// own rows (docs/contracts/sync/). Errors are JSON {error, message}:
// sync_page_invalid and sync_collection_moved 400, not_found 404 for a
// workspace= the caller does not own, sync_cursor_expired 410. Pages are
// never cached by intermediaries (no-store); the service worker keeps its
// own copies.
func (s *server) handleSyncPullV2(w http.ResponseWriter, r *http.Request, u *model.User) {
	req, err := chinsync.ParsePageRequest(r.URL.Query())
	if err == nil {
		var page chinsync.Page
		page, err = chinsync.PullPage(r.Context(), s.db, u.ID, req, s.syncCatalogueETag(u.Admin))
		if err == nil {
			w.Header().Set("Cache-Control", "no-store")
			writeJSON(w, http.StatusOK, page)
			return
		}
	}
	switch {
	case errors.Is(err, chinsync.ErrMoved):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "sync_collection_moved",
			"message": "The lexicon collections moved to data packages: read GET /api/packages. " + err.Error()})
	case errors.Is(err, chinsync.ErrPageInvalid):
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "sync_page_invalid",
			"message": "Start the round again without page. " + err.Error()})
	case errors.Is(err, chinsync.ErrNotFound):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not_found", "message": "No such workspace."})
	case errors.Is(err, chinsync.ErrCursorExpired):
		writeJSON(w, http.StatusGone, map[string]string{"error": "sync_cursor_expired",
			"message": "Discard local user data and pull again without since."})
	default:
		writeInternal(w, r)
	}
}

// syncCatalogueETag is the scope.catalogue of a paged pull: the ETag of the
// caller's default package catalogue (its workspace languages; an
// administrator's carries build errors), as GET /api/packages answers it.
// Without a builder the registry is read directly (never building).
func (s *server) syncCatalogueETag(admin bool) chinsync.CatalogueFunc {
	reg := datapkg.Registry{DB: s.db}
	if s.packages != nil {
		reg = s.packages.Registry()
	}
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
		http.Error(w, err.Error(), http.StatusBadRequest)
	case errors.Is(err, chinsync.ErrNotFound):
		http.Error(w, "workspace or plugin not found", http.StatusNotFound)
	case err != nil:
		http.Error(w, "internal error", http.StatusInternalServerError)
	default:
		writeJSON(w, http.StatusOK, res)
	}
}
