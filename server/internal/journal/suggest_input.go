package journal

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"qinqin/internal/ai"
	"qinqin/internal/events"
	"qinqin/internal/lexicon"
	"qinqin/internal/study"
)

const (
	maxSuggestWords  = 60
	maxSuggestRecent = 10
	openingRunes     = 200
)

// SuggestionInput gathers what the topic ideas request may send: up to 60
// recently reviewed words of the workspace (newest first, deduplicated) and
// the last 10 entries as title plus a 200-rune opening. Nothing else of the
// learner's writing leaves the server.
func SuggestionInput(ctx context.Context, sqlDB *sql.DB, userID, workspaceID int64, now time.Time) (words []string, recent []ai.EntrySummary, err error) {
	evs, err := events.Since(ctx, sqlDB, userID, now.AddDate(0, 0, -30), &workspaceID)
	if err != nil {
		return nil, nil, err
	}
	// The workspace's live cards (typed study rows).
	live, err := study.ListCards(ctx, sqlDB, userID, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	type card struct {
		EntryID int64
		Written string
	}
	cards := map[string]card{}
	for _, c := range live {
		k := card{EntryID: c.EntryID}
		if c.Written != nil {
			k.Written = *c.Written
		}
		cards[c.ID] = k
	}
	// Newest review first; Since returns oldest first.
	var order []card
	for i := len(evs) - 1; i >= 0; i-- {
		if evs[i].Type != "review" {
			continue
		}
		var p struct {
			CardID string `json:"cardId"`
		}
		if json.Unmarshal(evs[i].Payload, &p) != nil || p.CardID == "" {
			continue
		}
		if c, ok := cards[p.CardID]; ok {
			order = append(order, c)
		}
	}
	var ids []int64
	for _, c := range order {
		if strings.TrimSpace(c.Written) == "" && c.EntryID != 0 {
			ids = append(ids, c.EntryID)
		}
	}
	forms := map[int64]string{}
	if len(ids) > 0 {
		entries, err := lexicon.Store{DB: sqlDB}.GetMany(ctx, ids)
		if err != nil {
			return nil, nil, err
		}
		for _, e := range entries {
			// The entry's display form: の, not the search-only 乃.
			forms[e.ID] = e.Headword()
		}
	}
	seen := map[string]bool{}
	for _, c := range order {
		w := strings.TrimSpace(c.Written)
		if w == "" {
			w = forms[c.EntryID]
		}
		if w == "" || seen[w] {
			continue
		}
		seen[w] = true
		words = append(words, w)
		if len(words) == maxSuggestWords {
			break
		}
	}

	// ListEntries orders newest date first, then the most recently saved.
	entries, err := ListEntries(ctx, sqlDB, userID, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	for _, e := range entries {
		if len(recent) == maxSuggestRecent {
			break
		}
		recent = append(recent, ai.EntrySummary{Title: e.Title, Opening: cutRunes(e.Text, openingRunes)})
	}
	return words, recent, nil
}
