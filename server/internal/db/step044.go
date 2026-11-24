package db

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// journalStep is the Go half of migration 044 (#199): the qinqin-journal
// plugin rows become rows of the journal_* tables. The rules are a frozen
// copy of the journal's as of #199 (internal/journal: validateEntry,
// PutSettings, the review and suggestion shapes), so a personal backup of
// the result restores without loss; later changes to those rules do not
// change this step.
func journalStep(tx *sql.Tx) error {
	type row struct {
		user, ws         int64
		key, data, stamp string
	}
	rows, err := tx.Query(`SELECT user_id, workspace_id, key, data, updated_at FROM plugin_data
		WHERE pack_id = 'qinqin-journal' AND deleted_at IS NULL AND workspace_id IS NOT NULL ORDER BY rowid`)
	if err != nil {
		return fmt.Errorf("read journal rows: %w", err)
	}
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.user, &r.ws, &r.key, &r.data, &r.stamp); err != nil {
			rows.Close()
			return fmt.Errorf("scan journal row: %w", err)
		}
		all = append(all, r)
	}
	if err := errors.Join(rows.Close(), rows.Err()); err != nil {
		return fmt.Errorf("read journal rows: %w", err)
	}
	// Entries first: a review needs its entry.
	for _, r := range all {
		if !strings.HasPrefix(r.key, "entry:") {
			continue
		}
		var e struct {
			ID, Date, Text *string
			Title, Source  any
			CreatedAt      any
		}
		if json.Unmarshal([]byte(r.data), &e) != nil || e.ID == nil || e.Date == nil || e.Text == nil ||
			!j044EntryID.MatchString(*e.ID) || r.key != "entry:"+*e.ID || !j044Date(*e.Date) {
			continue
		}
		title, _ := e.Title.(string)
		source := "typed"
		if e.Source == "photo" {
			source = "photo"
		}
		if _, err := tx.Exec(`INSERT OR IGNORE INTO journal_entries (user_id, workspace_id, id, date, title, text, source, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.user, r.ws, *e.ID, *e.Date, j044Plain(title, 200), j044Plain(*e.Text, 50000),
			source, j044Stamp(e.CreatedAt, r.stamp), r.stamp); err != nil {
			return fmt.Errorf("copy journal entry: %w", err)
		}
	}
	for _, r := range all {
		switch {
		case strings.HasPrefix(r.key, "review:"):
			var v struct {
				TextHash, Model, Provider, FallbackFrom any
				Annotations, Overall, Dropped           json.RawMessage
				CreatedAt                               any
			}
			var (
				anns    []j044Annotation
				overall *j044Overall
				dropped *j044Drops
			)
			// Kept as stored when it decodes as the journal reads it.
			if json.Unmarshal([]byte(r.data), &v) != nil || !j044Kind(v.Annotations, '[') || json.Unmarshal(v.Annotations, &anns) != nil ||
				!j044Kind(v.Overall, '{') || json.Unmarshal(v.Overall, &overall) != nil {
				continue
			}
			ann, over, drop := j044Compact(v.Annotations), j044Compact(v.Overall), "{}"
			if j044Kind(v.Dropped, '{') && json.Unmarshal(v.Dropped, &dropped) == nil {
				drop = j044Compact(v.Dropped)
			}
			if _, err := tx.Exec(`INSERT OR IGNORE INTO journal_reviews (user_id, workspace_id, entry_id, text_hash, annotations, overall, model, provider, fallback_from, dropped, created_at)
				SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
				WHERE EXISTS (SELECT 1 FROM journal_entries WHERE user_id = ?1 AND workspace_id = ?2 AND id = ?3)`,
				r.user, r.ws, strings.TrimPrefix(r.key, "review:"), j044Str(v.TextHash), ann, over,
				j044Str(v.Model), j044Str(v.Provider), j044Str(v.FallbackFrom), drop, j044Stamp(v.CreatedAt, r.stamp)); err != nil {
				return fmt.Errorf("copy journal review: %w", err)
			}
		case r.key == "suggestions":
			var v struct {
				Items           json.RawMessage
				Model, Provider any
				CreatedAt       any
			}
			var items []j044Suggestion
			if json.Unmarshal([]byte(r.data), &v) != nil || !j044Kind(v.Items, '[') || json.Unmarshal(v.Items, &items) != nil {
				continue
			}
			if _, err := tx.Exec(`INSERT OR IGNORE INTO journal_suggestions (user_id, workspace_id, items, model, provider, created_at)
				VALUES (?, ?, ?, ?, ?, ?)`, r.user, r.ws, j044Compact(v.Items), j044Str(v.Model), j044Str(v.Provider), j044Stamp(v.CreatedAt, r.stamp)); err != nil {
				return fmt.Errorf("copy journal suggestions: %w", err)
			}
		case r.key == "settings":
			var v map[string]any
			if json.Unmarshal([]byte(r.data), &v) != nil || v == nil {
				continue
			}
			guidance, _ := v["guidance"].(string)
			lang, _ := v["explanationLanguage"].(string)
			if !j044Languages[lang] {
				lang = "en"
			}
			if _, err := tx.Exec(`INSERT OR IGNORE INTO journal_settings (user_id, workspace_id, guidance, explanation_language, updated_at)
				VALUES (?, ?, ?, ?, ?)`, r.user, r.ws, j044Plain(guidance, 2000), lang, r.stamp); err != nil {
				return fmt.Errorf("copy journal settings: %w", err)
			}
		}
	}
	if _, err := tx.Exec(`DELETE FROM plugin_data WHERE pack_id = 'qinqin-journal'`); err != nil {
		return fmt.Errorf("delete journal rows: %w", err)
	}
	return nil
}

// The journal's shapes and rules as of #199 (frozen).
type j044Annotation struct {
	ID          string `json:"id"`
	Quote       string `json:"quote"`
	Prefix      string `json:"prefix"`
	Suffix      string `json:"suffix"`
	Correction  string `json:"correction"`
	Explanation string `json:"explanation"`
	Category    string `json:"category"`
	Kind        string `json:"kind"`
}

type j044Overall struct {
	Summary   string   `json:"summary"`
	Strengths []string `json:"strengths"`
	Focus     []string `json:"focus"`
}

type j044Drops struct {
	NotFound    int `json:"notFound"`
	WrongScript int `json:"wrongScript"`
	NoChange    int `json:"noChange"`
	Overlap     int `json:"overlap"`
	Empty       int `json:"empty"`
	TooMany     int `json:"tooMany"`
}

type j044Suggestion struct {
	Title  string   `json:"title"`
	Prompt string   `json:"prompt"`
	Words  []string `json:"words"`
}

var j044EntryID = regexp.MustCompile(`^[0-9A-Za-z_-]{1,64}$`)

var j044Languages = map[string]bool{"en": true, "de": true, "fr": true, "es": true, "it": true, "pt": true, "nl": true,
	"ru": true, "ja": true, "zh-Hans": true, "zh-Hant": true, "ko": true}

func j044Date(s string) bool {
	d, err := time.Parse("2006-01-02", s)
	return err == nil && d.Format("2006-01-02") == s
}

// j044Plain is s as valid UTF-8 without control characters other than line
// breaks and tabs, cut to max code points.
func j044Plain(s string, max int) string {
	s = strings.ToValidUTF8(s, "")
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' {
			return -1
		}
		return r
	}, s)
	if utf8.RuneCountInString(s) > max {
		s = string([]rune(s)[:max])
	}
	return s
}

// j044Stamp is v when it is an RFC 3339 time, else the row's write time.
func j044Stamp(v any, fallback string) string {
	if s, ok := v.(string); ok {
		if _, err := time.Parse(time.RFC3339Nano, s); err == nil {
			return s
		}
	}
	return fallback
}

func j044Str(v any) string {
	s, _ := v.(string)
	return s
}

// j044Kind reports whether raw is a JSON value starting with c ('[' or '{').
func j044Kind(raw json.RawMessage, c byte) bool {
	t := bytes.TrimSpace(raw)
	return len(t) > 0 && t[0] == c
}

func j044Compact(raw json.RawMessage) string {
	var b bytes.Buffer
	if json.Compact(&b, raw) != nil {
		return string(raw)
	}
	return b.String()
}
