package journal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// The keyed form of the journal's documents: how a personal backup carries
// them (docs/contracts/backup/README.md), like the typed study rows. Every
// key starts with KeyPrefix and names its workspace's document:
//
//	journal:entry:<id>         an entry
//	journal:review:<entryId>   the review of an entry
//	journal:suggestions        the topic ideas
//	journal:settings           the settings
const KeyPrefix = "journal:"

const (
	entryKey       = KeyPrefix + "entry:"
	reviewKey      = KeyPrefix + "review:"
	suggestionsKey = KeyPrefix + "suggestions"
	settingsKey    = KeyPrefix + "settings"
)

// IsKeyed reports whether a backup row key is a journal document.
func IsKeyed(key string) bool { return strings.HasPrefix(key, KeyPrefix) }

// KeyedDoc is one document in its keyed form.
type KeyedDoc struct {
	WorkspaceID int64
	Key         string
	Data        json.RawMessage
	UpdatedAt   string
}

// EachKeyed streams every journal document of the user in its keyed form:
// per workspace the entries, then their reviews, the topic ideas and the
// settings (a restore needs an entry before its review).
func EachKeyed(ctx context.Context, q Querier, userID int64, fn func(KeyedDoc) error) error {
	rows, err := q.QueryContext(ctx, `SELECT DISTINCT workspace_id FROM (
		SELECT workspace_id FROM journal_entries WHERE user_id = ?1
		UNION SELECT workspace_id FROM journal_suggestions WHERE user_id = ?1
		UNION SELECT workspace_id FROM journal_settings WHERE user_id = ?1) ORDER BY workspace_id`, userID)
	if err != nil {
		return fmt.Errorf("journal: keyed workspaces: %w", err)
	}
	var wss []int64
	for rows.Next() {
		var ws int64
		if err := rows.Scan(&ws); err != nil {
			rows.Close()
			return err
		}
		wss = append(wss, ws)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	emit := func(ws int64, key string, v any, at string) error {
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		return fn(KeyedDoc{WorkspaceID: ws, Key: key, Data: b, UpdatedAt: at})
	}
	for _, ws := range wss {
		entries, err := ListEntries(ctx, q, userID, ws)
		if err != nil {
			return err
		}
		for _, e := range entries {
			// A stamp a restore would refuse is replaced by the entry's write time.
			e.CreatedAt = stampOr(e.CreatedAt, e.UpdatedAt)
			if err := emit(ws, entryKey+e.ID, e, e.UpdatedAt); err != nil {
				return err
			}
		}
		for _, e := range entries {
			r, err := GetReview(ctx, q, userID, ws, e.ID)
			if err != nil {
				return err
			}
			if r != nil {
				r.CreatedAt = stampOr(r.CreatedAt, e.UpdatedAt)
				if err := emit(ws, reviewKey+e.ID, r, r.CreatedAt); err != nil {
					return err
				}
			}
		}
		if sg, err := GetSuggestions(ctx, q, userID, ws); err != nil {
			return err
		} else if sg != nil {
			sg.CreatedAt = stampOr(sg.CreatedAt, stampNow())
			if err := emit(ws, suggestionsKey, sg, sg.CreatedAt); err != nil {
				return err
			}
		}
		var stored int
		if err := q.QueryRowContext(ctx, `SELECT COUNT(*) FROM journal_settings WHERE user_id = ? AND workspace_id = ?`, userID, ws).Scan(&stored); err != nil {
			return err
		}
		if stored > 0 {
			st, err := GetSettings(ctx, q, userID, ws)
			if err != nil {
				return err
			}
			var at string
			if err := q.QueryRowContext(ctx, `SELECT updated_at FROM journal_settings WHERE user_id = ? AND workspace_id = ?`, userID, ws).Scan(&at); err != nil {
				return err
			}
			if err := emit(ws, settingsKey, st, at); err != nil {
				return err
			}
		}
	}
	return nil
}

// RestoreKeyed writes one document of the keyed form into workspace ws.
// ok is false for a document that does not decode or that the store refuses
// (a review of an entry the archive did not restore first): the caller drops
// and counts it.
func RestoreKeyed(ctx context.Context, q Querier, userID, ws int64, key string, data json.RawMessage) (ok bool, err error) {
	switch {
	case strings.HasPrefix(key, entryKey):
		var e Entry
		if json.Unmarshal(data, &e) != nil || e.ID != strings.TrimPrefix(key, entryKey) {
			return false, nil
		}
		if _, err := PutEntry(ctx, q, userID, ws, e); err != nil {
			return refused(err)
		}
	case strings.HasPrefix(key, reviewKey):
		var r Review
		if json.Unmarshal(data, &r) != nil || r.EntryID != strings.TrimPrefix(key, reviewKey) {
			return false, nil
		}
		if err := PutReview(ctx, q, userID, ws, r); err != nil {
			return refused(err)
		}
	case key == suggestionsKey:
		var s Suggestions
		if json.Unmarshal(data, &s) != nil {
			return false, nil
		}
		if err := PutSuggestions(ctx, q, userID, ws, s); err != nil {
			return false, err
		}
	case key == settingsKey:
		var s Settings
		if json.Unmarshal(data, &s) != nil {
			return false, nil
		}
		if _, err := PutSettings(ctx, q, userID, ws, s); err != nil {
			return refused(err)
		}
	default:
		return false, nil
	}
	return true, nil
}

// refused turns a store refusal (invalid, or a review without its entry) into
// a dropped document; any other error stays one.
func refused(err error) (bool, error) {
	var inv *InvalidError
	if errors.As(err, &inv) || errors.Is(err, ErrNotFound) {
		return false, nil
	}
	return false, err
}

// stampOr is s when it is an RFC 3339 time, else fallback: an archive row
// needs a readable stamp (backup/archive.go), and a restore refuses an
// unreadable one.
func stampOr(s, fallback string) string {
	if _, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return s
	}
	return fallback
}
