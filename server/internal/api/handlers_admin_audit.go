package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"qinqin/internal/auth"
)

type auditRef struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type auditEntry struct {
	ID     int64           `json:"id"`
	At     string          `json:"at"`
	Action string          `json:"action"`
	Actor  *auditRef       `json:"actor"`
	Target *auditRef       `json:"target"`
	Detail json.RawMessage `json:"detail"`
}

// handleAdminAudit serves GET /api/admin/audit?before=<id>&limit=50: the
// newest events first, paged by id. next is the id to pass as before for
// the following page, null at the end.
func (s *server) handleAdminAudit(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 100 {
			writeError(w, http.StatusBadRequest, "bad_request", "limit must be between 1 and 100.")
			return
		}
		limit = n
	}
	var before int64
	if v := r.URL.Query().Get("before"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 1 {
			writeError(w, http.StatusBadRequest, "bad_request", "before must be an event id.")
			return
		}
		before = n
	}
	page, err := auth.AuditPage(r.Context(), s.db, before, limit)
	if err != nil {
		writeInternal(w, r)
		return
	}
	events := make([]auditEntry, 0, len(page.Records))
	for _, rec := range page.Records {
		e := auditEntry{ID: rec.ID, At: rec.At, Action: rec.Action, Detail: rec.Detail}
		if rec.ActorID != nil {
			e.Actor = &auditRef{*rec.ActorID, rec.ActorName}
		}
		if rec.TargetID != nil {
			e.Target = &auditRef{*rec.TargetID, rec.TargetName}
		}
		events = append(events, e)
	}
	var next any
	if page.Next != nil {
		next = *page.Next
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events, "next": next})
}
