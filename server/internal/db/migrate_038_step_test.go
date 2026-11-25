package db

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

// legacyRow is one qinqin-flashcards plugin_data row of the v0.3.0 fixture.
type legacyRow struct {
	pack      string
	user      int64
	ws        any // nil for a user-global row
	key, data string
	version   int
	updated   string
	modified  any // nil for a row written before migration 011
	deleted   any
}

const (
	w     = `[0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542]`
	fc    = "qinqin-flashcards"
	t1    = "2026-11-10T08:00:00Z"
	t2    = "2026-11-12T10:00:00Z"
	t2mod = "2026-11-12T09:59:58Z"
)

// v030Fixture is a hand-made v0.3.0-shaped database: two users, three
// workspaces (1 and 2 of user 1, 3 of user 2).
func v030Fixture() (readable, left []legacyRow) {
	readable = []legacyRow{
		{fc, 1, 1, "card:c-vocab-1201", `{"id":"c-vocab-1201","kind":"vocab","entryId":1201,"deckIds":["general"],"createdAt":"` + t1 + `"}`, 3, t2, t2mod, nil},
		{fc, 1, 1, "card:c-vocab-1202", `{"id":"c-vocab-1202","kind":"vocab","entryId":1202,"written":"你好","skipKinds":["writing","tone"],"deckIds":["general","01JDECK"],"createdAt":"` + t1 + `","futureMember":{"a":[1,2]}}`, 1, t1, nil, nil},
		{fc, 1, 1, "card:c-sentence-1201", `{"id":"c-sentence-1201","kind":"sentence","entryId":1201,"sentenceId":88,"deckIds":["general"],"createdAt":"` + t1 + `"}`, 2, t2, t2, nil},
		{fc, 1, 1, "card:c-writing-77", `{"id":"c-writing-77","kind":"writing","entryId":77,"entryKind":"character","deckIds":[],"createdAt":"` + t1 + `"}`, 1, t1, t1, nil},
		{fc, 1, 1, "card:01JULIDCARD", `{"id":"01JULIDCARD","kind":"cloze","entryId":5,"deckIds":["01JDECK"],"createdAt":"` + t1 + `"}`, 4, t2, t2mod, nil},
		// a tombstoned card keeps its last data
		{fc, 1, 1, "card:c-tone-9", `{"id":"c-tone-9","kind":"tone","entryId":9,"deckIds":["general"],"createdAt":"` + t1 + `"}`, 5, t2, t2mod, t2},
		{fc, 1, 2, "card:c-vocab-1201", `{"id":"c-vocab-1201","kind":"vocab","entryId":1201,"deckIds":["general"],"createdAt":"` + t1 + `"}`, 1, t1, t1, nil},
		{fc, 1, 1, "deck:01JDECK", `{"id":"01JDECK","name":"Words","createdAt":"` + t1 + `"}`, 2, t2, t2mod, nil},
		{fc, 1, 1, "deck:d-lvl-hsk-1", `{"id":"d-lvl-hsk-1","name":"HSK 1","createdAt":"` + t1 + `","source":{"type":"level","packId":"hsk","level":"1"}}`, 1, t1, nil, nil},
		{fc, 1, 1, "deck:d-frq-subtlex-1000", `{"id":"d-frq-subtlex-1000","name":"Top","createdAt":"` + t1 + `","source":{"type":"frequency","packId":"subtlex","size":1000}}`, 1, t1, t1, nil},
		{fc, 1, 1, "deck:01JGONE", `{"id":"01JGONE","name":"Gone","createdAt":"` + t1 + `"}`, 3, t2, t2mod, t2},
		{fc, 1, 1, "deckcfg:general", `{"deckId":"general","cardTypes":["reverse","cloze"],"newOrder":{"by":"level","packId":"hsk-words"},"updatedAt":"` + t2mod + `"}`, 2, t2, t2mod, nil},
		{fc, 1, 1, "deckcfg:01JDECK", `{"deckId":"01JDECK","cardTypes":[],"newOrder":{"by":"level"},"zoom":2,"updatedAt":"` + t1 + `"}`, 1, t1, nil, nil},
		{fc, 1, 1, "limits:workspace", `{"version":1,"new":10,"reviews":null}`, 2, t2, t2mod, nil},
		{fc, 1, 1, "limits:deck:general", `{"version":1,"new":0}`, 1, t1, t1, nil},
		{fc, 1, 1, "limits:deck:01JDECK", `{"version":1,"new":10000,"reviews":50}`, 1, t1, t1, nil},
		{fc, 1, 1, "fsrs:set:01JSET1", `{"id":"01JSET1","w":` + w + `,"createdAt":"` + t1 + `","source":"optimized","labelled":420,"logLoss":0.31,"baselineLogLoss":0.35}`, 1, t1, t1, nil},
		{fc, 1, 1, "fsrs:set:01JSET2", `{"id":"01JSET2","w":` + w + `,"createdAt":"` + t1 + `","source":"imported"}`, 1, t1, t1, nil},
		{fc, 1, 1, "fsrs:active", `{"setId":"01JSET1","changedAt":"2026-11-11T07:00:00.000Z"}`, 3, t2, t2mod, nil},
		{fc, 1, 2, "fsrs:active", `{"setId":null,"changedAt":"2026-11-11T07:00:00.000Z"}`, 1, t1, nil, nil},
		// user 2's own rows in their own workspace
		{fc, 2, 3, "card:c-vocab-1201", `{"id":"c-vocab-1201","kind":"vocab","entryId":1201,"deckIds":["general"],"createdAt":"` + t2 + `"}`, 1, t2, t2, nil},
		{fc, 2, 3, "deck:01JDECK", `{"id":"01JDECK","name":"User 2 deck","createdAt":"` + t2 + `"}`, 1, t2, t2, nil},
	}
	left = []legacyRow{
		{fc, 1, 1, "card:c-vocab-15", `{"id":"c-vocab-15","kind":"vocab","entryId":1.5,"deckIds":["general"],"createdAt":"` + t1 + `"}`, 1, t1, t1, nil},
		{fc, 1, 2, "limits:workspace", `{"version":2,"new":1}`, 1, t1, t1, nil},
		{fc, 1, nil, "card:c-vocab-3", `{"id":"c-vocab-3","kind":"vocab","entryId":3,"deckIds":["general"],"createdAt":"` + t1 + `"}`, 1, t1, t1, nil},
		{fc, 1, 3, "card:c-vocab-4", `{"id":"c-vocab-4","kind":"vocab","entryId":4,"deckIds":["general"],"createdAt":"` + t1 + `"}`, 1, t1, t1, nil},
		{fc, 1, 1, "card:c-vocab-mismatch", `{"id":"c-vocab-other","kind":"vocab","entryId":4,"deckIds":["general"],"createdAt":"` + t1 + `"}`, 1, t1, nil, t1},
		{fc, 1, 1, "fsrs:active", `"broken"`, 1, t1, t1, nil}, // replaced below: one fsrs:active per workspace
		// keyed rows that stay plugin data
		{fc, 1, 1, "goals:workspace", `{"version":1,"history":[]}`, 1, t1, t1, nil},
		{fc, 1, 1, "known:5", `{"at":"` + t1 + `"}`, 1, t1, nil, nil},
		{fc, 1, nil, "vacation:01JVACATION", `{"id":"01JVACATION","start":"2026-11-01","end":"2026-11-03"}`, 1, t1, t1, nil},
		{fc, 1, 1, "limits:other", `{"version":1}`, 1, t1, t1, nil},
		{"qinqin-core", 1, 1, "note:1201", `{"text":"note"}`, 1, t1, t1, nil},
		{"qinqin-core", 1, 1, "card:not-flashcards", `{"id":"not-flashcards"}`, 1, t1, t1, nil},
		{"qinqin-journal", 2, 3, "deck:x", `{"id":"x","name":"n","createdAt":"t"}`, 1, t1, t1, nil},
	}
	// fsrs:active of workspace 1 is readable above; keep one broken active
	// row in workspace 3 of user 2 instead.
	left[5] = legacyRow{fc, 2, 3, "fsrs:active", `"broken"`, 1, t1, t1, nil}
	return readable, left
}

const pluginDataDump = `SELECT pack_id || '|' || user_id || '|' || IFNULL(workspace_id, 'NULL') || '|' || key || '|' || data || '|' ||
	version || '|' || updated_at || '|' || IFNULL(modified_at, 'NULL') || '|' || IFNULL(deleted_at, 'NULL') FROM plugin_data ORDER BY rowid`

func dumpOf(r legacyRow) string {
	s := func(v any) string {
		if v == nil {
			return "NULL"
		}
		return fmt.Sprint(v)
	}
	return strings.Join([]string{r.pack, fmt.Sprint(r.user), s(r.ws), r.key, r.data, fmt.Sprint(r.version), r.updated, s(r.modified), s(r.deleted)}, "|")
}

func TestMigration038MovesStudyRows(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v030.db")
	sqlDB, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	if err := migrateThrough(sqlDB, "037_access_tokens"); err != nil {
		t.Fatal(err)
	}
	execAll(t, sqlDB,
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'alice', 'h', 1, 't'), (2, 'bob', 'h', 0, 't')`,
		`INSERT INTO workspaces (id, user_id, language, name, settings, updated_at) VALUES (1, 1, 'zh', '', '{}', 't'), (2, 1, 'ja', '', '{}', 't'), (3, 2, 'zh', '', '{}', 't')`)
	readable, left := v030Fixture()
	// interleave so rowid order mixes moved and kept rows
	var all []legacyRow
	for i := 0; i < len(readable) || i < len(left); i++ {
		if i < len(readable) {
			all = append(all, readable[i])
		}
		if i < len(left) {
			all = append(all, left[i])
		}
	}
	for _, r := range all {
		if _, err := sqlDB.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at, deleted_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.pack, r.user, r.ws, r.key, r.data, r.version, r.updated, r.modified, r.deleted); err != nil {
			t.Fatalf("insert %s: %v", r.key, err)
		}
	}
	for i := 0; i < 50; i++ {
		if _, err := sqlDB.Exec(`INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES (?, 1, 1, 'd', ?, 'review', ?, 't')`,
			fmt.Sprintf("01JEVENT%018d", i), t1, fmt.Sprintf(`{"cardId":"c-vocab-1201","mode":"vocab","grade":%d}`, i%4+1)); err != nil {
			t.Fatal(err)
		}
	}
	const eventsDump = `SELECT id || '|' || user_id || '|' || workspace_id || '|' || device || '|' || ts || '|' || type || '|' || payload || '|' || updated_at FROM study_events ORDER BY rowid`
	eventsBefore := queryStrings(t, sqlDB, eventsDump)

	var logBuf bytes.Buffer
	log.SetOutput(&logBuf)
	defer log.SetOutput(os.Stderr)
	// Through 038 only: later migrations (044 and on, #199) move or drop plugin_data.
	if err := migrateThrough(sqlDB, "038_core_study"); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	// The rows no client could read, and every keyed row, stay byte for byte.
	var wantLeft []string
	for _, r := range all {
		for _, l := range left {
			if reflect.DeepEqual(r, l) {
				wantLeft = append(wantLeft, dumpOf(r))
			}
		}
	}
	if got := queryStrings(t, sqlDB, pluginDataDump); !reflect.DeepEqual(got, wantLeft) {
		t.Errorf("plugin_data after 038:\n got %v\nwant %v", strings.Join(got, "\n"), strings.Join(wantLeft, "\n"))
	}
	if got := queryStrings(t, sqlDB, eventsDump); !reflect.DeepEqual(got, eventsBefore) {
		t.Errorf("study_events changed")
	}

	// Every readable row is in its table with its identity, version and stamps.
	ctx := context.Background()
	perFamily := map[rows.Family]int{}
	for _, r := range readable {
		f, _ := rows.FamilyOf(r.key)
		perFamily[f]++
		want, err := rows.FromLegacy(r.key, json.RawMessage(r.data))
		if err != nil {
			t.Fatalf("fixture row %s unreadable: %v", r.key, err)
		}
		got, ok, err := study.Load(ctx, sqlDB, r.user, int64(r.ws.(int)), f, want.Identity())
		if err != nil || !ok {
			t.Errorf("%s (user %d ws %v) not moved: %v", r.key, r.user, r.ws, err)
			continue
		}
		m := got.M()
		if m.Version != r.version || stamp(m.UpdatedAt) != r.updated {
			t.Errorf("%s: version %d updated %s, want %d %s", r.key, m.Version, m.UpdatedAt, r.version, r.updated)
		}
		wantMod := r.updated
		if r.modified != nil {
			wantMod = r.modified.(string)
		}
		if stamp(m.ModifiedAt) != wantMod {
			t.Errorf("%s: modified %s, want %s", r.key, m.ModifiedAt, wantMod)
		}
		if (m.DeletedAt == nil) != (r.deleted == nil) || (m.DeletedAt != nil && stamp(*m.DeletedAt) != r.deleted.(string)) {
			t.Errorf("%s: deleted %v, want %v", r.key, m.DeletedAt, r.deleted)
		}
		if !rows.Equal(got, want) {
			t.Errorf("%s: typed row differs from FromLegacy", r.key)
		}
		// The legacy form of the moved row is the original (the fixture rows
		// are written clean; deck settings carry updatedAt = modified_at).
		key, data := rows.ToLegacy(got)
		if key != r.key {
			t.Errorf("legacy key %s, want %s", key, r.key)
		}
		orig := r.data
		if f == rows.DeckSettings {
			var o map[string]any
			json.Unmarshal([]byte(orig), &o)
			o["updatedAt"] = wantMod
			b, _ := json.Marshal(o)
			orig = string(b)
		}
		if !sameJSON(t, data, []byte(orig)) {
			t.Errorf("%s: ToLegacy = %s, want %s", r.key, data, orig)
		}
	}
	wantLog := fmt.Sprintf("migration 038: moved %d study rows (cards %d, decks %d, deckSettings %d, limits %d, fsrsSets %d, fsrsActive %d), left 6 unreadable rows in plugin_data",
		len(readable), perFamily[rows.Cards], perFamily[rows.Decks], perFamily[rows.DeckSettings], perFamily[rows.Limits], perFamily[rows.FsrsSets], perFamily[rows.FsrsActive])
	if !strings.Contains(logBuf.String(), wantLog) {
		t.Errorf("log = %q, want %q", logBuf.String(), wantLog)
	}
	// Nothing else in the typed tables.
	var n int
	for _, tb := range study.Tables() {
		var c int
		sqlDB.QueryRow(`SELECT COUNT(*) FROM ` + tb).Scan(&c)
		n += c
	}
	if n != len(readable) {
		t.Errorf("typed tables hold %d rows, want %d", n, len(readable))
	}
	if got := queryStrings(t, sqlDB, `PRAGMA integrity_check`); !reflect.DeepEqual(got, []string{"ok"}) {
		t.Errorf("integrity_check = %v", got)
	}
}

// A migration whose Go step fails leaves plugin_data as it was.
func TestMigration038FailingStepKeepsPluginData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fail.db")
	sqlDB, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	if err := migrateThrough(sqlDB, "037_access_tokens"); err != nil {
		t.Fatal(err)
	}
	execAll(t, sqlDB,
		`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'alice', 'h', 1, 't')`,
		`INSERT INTO workspaces (id, user_id, language, name, settings, updated_at) VALUES (1, 1, 'zh', '', '{}', 't')`,
		`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at) VALUES ('qinqin-flashcards', 1, 1, 'deck:d', '{"id":"d","name":"n","createdAt":"t"}', 1, 't')`)
	before := queryStrings(t, sqlDB, pluginDataDump)
	restore := SetGoStepForTest("038_core_study", func(tx *sql.Tx) error {
		if err := coreStudyStep(tx); err != nil {
			return err
		}
		return fmt.Errorf("boom")
	})
	defer restore()
	if err := migrate(sqlDB); err == nil {
		t.Fatal("migrate succeeded with a failing step")
	}
	if got := queryStrings(t, sqlDB, pluginDataDump); !reflect.DeepEqual(got, before) {
		t.Errorf("plugin_data = %v, want %v", got, before)
	}
	if got := queryStrings(t, sqlDB, `SELECT name FROM sqlite_master WHERE name = 'study_decks'`); len(got) != 0 {
		t.Errorf("study_decks exists after a failed migration")
	}
}

func sameJSON(t *testing.T, a, b []byte) bool {
	t.Helper()
	var x, y any
	if err := json.Unmarshal(a, &x); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &y); err != nil {
		t.Fatal(err)
	}
	return reflect.DeepEqual(x, y)
}

func stamp(tm interface{ Format(string) string }) string {
	return tm.Format("2006-01-02T15:04:05Z07:00")
}
