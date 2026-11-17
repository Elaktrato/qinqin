package sync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"qinqin/internal/db"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

func newWorld(t *testing.T) *world {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "v2.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return &world{t: t, db: sqlDB, users: map[string]int64{}, ws: map[string]int64{}, wsLang: map[int64]string{},
		entries: map[string]int64{}, plugin: "qinqin-core", rowsByRef: map[string]placed{}, refOf: map[string]string{}}
}

func (w *world) entry(ref, language string) {
	res := w.exec(`INSERT INTO entries (language, kind, ext_key, updated_at) VALUES (?, 'word', ?, '2026-01-01T00:00:00Z')`, language, ref)
	w.entries[ref], _ = res.LastInsertId()
}

func strp(s string) *string { return &s }

// seedEverything gives user one live row in every collection and a
// tombstone wherever the collection has them, in workspace ws (language zh).
func seedEverything(w *world, user, ws string) {
	if _, ok := w.ws[ws]; !ok {
		w.addWorkspace(ws, user, "zh", "2026-11-12T07:00:00Z")
	}
	e := ws + "-e"
	w.entry(e, "zh")
	at := func(m int) string { return time.Date(2026, 11, 12, 8, m, 0, 0, time.UTC).Format(time.RFC3339) }
	for i, r := range []roundRow{
		{Ref: ws + "-s", Collection: "pluginStates"},
		{Ref: ws + "-d", Collection: "pluginData", Workspace: strp(ws)},
		{Ref: ws + "-dg", Collection: "pluginData"},
		{Ref: ws + "-dx", Collection: "pluginData", Workspace: strp(ws), DeletedAt: "x"},
		{Ref: ws + "-c", Collection: "cards", Workspace: strp(ws), Entry: e},
		{Ref: ws + "-cx", Collection: "cards", Workspace: strp(ws), Entry: e, DeletedAt: "x"},
		{Ref: ws + "-b", Collection: "books", Workspace: strp(ws)},
		{Ref: ws + "-bx", Collection: "books", Workspace: strp(ws), DeletedAt: "x"},
		{Ref: ws + "-m", Collection: "bookmarks", Book: ws + "-b"},
		{Ref: ws + "-mx", Collection: "bookmarks", Book: ws + "-b", DeletedAt: "x"},
		{Ref: ws + "-h", Collection: "highlights", Book: ws + "-b"},
		{Ref: ws + "-hx", Collection: "highlights", Book: ws + "-b", DeletedAt: "x"},
		{Ref: ws + "-o", Collection: "overlays", Entry: e},
		{Ref: ws + "-n", Collection: "sentences", Entry: e},
		{Ref: ws + "-nx", Collection: "sentences", Entry: e, DeletedAt: "x"},
		{Ref: ws + "-v", Collection: "events", Workspace: strp(ws), Type: "review"},
		{Ref: ws + "-vl", Collection: "events", Workspace: strp(ws), Type: "lookup"},
	} {
		r.User = user
		r.UpdatedAt = at(i)
		if r.DeletedAt != "" {
			r.DeletedAt = r.UpdatedAt
		}
		w.addRow(r)
	}
}

// roundRefs pulls a whole round and returns the refs of every row by
// collection (unknown rows as "?<id>").
func roundRefs(t *testing.T, w *world, user int64, req PageRequest) (map[string][]string, string) {
	t.Helper()
	pc := loadPageContract(t)
	got := map[string][]string{}
	requested := V2Collections
	if len(req.Only) > 0 {
		requested = nil
		for _, c := range V2Collections {
			if req.Only[c] {
				requested = append(requested, c)
			}
		}
	}
	for n := 0; ; n++ {
		p, err := PullPage(context.Background(), w.db, user, req, testCatalogue)
		if err != nil {
			t.Fatalf("page %d: %v", n, err)
		}
		raw, _ := json.Marshal(p)
		if err := pc.validatePage(raw, requested, ""); err != nil {
			t.Fatalf("page %d breaks the contract: %v\n%s", n, err, raw)
		}
		for name, list := range p.Collections {
			var items []json.RawMessage
			json.Unmarshal(list, &items)
			for _, item := range items {
				id, _, _ := naturalID(name, item)
				ref, ok := w.refOf[refKey(name, user, id)]
				if !ok {
					ref = "?" + id
				}
				got[name] = append(got[name], ref)
			}
		}
		if !p.More {
			return got, *p.Cursor
		}
		req = PageRequest{Page: *p.Next, Now: req.Now}
	}
}

func TestV2ShipsEveryCollectionOfTheCaller(t *testing.T) {
	w := newWorld(t)
	seedEverything(w, "alice", "a")
	alice := w.users["alice"]
	now := at("2026-11-12T10:00:00Z")
	got, cur := roundRefs(t, w, alice, PageRequest{Limit: 3, Now: now})
	want := map[string][]string{
		"workspaces": {"a"}, "pluginStates": {"a-s"}, "pluginData": {"a-d", "a-dg"}, "cards": {"a-c"},
		"books": {"a-b"}, "bookmarks": {"a-m"}, "highlights": {"a-h"}, "overlays": {"a-o"}, "sentences": {"a-n"},
		"events": {"a-v"},
	}
	for _, c := range V2Collections {
		if !slices.Equal(got[c], want[c]) {
			t.Errorf("from no since: %s = %v, want %v", c, got[c], want[c])
		}
	}
	// The next round ships only what changed since.
	w.exec(`UPDATE workspaces SET updated_at = '2026-11-12T10:30:00Z'`)
	got, _ = roundRefs(t, w, alice, PageRequest{Since: cur, Now: at("2026-11-12T11:00:00Z")})
	if !slices.Equal(got["workspaces"], []string{"a"}) || len(got) != 1 {
		t.Errorf("delta after a workspace rename = %v", got)
	}
}

func TestV2DeltaShipsTombstones(t *testing.T) {
	w := newWorld(t)
	w.addWorkspace("a", "alice", "zh", "2026-11-12T07:00:00Z")
	alice := w.users["alice"]
	// A first round makes a cursor from before every other row (with the
	// same language set, so nothing restarts).
	_, cur := roundRefs(t, w, alice, PageRequest{Now: at("2026-11-12T07:30:00Z")})
	seedEverything(w, "alice", "a")
	got, _ := roundRefs(t, w, alice, PageRequest{Since: cur, Now: at("2026-11-12T10:00:00Z")})
	want := map[string][]string{
		"pluginStates": {"a-s"}, "pluginData": {"a-d", "a-dg", "a-dx"}, "cards": {"a-c", "a-cx"},
		"books": {"a-b", "a-bx"}, "bookmarks": {"a-m", "a-mx"}, "highlights": {"a-h", "a-hx"}, "overlays": {"a-o"},
		"sentences": {"a-n", "a-nx"}, "events": {"a-v"},
	}
	// The workspace is stamped 07:00, before the cursor (07:29:30).
	for _, c := range V2Collections {
		if !slices.Equal(got[c], want[c]) {
			t.Errorf("delta: %s = %v, want %v", c, got[c], want[c])
		}
	}
}

func TestV2TwoUsersNeverSeeEachOthersRows(t *testing.T) {
	w := newWorld(t)
	seedEverything(w, "alice", "a")
	w.addWorkspace("bw", "bob", "zh", "2026-11-12T07:00:00Z")
	alice, bob := w.users["alice"], w.users["bob"]
	now := at("2026-11-12T10:00:00Z")
	got, cur := roundRefs(t, w, bob, PageRequest{Now: now})
	if len(got) != 1 || !slices.Equal(got["workspaces"], []string{"bw"}) {
		t.Errorf("bob from no since = %v, want only his workspace", got)
	}
	got, _ = roundRefs(t, w, bob, PageRequest{Since: cur, Now: now.Add(time.Hour)})
	if len(got) != 0 {
		t.Errorf("bob delta = %v, want nothing", got)
	}
	_, earlier := roundRefs(t, w, bob, PageRequest{Now: at("2026-11-12T06:00:00Z")})
	got, _ = roundRefs(t, w, bob, PageRequest{Since: earlier, Now: now})
	if len(got) != 1 || !slices.Equal(got["workspaces"], []string{"bw"}) {
		t.Errorf("bob delta with tombstones = %v, want only his workspace", got)
	}
	// Alice's tokens are refused for bob, and her workspace is not his.
	p, err := PullPage(context.Background(), w.db, alice, PageRequest{Limit: 1, Now: now}, testCatalogue)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := PullPage(context.Background(), w.db, bob, PageRequest{Page: *p.Next, Now: now}, testCatalogue); !errors.Is(err, ErrPageInvalid) {
		t.Errorf("bob with alice's page token: %v", err)
	}
	_, aliceCur := roundRefs(t, w, alice, PageRequest{Now: now})
	if _, err := PullPage(context.Background(), w.db, bob, PageRequest{Since: aliceCur, Now: now}, testCatalogue); !errors.Is(err, ErrPageInvalid) {
		t.Errorf("bob with alice's cursor: %v", err)
	}
	if _, err := PullPage(context.Background(), w.db, bob, PageRequest{Workspace: w.ws["a"], Now: now}, testCatalogue); !errors.Is(err, ErrNotFound) {
		t.Errorf("bob with alice's workspace: %v", err)
	}
	// A page token whose workspace is alice's is refused for bob even if
	// forged with his user id.
	forged := pageToken{User: bob, Until: "2026-11-12T10:00:00Z", Filters: filters{Collections: V2Collections, Workspace: w.ws["a"]},
		Limit: 10, Languages: []string{"zh"}}
	if _, err := PullPage(context.Background(), w.db, bob, PageRequest{Page: forged.encode(), Now: now}, testCatalogue); !errors.Is(err, ErrNotFound) {
		t.Errorf("forged token with alice's workspace: %v", err)
	}
}

func TestV2WorkspaceNarrowsLibraryTombstones(t *testing.T) {
	w := newWorld(t)
	seedEverything(w, "alice", "a")
	seedEverything(w, "alice", "b")
	alice := w.users["alice"]
	// workspace= rounds bind the workspace into the cursor, so start one
	// before every row.
	_, wcur := roundRefs(t, w, alice, PageRequest{Workspace: w.ws["a"], Now: at("2026-11-12T06:00:00Z")})
	got, _ := roundRefs(t, w, alice, PageRequest{Workspace: w.ws["a"], Since: wcur, Now: at("2026-11-12T10:00:00Z")})
	all := []string{}
	for _, refs := range got {
		all = append(all, refs...)
	}
	for _, r := range []string{"b", "b-d", "b-dx", "b-c", "b-cx", "b-b", "b-bx", "b-m", "b-mx", "b-h", "b-hx", "b-v"} {
		if slices.Contains(all, r) {
			t.Errorf("workspace a round has %s of workspace b: %v", r, got)
		}
	}
	// Library tombstones of workspace a, user-global rows of both, and the
	// entry-bound rows of its language (b's entry is zh too).
	for _, r := range []string{"a", "a-bx", "a-mx", "a-hx", "a-dg", "b-dg", "a-s", "b-s", "a-o", "b-o", "a-nx", "b-nx"} {
		if !slices.Contains(all, r) {
			t.Errorf("workspace a round lacks %s: %v", r, got)
		}
	}
	for _, r := range all {
		if strings.HasPrefix(r, "?") {
			t.Errorf("workspace a round has a foreign row %s", r)
		}
	}
}

func TestV2ScopeOnTheFirstPageOnly(t *testing.T) {
	w := newWorld(t)
	w.addWorkspace("j", "alice", "ja", "2026-11-12T07:00:00Z")
	w.addWorkspace("z", "alice", "zh", "2026-11-12T07:00:00Z")
	w.addWorkspace("bz", "bob", "ko", "2026-11-12T07:00:00Z")
	alice := w.users["alice"]
	var langsSeen [][]string
	cat := func(_ context.Context, langs []string) (string, error) {
		langsSeen = append(langsSeen, langs)
		return `"etag"`, nil
	}
	now := at("2026-11-12T10:00:00Z")
	p, err := PullPage(context.Background(), w.db, alice, PageRequest{Limit: 1, Workspace: w.ws["z"], Now: now}, cat)
	if err != nil {
		t.Fatal(err)
	}
	if p.Scope == nil || p.Scope.Catalogue != `"etag"` || !slices.Equal(p.Scope.Languages, []string{"zh"}) {
		t.Fatalf("scope = %+v", p.Scope)
	}
	if len(p.Scope.Workspaces) != 2 || p.Scope.Workspaces[0].ID != w.ws["j"] || p.Scope.Workspaces[1] != (WorkspaceRef{ID: w.ws["z"], Language: "zh"}) {
		t.Errorf("scope workspaces = %+v, want both of alice's by id", p.Scope.Workspaces)
	}
	if len(langsSeen) != 1 || !slices.Equal(langsSeen[0], []string{"ja", "zh"}) {
		t.Errorf("catalogue asked for %v, want the caller's languages [ja zh]", langsSeen)
	}
	for p.More {
		p, err = PullPage(context.Background(), w.db, alice, PageRequest{Page: *p.Next, Now: now}, cat)
		if err != nil {
			t.Fatal(err)
		}
		if p.Scope != nil {
			t.Error("scope on a continuation page")
		}
	}
	if len(langsSeen) != 1 {
		t.Errorf("catalogue asked %d times, want once per round", len(langsSeen))
	}
}

// Typed rows ship exactly as study/rows.json writes them.
func TestV2TypedRowsAsStored(t *testing.T) {
	var file struct {
		Cases []struct {
			Collection string          `json:"collection"`
			Valid      bool            `json:"valid"`
			Row        json.RawMessage `json:"row"`
		} `json:"cases"`
	}
	raw, err := readContract("study", "rows.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	w := newWorld(t)
	w.addWorkspace("z", "alice", "zh", "2026-11-12T07:00:00Z")
	alice := w.users["alice"]
	wsID := w.ws["z"]
	wantRows := map[string]string{}
	for _, c := range file.Cases {
		if !c.Valid || wantRows[c.Collection] != "" {
			continue
		}
		var m map[string]any
		json.Unmarshal(c.Row, &m)
		if m["deletedAt"] != nil {
			continue
		}
		m["workspaceId"] = wsID
		row, _ := json.Marshal(m)
		r, err := rows.Decode(rows.Family(c.Collection), row)
		if err != nil {
			t.Fatalf("%s: %v", c.Collection, err)
		}
		if err := study.Insert(context.Background(), w.db, alice, r); err != nil {
			t.Fatalf("%s: %v", c.Collection, err)
		}
		wantRows[c.Collection] = string(row)
	}
	for _, f := range rows.Families {
		if wantRows[string(f)] == "" {
			t.Fatalf("rows.json has no live %s row", f)
		}
	}
	p, err := PullPage(context.Background(), w.db, alice, PageRequest{Only: map[string]bool{"cards": true, "decks": true,
		"deckSettings": true, "limits": true, "fsrsSets": true, "fsrsActive": true}, Now: at("2026-12-01T00:00:00Z")}, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range rows.Families {
		var list []json.RawMessage
		json.Unmarshal(p.Collections[string(f)], &list)
		if len(list) != 1 {
			t.Errorf("%s: %d rows, want 1", f, len(list))
			continue
		}
		var a, b any
		json.Unmarshal(list[0], &a)
		json.Unmarshal([]byte(wantRows[string(f)]), &b)
		ja, _ := json.Marshal(a)
		jb, _ := json.Marshal(b)
		if string(ja) != string(jb) {
			t.Errorf("%s:\n got %s\nwant %s", f, ja, jb)
		}
	}
}

// Every segment query of the real collections reads an index range in
// (stamp, rowid) order: no table scan of the walked table and no sort, with
// and without workspace=, live-only or with tombstones.
func TestV2SegmentQueriesUseAnIndex(t *testing.T) {
	w := newWorld(t)
	for _, s := range v2Set.segs {
		for _, ws := range []int64{0, 7} {
			for _, since := range []string{"", "2026-11-12T00:00:00Z"} {
				query := s.query(since, ws)
				args := s.args(query, 1, since, "2026-11-12T10:00:00Z", position{}, 10, ws, []string{"zh"})
				plan := explain(t, w.db, query, args)
				if !strings.Contains(plan, "USING INDEX") && !strings.Contains(plan, "USING COVERING INDEX") &&
					!strings.Contains(plan, "USING INTEGER PRIMARY KEY") {
					t.Errorf("%s (%s, ws %d, since %q): plan %q uses no index", s.coll, s.table, ws, since, plan)
				}
				if strings.Contains(plan, "TEMP B-TREE") {
					t.Errorf("%s (%s, ws %d, since %q): plan %q sorts", s.coll, s.table, ws, since, plan)
				}
				if strings.Contains(plan, "SCAN "+s.table) {
					t.Errorf("%s (%s, ws %d, since %q): plan %q scans the table", s.coll, s.table, ws, since, plan)
				}
			}
		}
	}
}

func explain(t *testing.T, sqlDB *sql.DB, query string, args []any) string {
	t.Helper()
	rs, err := sqlDB.Query("EXPLAIN QUERY PLAN "+query, args...)
	if err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	defer rs.Close()
	var plan []string
	for rs.Next() {
		var id, parent, notUsed int
		var detail string
		if err := rs.Scan(&id, &parent, &notUsed, &detail); err != nil {
			t.Fatal(err)
		}
		plan = append(plan, detail)
	}
	return strings.Join(plan, " | ")
}
