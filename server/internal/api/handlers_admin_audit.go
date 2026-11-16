package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
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
			writeAuthError(w, http.StatusBadRequest, "bad_request", "limit must be between 1 and 100.")
			return
		}
		limit = n
	}
	before := int64(1<<62 - 1)
	if v := r.URL.Query().Get("before"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 1 {
			writeAuthError(w, http.StatusBadRequest, "bad_request", "before must be an event id.")
			return
		}
		before = n
	}
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT id, at, action, actor_id, actor_name, target_id, target_name, detail
		FROM auth_audit WHERE id < ? ORDER BY id DESC LIMIT ?`, before, limit+1)
	if err != nil {
		writeInternal(w, r)
		return
	}
	defer rows.Close()
	events := []auditEntry{}
	for rows.Next() {
		var e auditEntry
		var actorID, targetID sql.NullInt64
		var actorName, targetName, detail string
		if err := rows.Scan(&e.ID, &e.At, &e.Action, &actorID, &actorName, &targetID, &targetName, &detail); err != nil {
			writeInternal(w, r)
			return
		}
		if actorID.Valid {
			e.Actor = &auditRef{actorID.Int64, actorName}
		}
		if targetID.Valid {
			e.Target = &auditRef{targetID.Int64, targetName}
		}
		e.Detail = json.RawMessage(detail)
		events = append(events, e)
	}
	if rows.Err() != nil {
		writeInternal(w, r)
		return
	}
	var next any
	if len(events) > limit {
		events = events[:limit]
		next = events[limit-1].ID
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": events, "next": next})
}
