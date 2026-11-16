package backup

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
)

// Counts is a set of row counts shown before a restore.
type Counts struct {
	Workspaces int `json:"workspaces"`
	Events     int `json:"events"`
	Cards      int `json:"cards"`
	PluginData int `json:"pluginData"`
	Overlays   int `json:"overlays"`
	Sentences  int `json:"sentences"`
	Books      int `json:"books"`
	Bookmarks  int `json:"bookmarks"`
	Highlights int `json:"highlights"`
}

// UnresolvedEntry is a word the archive refers to that this server cannot
// identify; what refers to it is dropped.
type UnresolvedEntry struct {
	Written  string `json:"written"`
	Language string `json:"language"`
	Cards    int    `json:"cards"`
	Overlays int    `json:"overlays"`
}

// Unresolved lists what a restore would drop for lack of a counterpart.
type Unresolved struct {
	Entries     []UnresolvedEntry `json:"entries"` // the first maxListed, by written form
	EntryCount  int               `json:"entryCount"`
	Sentences   int               `json:"sentences"`
	DroppedRows int               `json:"droppedRows"` // card rows, overlays and sentences that go with them
}

// ReportBackup describes the archive.
type ReportBackup struct {
	Username   string `json:"username"`
	CreatedAt  string `json:"createdAt"`
	AppVersion string `json:"appVersion"`
}

// Report is the dry run of a restore: what it replaces, what it brings back
// and what it cannot. Blocking problems make the stage invalid.
type Report struct {
	Backup              ReportBackup `json:"backup"`
	Replaces            Counts       `json:"replaces"`
	Restores            Counts       `json:"restores"`
	Unresolved          Unresolved   `json:"unresolved"`
	PluginsNotInstalled []string     `json:"pluginsNotInstalled"`
	ReidentifiedEvents  int          `json:"reidentifiedEvents"`
	Blocking            []string     `json:"blocking"` // problems that forbid the restore
	Warnings            []string     `json:"warnings"`
	Bytes               int64        `json:"bytes"`
}

const maxListed = 100

// resolveEntries maps archive entry refs to this server's entries: by
// (language, kind, ext_key), else by the unique live entry of that language
// and kind whose first form equals the written text. Two sources that land on
// one target keep it only when exactly one of them matched by ext_key.
func resolveEntries(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, refs []EntryRef) (map[int64]int64, error) {
	type cand struct {
		src   int64
		exact bool
	}
	byTarget := map[int64][]cand{}
	for _, r := range refs {
		var id int64
		err := q.QueryRowContext(ctx, `SELECT id FROM entries WHERE language = ? AND kind = ? AND ext_key = ? AND deleted_at IS NULL`,
			r.Language, r.Kind, r.ExtKey).Scan(&id)
		switch {
		case err == nil:
			byTarget[id] = append(byTarget[id], cand{r.ID, true})
			continue
		case !errors.Is(err, sql.ErrNoRows):
			return nil, fmt.Errorf("resolve entry: %w", err)
		}
		if r.Written == "" {
			continue
		}
		rs, err := q.QueryContext(ctx, `SELECT e.id FROM entries e JOIN forms f ON f.entry_id = e.id
			WHERE e.language = ?1 AND e.kind = ?2 AND e.deleted_at IS NULL AND f.deleted_at IS NULL AND f.text = ?3
			AND f.ord = (SELECT MIN(ord) FROM forms WHERE entry_id = e.id AND deleted_at IS NULL) LIMIT 2`,
			r.Language, r.Kind, r.Written)
		if err != nil {
			return nil, fmt.Errorf("resolve entry by form: %w", err)
		}
		var ids []int64
		for rs.Next() {
			var id int64
			if err := rs.Scan(&id); err != nil {
				rs.Close()
				return nil, err
			}
			ids = append(ids, id)
		}
		if err := rs.Err(); err != nil {
			rs.Close()
			return nil, err
		}
		rs.Close()
		if len(ids) == 1 {
			byTarget[ids[0]] = append(byTarget[ids[0]], cand{r.ID, false})
		}
	}
	out := map[int64]int64{}
	for target, cs := range byTarget {
		if len(cs) == 1 {
			out[cs[0].src] = target
			continue
		}
		var exact []cand
		for _, c := range cs {
			if c.exact {
				exact = append(exact, c)
			}
		}
		if len(exact) == 1 {
			out[exact[0].src] = target
		}
	}
	return out, nil
}

// Plan resolves every reference of the archive against the database and
// returns the dry-run report and the maps a restore will use. It writes
// nothing. Workspace, book and own-sentence entries of the maps are
// placeholders (the old id) until the restore inserts the rows.
func Plan(ctx context.Context, db *sql.DB, a *Archive, userID int64) (Report, *Maps, error) {
	var rep Report
	rep.Backup = ReportBackup{Username: a.Manifest.User.Username, CreatedAt: a.Manifest.CreatedAt, AppVersion: a.Manifest.AppVersion}
	rep.Bytes = a.Total
	rep.PluginsNotInstalled, rep.Blocking, rep.Warnings = []string{}, []string{}, []string{}
	rep.Unresolved.Entries = []UnresolvedEntry{}
	m := NewMaps()

	var uname string
	if err := db.QueryRowContext(ctx, `SELECT username FROM users WHERE id = ?`, userID).Scan(&uname); err != nil {
		return rep, nil, fmt.Errorf("plan: read user: %w", err)
	}
	if a.Manifest.User.Username != uname {
		rep.Warnings = append(rep.Warnings, "This backup comes from another account ("+a.Manifest.User.Username+"). Its data replaces everything of "+uname+".")
	}

	// languages every workspace and book needs
	missing := map[string]bool{}
	langOK := map[string]bool{}
	checkLang := func(code string) error {
		if langOK[code] || missing[code] {
			return nil
		}
		var one int
		err := db.QueryRowContext(ctx, `SELECT 1 FROM languages WHERE code = ?`, code).Scan(&one)
		if errors.Is(err, sql.ErrNoRows) {
			missing[code] = true
			return nil
		}
		if err != nil {
			return err
		}
		langOK[code] = true
		return nil
	}
	for _, w := range a.Workspaces {
		if err := checkLang(w.Language); err != nil {
			return rep, nil, err
		}
		m.Workspaces[w.ID] = w.ID
	}
	for _, b := range a.Books {
		if err := checkLang(b.Language); err != nil {
			return rep, nil, err
		}
		m.Books[b.ID] = b.ID
	}
	for code := range missing {
		rep.Blocking = append(rep.Blocking, "The language "+code+" is not set up on this server.")
	}
	sort.Strings(rep.Blocking)

	// entries
	var err error
	if m.Entries, err = resolveEntries(ctx, db, a.Entries); err != nil {
		return rep, nil, err
	}
	// dictionaries by pack id
	for _, d := range a.Dicts {
		var id int64
		err := db.QueryRowContext(ctx, `SELECT id FROM dictionaries WHERE pack_id = ? AND deleted_at IS NULL`, d.PackID).Scan(&id)
		if err == nil {
			m.Dicts[d.ID] = id
		} else if !errors.Is(err, sql.ErrNoRows) {
			return rep, nil, err
		}
	}
	// sentences: pack ones by (source pack, new entry, hanzi); own ones follow their entry
	ownPresent := map[int64]bool{}
	ownDropped := 0
	if err := a.OwnSentences(func(s OwnSentence) error {
		if _, ok := m.Entries[s.EntryID]; ok {
			ownPresent[s.ID] = true
		} else {
			ownDropped++
		}
		return nil
	}); err != nil {
		return rep, nil, err
	}
	for _, s := range a.SentRefs {
		if s.Own {
			if ownPresent[s.ID] {
				m.Sentences[s.ID] = s.ID
			} else {
				rep.Unresolved.Sentences++
			}
			continue
		}
		ne, ok := m.Entries[s.EntryID]
		if !ok {
			rep.Unresolved.Sentences++
			continue
		}
		rs, err := db.QueryContext(ctx, `SELECT id FROM sentences WHERE source_pack = ? AND entry_id = ? AND hanzi = ? AND user_id IS NULL AND deleted_at IS NULL LIMIT 2`,
			s.SourcePack, ne, s.Hanzi)
		if err != nil {
			return rep, nil, err
		}
		var ids []int64
		for rs.Next() {
			var id int64
			rs.Scan(&id)
			ids = append(ids, id)
		}
		rs.Close()
		if len(ids) == 1 {
			m.Sentences[s.ID] = ids[0]
		} else {
			rep.Unresolved.Sentences++
		}
	}

	// plugin rows: cards decide the card id map first, then everything is counted
	installed := map[string]bool{}
	rs, err := db.QueryContext(ctx, `SELECT pack_id FROM plugin_registry`)
	if err != nil {
		return rep, nil, err
	}
	for rs.Next() {
		var id string
		rs.Scan(&id)
		installed[id] = true
	}
	rs.Close()
	notInstalled := map[string]bool{}
	if err := a.PluginRows(func(r PluginRow) error {
		if r.PluginID == FlashcardsPlugin && strings.HasPrefix(r.Key, cardKeyPrefix) {
			m.RegisterCard(r.Key, r.Data)
		}
		if !installed[r.PluginID] {
			notInstalled[r.PluginID] = true
		}
		return nil
	}); err != nil {
		return rep, nil, err
	}
	for _, ps := range a.Account.PluginStates {
		if !installed[ps.PluginID] {
			notInstalled[ps.PluginID] = true
		}
	}
	for id := range notInstalled {
		rep.PluginsNotInstalled = append(rep.PluginsNotInstalled, id)
	}
	sort.Strings(rep.PluginsNotInstalled)

	// what comes back, and what does not
	unres := map[int64]*UnresolvedEntry{}
	byID := map[int64]EntryRef{}
	for _, e := range a.Entries {
		byID[e.ID] = e
	}
	note := func(entryID int64, card, overlay bool) {
		u := unres[entryID]
		if u == nil {
			ref := byID[entryID]
			u = &UnresolvedEntry{Written: ref.Written, Language: ref.Language}
			unres[entryID] = u
		}
		if card {
			u.Cards++
		}
		if overlay {
			u.Overlays++
		}
	}
	rep.Restores.Workspaces = len(a.Workspaces)
	rep.Restores.Books = len(a.Books)
	if err := a.PluginRows(func(r PluginRow) error {
		nr, drop := m.PluginRow(r)
		_ = nr
		isCard := r.PluginID == FlashcardsPlugin && strings.HasPrefix(r.Key, cardKeyPrefix)
		if drop {
			rep.Unresolved.DroppedRows++
			if isCard {
				if id, ok := intMember(r.Data, "entryId"); ok {
					if _, resolved := m.Entries[id]; !resolved {
						note(id, true, false)
					}
				}
			}
			return nil
		}
		rep.Restores.PluginData++
		if isCard {
			rep.Restores.Cards++
		}
		return nil
	}); err != nil {
		return rep, nil, err
	}
	if err := a.Overlays(func(o Overlay) error {
		if _, ok := m.Entries[o.EntryID]; ok {
			rep.Restores.Overlays++
		} else {
			rep.Unresolved.DroppedRows++
			note(o.EntryID, false, true)
		}
		return nil
	}); err != nil {
		return rep, nil, err
	}
	rep.Restores.Sentences = len(ownPresent)
	rep.Unresolved.DroppedRows += ownDropped
	rep.Restores.Bookmarks = a.Manifest.Counts["bookmarks"]
	rep.Restores.Highlights = a.Manifest.Counts["highlights"]
	rep.Restores.Events = a.Manifest.Counts["events"]
	// entries that nothing refers to by card/overlay but are unresolved still count
	for _, e := range a.Entries {
		if _, ok := m.Entries[e.ID]; !ok {
			if _, seen := unres[e.ID]; !seen {
				note(e.ID, false, false)
			}
		}
	}
	list := make([]UnresolvedEntry, 0, len(unres))
	for _, u := range unres {
		list = append(list, *u)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Written != list[j].Written {
			return list[i].Written < list[j].Written
		}
		return list[i].Language < list[j].Language
	})
	rep.Unresolved.EntryCount = len(list)
	rep.Unresolved.Entries = list[:min(len(list), maxListed)]

	// events whose id already belongs to another user get a new ULID on restore
	st, err := db.PrepareContext(ctx, `SELECT 1 FROM study_events WHERE id = ? AND user_id <> ?`)
	if err != nil {
		return rep, nil, err
	}
	defer st.Close()
	if err := a.Events(func(e Event) error {
		var one int
		err := st.QueryRowContext(ctx, e.ID, userID).Scan(&one)
		if err == nil {
			rep.ReidentifiedEvents++
		} else if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		return ctx.Err()
	}); err != nil {
		return rep, nil, err
	}

	// what is replaced
	rep.Replaces, err = CurrentCounts(ctx, db, userID)
	if err != nil {
		return rep, nil, err
	}
	slices.Sort(rep.PluginsNotInstalled)
	return rep, m, nil
}

// CurrentCounts counts the user's rows a restore replaces.
func CurrentCounts(ctx context.Context, db *sql.DB, userID int64) (Counts, error) {
	var c Counts
	for _, q := range []struct {
		dst *int
		sql string
	}{
		{&c.Workspaces, `SELECT COUNT(*) FROM workspaces WHERE user_id = ?`},
		{&c.Events, `SELECT COUNT(*) FROM study_events WHERE user_id = ?`},
		{&c.Cards, `SELECT COUNT(*) FROM plugin_data WHERE user_id = ? AND deleted_at IS NULL AND pack_id = '` + FlashcardsPlugin + `' AND key LIKE 'card:%'`},
		{&c.PluginData, `SELECT COUNT(*) FROM plugin_data WHERE user_id = ? AND deleted_at IS NULL`},
		{&c.Overlays, `SELECT COUNT(*) FROM user_edits WHERE user_id = ?`},
		{&c.Sentences, `SELECT COUNT(*) FROM sentences WHERE user_id = ? AND deleted_at IS NULL`},
		{&c.Books, `SELECT COUNT(*) FROM library_books WHERE user_id = ?`},
		{&c.Bookmarks, `SELECT COUNT(*) FROM library_bookmarks WHERE user_id = ?`},
		{&c.Highlights, `SELECT COUNT(*) FROM library_highlights WHERE user_id = ?`},
	} {
		if err := db.QueryRowContext(ctx, q.sql, userID).Scan(q.dst); err != nil {
			return c, fmt.Errorf("count: %w", err)
		}
	}
	return c, nil
}
