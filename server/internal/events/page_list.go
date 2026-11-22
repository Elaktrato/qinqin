package events

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"qinqin/internal/model"
)

// Page is one answer of the paged form: the items (each the legacy item's
// JSON), more (false exactly when no row remains) and the continuation
// token (set exactly when more).
type Page struct {
	Events []json.RawMessage `json:"events"`
	More   bool              `json:"more"`
	Next   *string           `json:"next"`
}

// listQuery is the keyset scan of one page: (ts, id) after the position,
// ts >= since, optionally one workspace. The (user_id, ts) and
// (workspace_id, ts) indexes give the ts order; SQLite sorts only the ties
// of one second by id.
func listQuery(workspace bool) string {
	q := `SELECT id, user_id, workspace_id, device, ts, type, payload
		FROM study_events
		WHERE user_id = ?1 AND ts >= ?2
		  AND (ts > ?3 OR (ts = ?3 AND id > ?4))`
	if workspace {
		q += ` AND workspace_id = ?6`
	}
	return q + ` ORDER BY ts, id LIMIT ?5`
}

// ListPage answers one paged request of user. A first page starts at the
// beginning of since; a continuation decodes its token, which must be the
// user's and name req.Workspace. Callers check the workspace is the user's.
func ListPage(ctx context.Context, sqlDB *sql.DB, userID int64, req PageRequest) (Page, error) {
	var st pageToken
	if req.Page != "" {
		var err error
		if st, err = decodePageToken(req.Page, userID); err != nil {
			return Page{}, err
		}
		if st.Workspace != req.Workspace {
			return Page{}, fmt.Errorf("%w: the continuation's workspace is not the token's", ErrPageInvalid)
		}
	} else {
		if req.Limit < 1 || req.Limit > MaxPageLimit {
			return Page{}, fmt.Errorf("%w: limit must be 1..%d", ErrPageInvalid, MaxPageLimit)
		}
		if req.Workspace < 0 {
			return Page{}, fmt.Errorf("%w: workspace must be an id", ErrPageInvalid)
		}
		st = pageToken{User: userID, Workspace: req.Workspace, Limit: req.Limit,
			Since: req.Since.UTC().Format(time.RFC3339)}
	}
	args := []any{userID, st.Since, st.TS, st.ID, st.Limit + 1}
	if st.Workspace != 0 {
		args = append(args, st.Workspace)
	}
	rows, err := sqlDB.QueryContext(ctx, listQuery(st.Workspace != 0), args...)
	if err != nil {
		return Page{}, fmt.Errorf("list study events of user %d: %w", userID, err)
	}
	defer rows.Close()

	page := Page{Events: make([]json.RawMessage, 0)}
	size := 0
	var last model.StudyEvent
	for rows.Next() {
		ev, err := scanEvent(rows, userID)
		if err != nil {
			return Page{}, err
		}
		raw, err := json.Marshal(ev)
		if err != nil {
			return Page{}, fmt.Errorf("encode study event %s: %w", ev.ID, err)
		}
		if len(page.Events) == st.Limit || (len(page.Events) > 0 && size+len(raw) > MaxPageBytes) {
			page.More = true
			break
		}
		page.Events = append(page.Events, raw)
		size += len(raw)
		last = ev
	}
	if err := rows.Err(); err != nil {
		return Page{}, fmt.Errorf("list study events of user %d: %w", userID, err)
	}
	if page.More {
		nt := st
		nt.TS, nt.ID = last.TS.UTC().Format(time.RFC3339), last.ID
		s := nt.encode()
		page.Next = &s
	}
	return page, nil
}
