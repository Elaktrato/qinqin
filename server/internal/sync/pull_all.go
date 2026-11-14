package sync

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
	"strings"
	"time"

	"qinqin/internal/model"
	"qinqin/internal/plugins"
)

// Collections are the names of the Delta collections, as they appear in
// its JSON. A pull may be limited to a subset of them.
var Collections = []string{"entries", "links", "senses", "levelMembers", "sentences",
	"pluginData", "pluginStates", "overlays", "dictionaries", "schemes", "levels"}

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
	return d, nil
}
