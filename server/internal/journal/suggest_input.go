package journal

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"qinqin/internal/ai"
	"qinqin/internal/events"
	"qinqin/internal/lexicon"
	"qinqin/internal/plugins"
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
	rows, err := plugins.ListData(ctx, sqlDB, userID, &workspaceID, "qinqin-flashcards", "card:")
	if err != nil {
		return nil, nil, err
	}
	type card struct {
		EntryID int64  `json:"entryId"`
		Written string `json:"written"`
	}
	cards := map[string]card{}
	for _, row := range rows {
		var c struct {
			ID string `json:"id"`
			card
		}
		if json.Unmarshal(row.Data, &c) == nil && c.ID != "" {
			cards[c.ID] = c.card
		}
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

	rows, err = plugins.ListData(ctx, sqlDB, userID, &workspaceID, PluginID, "entry:")
	if err != nil {
		return nil, nil, err
	}
	var entries []Entry
	for _, row := range rows {
		if e, err := ParseEntry(row.Data); err == nil {
			entries = append(entries, e)
		}
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].Date != entries[j].Date {
			return entries[i].Date > entries[j].Date
		}
		return entries[i].UpdatedAt > entries[j].UpdatedAt
	})
	for _, e := range entries {
		if len(recent) == maxSuggestRecent {
			break
		}
		recent = append(recent, ai.EntrySummary{Title: e.Title, Opening: cutRunes(e.Text, openingRunes)})
	}
	return words, recent, nil
}
