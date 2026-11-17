package sync_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"qinqin/internal/model"
	"qinqin/internal/plugins"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
	chinsync "qinqin/internal/sync"
)

// The streamed legacy pull (B4): the same answer as the former in-memory
// pull for the caller's own data, one row in memory at a time.

// formerPull is the former sync.Pull (v0.4.0-prep before B4) for the
// user collections, kept as the oracle: every collection in memory, the
// legacy view merged by a stable sort. The lexicon collections are []: the
// seeds that use it hold no lexicon rows (checked).
func formerPull(t *testing.T, ctx context.Context, sqlDB *sql.DB, userID int64, cursor, now time.Time, only map[string]bool) []byte {
	t.Helper()
	var n int
	if err := sqlDB.QueryRow(`SELECT (SELECT COUNT(*) FROM entries) + (SELECT COUNT(*) FROM sentences WHERE user_id IS NULL)`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("the oracle seed holds %d lexicon rows (%v)", n, err)
	}
	d := chinsync.Delta{
		Cursor:  now.UTC().Add(-30 * time.Second).Truncate(time.Second),
		Entries: []json.RawMessage{}, Links: []json.RawMessage{}, Senses: []json.RawMessage{}, LevelMembers: []json.RawMessage{},
		Sentences: []model.Sentence{}, PluginData: []model.PluginData{}, PluginStates: []model.PluginState{},
		Overlays: []chinsync.Overlay{}, Dictionaries: []json.RawMessage{}, Schemes: []json.RawMessage{}, Levels: []json.RawMessage{},
		Cards: []rows.Card{}, Decks: []rows.Deck{}, DeckSettings: []rows.DeckSettingsRow{}, Limits: []rows.LimitsRow{},
		FsrsSets: []rows.FsrsSet{}, FsrsActive: []rows.FsrsActiveRow{},
	}
	since := cursor.UTC().Format(time.RFC3339)
	live := ""
	if cursor.IsZero() {
		live = " AND deleted_at IS NULL"
	}
	want := func(name string) bool { return only == nil || only[name] }
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	parse := func(s string) time.Time {
		v, err := time.Parse(time.RFC3339, s)
		must(err)
		return v
	}
	if want("sentences") {
		list, err := sqlDB.QueryContext(ctx, `SELECT id, entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at, deleted_at
			FROM sentences WHERE updated_at >= ?`+live+` AND (user_id IS NULL OR user_id = ?) ORDER BY id`, since, userID)
		must(err)
		for list.Next() {
			var s model.Sentence
			var owner sql.NullInt64
			var updated string
			var deleted sql.NullString
			must(list.Scan(&s.ID, &s.EntryID, &s.SourcePack, &owner, &s.Hanzi, &s.Pinyin, &s.Translation, &updated, &deleted))
			if owner.Valid {
				s.UserID = &owner.Int64
			}
			s.UpdatedAt = parse(updated)
			if deleted.Valid {
				x := parse(deleted.String)
				s.DeletedAt = &x
			}
			d.Sentences = append(d.Sentences, s)
		}
		list.Close()
	}
	if want("pluginData") {
		data, err := plugins.PullData(ctx, sqlDB, userID, cursor)
		must(err)
		if cursor.IsZero() {
			kept := []model.PluginData{}
			for _, r := range data {
				if r.DeletedAt == nil {
					kept = append(kept, r)
				}
			}
			data = kept
		}
		view := only != nil && only["pluginData"]
		for _, f := range rows.Families {
			view = view && !only[string(f)]
		}
		if view {
			kept := data[:0]
			for _, r := range data {
				if r.PluginID == rows.Namespace && r.WorkspaceID != nil {
					shadowed, err := study.HasTypedRow(ctx, sqlDB, userID, *r.WorkspaceID, r.Key)
					must(err)
					if shadowed {
						continue
					}
				}
				kept = append(kept, r)
			}
			legacy, err := study.LegacyRows(ctx, sqlDB, userID, cursor)
			must(err)
			data = append(kept, legacy...)
			sort.SliceStable(data, func(i, j int) bool {
				a, b := data[i], data[j]
				if !a.UpdatedAt.Equal(b.UpdatedAt) {
					return a.UpdatedAt.Before(b.UpdatedAt)
				}
				if a.PluginID != b.PluginID {
					return a.PluginID < b.PluginID
				}
				return a.Key < b.Key
			})
		}
		d.PluginData = data
	}
	if want("overlays") {
		list, err := sqlDB.QueryContext(ctx, `SELECT entry_id, written, readings, updated_at FROM user_edits
			WHERE user_id = ? AND updated_at >= ? ORDER BY entry_id`, userID, since)
		must(err)
		for list.Next() {
			var o chinsync.Overlay
			var written, readings sql.NullString
			var updated string
			must(list.Scan(&o.EntryID, &written, &readings, &updated))
			if written.Valid {
				o.Written = &written.String
			}
			if readings.Valid {
				must(json.Unmarshal([]byte(readings.String), &o.Readings))
			}
			o.UpdatedAt = parse(updated)
			d.Overlays = append(d.Overlays, o)
		}
		list.Close()
	}
	if want("pluginStates") {
		list, err := sqlDB.QueryContext(ctx, `SELECT pack_id, user_id, enabled, ord, updated_at FROM plugin_states
			WHERE user_id = ? AND updated_at >= ? ORDER BY pack_id`, userID, since)
		must(err)
		for list.Next() {
			var s model.PluginState
			var enabled int
			var updated string
			must(list.Scan(&s.PluginID, &s.UserID, &enabled, &s.Order, &updated))
			s.Enabled = enabled != 0
			s.UpdatedAt = parse(updated)
			d.PluginStates = append(d.PluginStates, s)
		}
		list.Close()
	}
	families := map[rows.Family]bool{}
	for _, f := range rows.Families {
		if want(string(f)) {
			families[f] = true
		}
	}
	if len(families) > 0 {
		typed, err := study.Pull(ctx, sqlDB, userID, cursor, families)
		must(err)
		d.Cards, d.Decks, d.DeckSettings = typed.Cards, typed.Decks, typed.DeckSettings
		d.Limits, d.FsrsSets, d.FsrsActive = typed.Limits, typed.FsrsSets, typed.FsrsActive
	}
	raw, err := json.Marshal(d)
	must(err)
	return raw
}

func streamLegacy(t *testing.T, ctx context.Context, sqlDB *sql.DB, userID int64, cursor time.Time, only map[string]bool) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := chinsync.StreamLegacy(ctx, &buf, sqlDB, userID, cursor, only); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestLegacyAnswerEqualsTheFormerPull(t *testing.T) {
	ctx := context.Background()
	fx := readLegacyFixture(t)
	w := newLegacyWorld(t, fx) // typed rows of every family and leftover qinqin-flashcards rows
	now := time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC)
	defer chinsync.SetLegacyClock(func() time.Time { return now })()
	bob := newUser(t, w.db, "bob")
	bobWS := newWorkspace(t, w.db, bob)
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := w.db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, u := range []struct {
		user, ws int64
		tag      string
	}{{w.user, w.ws, "a"}, {bob, bobWS, "b"}} {
		// Plugin rows around the typed rows' stamp (ties by plugin and key),
		// a user-global row, a tombstone, a leftover the typed rows shadow.
		for i, r := range []struct{ pack, key, at, del string }{
			{"qinqin-core", "settings", "2026-11-12T10:00:00Z", ""},
			{"heatmap", "zz", "2026-11-12T10:00:00Z", ""},
			{"qinqin-core", "gone", "2026-11-12T09:00:00Z", "2026-11-12T09:00:00Z"},
			{"qinqin-flashcards", "card:c-vocab-1201", "2026-11-12T10:00:00Z", ""},
			{"qinqin-reader", "pos", "2026-11-12T11:00:00Z", ""},
		} {
			var ws any = u.ws
			if i == 4 {
				ws = nil
			}
			var del any
			if r.del != "" {
				del = r.del
			}
			exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at, deleted_at)
				VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`, r.pack, u.user, ws, r.key, `{"`+u.tag+`":"<&>"}`, r.at, r.at, del)
		}
		exec(`INSERT INTO plugin_states (user_id, pack_id, enabled, ord, updated_at) VALUES (?, 'heatmap', 1, 2, '2026-11-12T08:00:00Z'), (?, 'qinqin-core', 0, 1, '2026-11-12T08:00:01Z')`, u.user, u.user)
		exec(`INSERT INTO user_edits (user_id, entry_id, written, readings, updated_at) VALUES (?, 7, ?, '[{"type":"pinyin","value":"hǎo"}]', '2026-11-12T08:00:02Z'), (?, 3, NULL, NULL, '2026-11-12T08:00:03Z')`, u.user, "好"+u.tag, u.user)
		exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at, deleted_at) VALUES
			(7, '', ?, ?, 'p', 't', '2026-11-12T08:00:04Z', NULL), (7, '', ?, 'x', '', '', '2026-11-12T08:00:05Z', '2026-11-12T08:00:05Z')`, u.user, "你好"+u.tag, u.user)
	}
	// Equal (updatedAt, plugin, key) across workspaces: a second workspace of
	// alice holds a typed card and a leftover deck row under the same keys
	// and stamp as the first one's typed rows (ties go to plugin rows first,
	// then family order, then workspace order).
	res, err := w.db.Exec(`INSERT INTO workspaces (user_id, language, settings, updated_at) VALUES (?, 'ja', '{}', '2026-11-12T07:00:00Z')`, w.user)
	if err != nil {
		t.Fatal(err)
	}
	ws2, _ := res.LastInsertId()
	// c-aaa sorts before the first workspace's cards by key, after them by
	// workspace.
	for _, id := range []string{"c-vocab-1201", "c-aaa"} {
		card, err := rows.FromLegacy("card:"+id, json.RawMessage(`{"id":"`+id+`","kind":"vocab","entryId":5,"deckIds":[],"createdAt":"t"}`))
		if err != nil {
			t.Fatal(err)
		}
		card.M().WorkspaceID = ws2
		if err := study.InsertStored(ctx, w.db, w.user, card, 1, "2026-11-12T10:00:00Z", "2026-11-12T10:00:00Z", nil); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at)
		VALUES ('qinqin-flashcards', ?, ?, 'deck:01JDECK', '{"leftover":true}', 1, '2026-11-12T10:00:00Z', '2026-11-12T10:00:00Z')`, w.user, ws2)
	for _, q := range []map[string]bool{
		nil,
		{"pluginData": true, "pluginStates": true},
		{"pluginData": true},
		{"pluginData": true, "pluginStates": true, "cards": true, "decks": true, "deckSettings": true, "limits": true, "fsrsSets": true, "fsrsActive": true},
		{"sentences": true, "overlays": true},
		{"limits": true, "fsrsActive": true},
	} {
		for _, cursor := range []time.Time{{}, time.Unix(0, 0), time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC)} {
			for _, user := range []int64{w.user, bob} {
				want := formerPull(t, ctx, w.db, user, cursor, now, q)
				got := streamLegacy(t, ctx, w.db, user, cursor, q)
				if !bytes.Equal(got, want) {
					t.Errorf("user %d, collections %v, cursor %s:\n got %s\nwant %s", user, q, cursor.Format(time.RFC3339), got, want)
				}
			}
		}
	}
	// The legacy view really merged typed rows into pluginData.
	got := streamLegacy(t, ctx, w.db, w.user, time.Unix(0, 0), map[string]bool{"pluginData": true})
	if !bytes.Contains(got, []byte(`"key":"deck:01JDECK"`)) || bytes.Count(got, []byte(`"key":"card:c-vocab-1201"`)) != 2 {
		t.Errorf("legacy view answer: %s", got)
	}
}

// rowCounter counts the rows written to it: the stream writes each row in
// one Write, starting with { (the first of an array) or ,{.
type rowCounter struct {
	rows  int
	bytes int
	after func(rows int)
}

func (c *rowCounter) Write(p []byte) (int, error) {
	c.bytes += len(p)
	if (bytes.HasPrefix(p, []byte("{")) && !bytes.HasPrefix(p, []byte(`{"cursor"`))) || bytes.HasPrefix(p, []byte(",{")) {
		c.rows++
		if c.after != nil {
			c.after(c.rows)
		}
	}
	return len(p), nil
}

// seedPluginRows writes n plugin rows of user in one transaction.
func seedPluginRows(t *testing.T, sqlDB *sql.DB, user int64, ws *int64, n, size int) {
	t.Helper()
	tx, err := sqlDB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	st, err := tx.Prepare(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at)
		VALUES ('qinqin-core', ?, ?, ?, ?, 1, ?, ?)`)
	if err != nil {
		t.Fatal(err)
	}
	data := `"` + strings.Repeat("x", size) + `"`
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := range n {
		at := base.Add(time.Duration(i/3) * time.Second).Format(time.RFC3339)
		if _, err := st.Exec(user, ws, fmt.Sprintf("k%06d", i), data, at, at); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

// The encoder writes row i before it scans row i+1: one row in memory (on
// the legacy view, one per merged source).
func TestLegacyWritesEachRowBeforeScanningTheNext(t *testing.T) {
	ctx := context.Background()
	fx := readLegacyFixture(t)
	w := newLegacyWorld(t, fx)
	seedPluginRows(t, w.db, w.user, &w.ws, 3000, 10)
	for _, c := range []struct {
		name  string
		only  map[string]bool
		ahead int
	}{
		{"every collection", nil, 1},
		{"plugin data", map[string]bool{"pluginData": true, "cards": true}, 1},
		{"the legacy view", map[string]bool{"pluginData": true, "pluginStates": true}, 1 + len(rows.Families)},
	} {
		out := &rowCounter{}
		scans := 0
		worst := 0
		restore := chinsync.SetLegacyScanHook(func() {
			scans++
			worst = max(worst, scans-out.rows)
		})
		if err := chinsync.StreamLegacy(ctx, out, w.db, w.user, time.Unix(0, 0), c.only); err != nil {
			t.Fatal(err)
		}
		restore()
		if scans < 3000 || out.rows != scans {
			t.Errorf("%s: %d rows scanned, %d written", c.name, scans, out.rows)
		}
		if worst > c.ahead {
			t.Errorf("%s: %d rows scanned ahead of the writer, want at most %d", c.name, worst, c.ahead)
		}
	}
}

// A 100,000-row account is answered with bounded memory.
func TestLegacyHeapStaysBounded(t *testing.T) {
	if testing.Short() {
		t.Skip("100,000 rows")
	}
	ctx := context.Background()
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	ws := newWorkspace(t, sqlDB, alice)
	seedPluginRows(t, sqlDB, alice, &ws, 100_000, 200) // about 33 MB of JSON
	var ms runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&ms)
	base, peak := ms.HeapAlloc, ms.HeapAlloc
	out := &rowCounter{after: func(n int) {
		if n%2000 == 0 {
			runtime.ReadMemStats(&ms)
			peak = max(peak, ms.HeapAlloc)
		}
	}}
	if err := chinsync.StreamLegacy(ctx, out, sqlDB, alice, time.Time{}, nil); err != nil {
		t.Fatal(err)
	}
	if out.rows != 100_000 || out.bytes < 30_000_000 {
		t.Fatalf("%d rows, %d bytes written", out.rows, out.bytes)
	}
	growth := int64(peak) - int64(base)
	t.Logf("HeapAlloc growth %.1f MiB for %.1f MB of answer", float64(growth)/(1<<20), float64(out.bytes)/1e6)
	if growth > 16<<20 {
		t.Errorf("HeapAlloc grew by %d bytes, want under 16 MiB", growth)
	}
}

// A canceled request stops the scan.
func TestLegacyStopsOnCancel(t *testing.T) {
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	ws := newWorkspace(t, sqlDB, alice)
	seedPluginRows(t, sqlDB, alice, &ws, 2000, 10)
	for _, only := range []map[string]bool{nil, {"pluginData": true}} {
		ctx, cancel := context.WithCancel(context.Background())
		scans := 0
		restore := chinsync.SetLegacyScanHook(func() { scans++ })
		out := &rowCounter{after: func(n int) {
			if n == 100 {
				cancel()
			}
		}}
		err := chinsync.StreamLegacy(ctx, out, sqlDB, alice, time.Time{}, only)
		restore()
		cancel()
		if !errors.Is(err, context.Canceled) {
			t.Errorf("%v: err %v, want context.Canceled", only, err)
		}
		if scans > 100+1+len(rows.Families) || out.rows != 100 {
			t.Errorf("%v: %d rows scanned, %d written after the cancel at 100", only, scans, out.rows)
		}
	}
}
