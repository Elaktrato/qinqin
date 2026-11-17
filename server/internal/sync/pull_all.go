package sync

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"qinqin/internal/model"
	"qinqin/internal/plugins"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

// Collections are the names of the Delta collections, as they appear in
// its JSON. A pull may be limited to a subset of them.
var Collections = []string{"entries", "links", "senses", "levelMembers", "sentences",
	"pluginData", "pluginStates", "overlays", "dictionaries", "schemes", "levels",
	"cards", "decks", "deckSettings", "limits", "fsrsSets", "fsrsActive"}

// ParseCollections parses a comma-separated list of collection names into
// the set Pull takes. An empty list means every collection (nil set); an
// unknown name is ErrInvalid.
func ParseCollections(list string) (map[string]bool, error) {
	if strings.TrimSpace(list) == "" {
		return nil, nil
	}
	set := map[string]bool{}
	for _, name := range strings.Split(list, ",") {
		name = strings.TrimSpace(name)
		if !slices.Contains(Collections, name) {
			return nil, fmt.Errorf("%w: unknown collection %q", ErrInvalid, name)
		}
		set[name] = true
	}
	return set, nil
}

// legacyView reports whether a pull is an old web shell's: it names
// pluginData and none of the typed study collections. Such a pull gets the
// typed study rows as legacy qinqin-flashcards rows in pluginData. A pull
// without collections (nil) names every collection, typed ones included.
func legacyView(only map[string]bool) bool {
	if only == nil || !only["pluginData"] {
		return false
	}
	for _, f := range rows.Families {
		if only[string(f)] {
			return false
		}
	}
	return true
}

// withLegacyRows appends the typed rows changed since cursor as legacy rows
// and drops a leftover plugin row whose key a typed row holds (the typed row
// wins, so an old shell sees one row per key), in pull order.
func withLegacyRows(ctx context.Context, sqlDB *sql.DB, userID int64, cursor time.Time, data []model.PluginData) ([]model.PluginData, error) {
	kept := data[:0]
	for _, r := range data {
		if r.PluginID == rows.Namespace && r.WorkspaceID != nil {
			shadowed, err := study.HasTypedRow(ctx, sqlDB, userID, *r.WorkspaceID, r.Key)
			if err != nil {
				return nil, fmt.Errorf("sync pull: %w", err)
			}
			if shadowed {
				continue
			}
		}
		kept = append(kept, r)
	}
	legacy, err := study.LegacyRows(ctx, sqlDB, userID, cursor)
	if err != nil {
		return nil, fmt.Errorf("sync pull: %w", err)
	}
	out := append(kept, legacy...)
	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if !a.UpdatedAt.Equal(b.UpdatedAt) {
			return a.UpdatedAt.Before(b.UpdatedAt)
		}
		if a.PluginID != b.PluginID {
			return a.PluginID < b.PluginID
		}
		return a.Key < b.Key
	})
	return out, nil
}

// Pull returns every row changed at or after cursor (the zero time means
// everything), tombstones included — except from the zero cursor, where
// the client holds nothing to delete and only live rows ship. The
// returned Cursor is the server clock read before any query ran, minus
// cursorMargin, so a row written mid-pull is picked up by the next pull.
//
// Only the collections in only are queried (see Collections); nil means
// all. The others stay empty, so the JSON shape does not change. The
// returned cursor is valid only for the collections requested; a client
// that mixes subset pulls with one global cursor would miss changes.
func Pull(ctx context.Context, sqlDB *sql.DB, userID int64, cursor time.Time, only map[string]bool) (Delta, error) {
	d := Delta{
		Cursor:  time.Now().UTC().Add(-cursorMargin).Truncate(time.Second),
		Entries: []Entry{}, Links: []Link{}, Senses: []Sense{}, LevelMembers: []LevelMember{},
		Sentences: []model.Sentence{}, PluginData: []model.PluginData{}, PluginStates: []model.PluginState{},
		Overlays: []Overlay{}, Dictionaries: []model.Dictionary{}, Schemes: []model.Scheme{}, Levels: []model.Level{},
		Cards: []rows.Card{}, Decks: []rows.Deck{}, DeckSettings: []rows.DeckSettingsRow{}, Limits: []rows.LimitsRow{},
		FsrsSets: []rows.FsrsSet{}, FsrsActive: []rows.FsrsActiveRow{},
	}
	since := cursor.UTC().Format(time.RFC3339)
	live := ""
	if cursor.IsZero() {
		live = " AND deleted_at IS NULL"
	}
	want := func(name string) bool { return only == nil || only[name] }
	var err error

	if want("entries") {
		if d.Entries, err = pullEntries(ctx, sqlDB, since, live); err != nil {
			return Delta{}, err
		}
	}
	if want("links") {
		if d.Links, err = pullLinks(ctx, sqlDB, since, live); err != nil {
			return Delta{}, err
		}
	}
	if want("senses") {
		if d.Senses, err = pullSenses(ctx, sqlDB, since, live); err != nil {
			return Delta{}, err
		}
	}
	if want("levelMembers") {
		if d.LevelMembers, err = pullLevelMembers(ctx, sqlDB, since, live); err != nil {
			return Delta{}, err
		}
	}
	if want("sentences") {
		if d.Sentences, err = pullSentences(ctx, sqlDB, userID, since, live); err != nil {
			return Delta{}, err
		}
	}
	if want("pluginData") {
		if d.PluginData, err = plugins.PullData(ctx, sqlDB, userID, cursor); err != nil {
			return Delta{}, fmt.Errorf("sync pull: %w", err)
		}
		if cursor.IsZero() {
			d.PluginData = slices.DeleteFunc(d.PluginData, func(r model.PluginData) bool { return r.DeletedAt != nil })
		}
		if legacyView(only) {
			if d.PluginData, err = withLegacyRows(ctx, sqlDB, userID, cursor, d.PluginData); err != nil {
				return Delta{}, err
			}
		}
	}
	if want("overlays") {
		if d.Overlays, err = pullOverlays(ctx, sqlDB, userID, since); err != nil {
			return Delta{}, err
		}
	}
	if want("dictionaries") {
		if d.Dictionaries, err = pullDictionaries(ctx, sqlDB, since, live); err != nil {
			return Delta{}, err
		}
	}
	if want("schemes") {
		if d.Schemes, err = pullSchemes(ctx, sqlDB, since, live); err != nil {
			return Delta{}, err
		}
	}
	if want("levels") {
		if d.Levels, err = pullLevels(ctx, sqlDB, since, live); err != nil {
			return Delta{}, err
		}
	}
	if want("pluginStates") {
		if d.PluginStates, err = pullPluginStates(ctx, sqlDB, userID, since); err != nil {
			return Delta{}, err
		}
	}
	families := map[rows.Family]bool{}
	for _, f := range rows.Families {
		if want(string(f)) {
			families[f] = true
		}
	}
	if len(families) > 0 {
		typed, err := study.Pull(ctx, sqlDB, userID, cursor, families)
		if err != nil {
			return Delta{}, fmt.Errorf("sync pull: %w", err)
		}
		d.Cards, d.Decks, d.DeckSettings = typed.Cards, typed.Decks, typed.DeckSettings
		d.Limits, d.FsrsSets, d.FsrsActive = typed.Limits, typed.FsrsSets, typed.FsrsActive
	}
	return d, nil
}
