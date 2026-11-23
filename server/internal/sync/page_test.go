package sync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"qinqin/internal/dbtest"
)

// The core tests page over two fake tables, alpha_rows and beta_rows, so the
// window, keyset, budget and token rules are checked apart from the real
// collections (page_collections_test.go).

func coreDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB := dbtest.Open(t)
	for _, tb := range []string{"alpha_rows", "beta_rows"} {
		if _, err := sqlDB.Exec(`CREATE TABLE ` + tb + ` (user_id INTEGER NOT NULL, v TEXT NOT NULL,
			updated_at TEXT NOT NULL, deleted_at TEXT);
			CREATE INDEX idx_` + tb + `_user_updated ON ` + tb + ` (user_id, updated_at)`); err != nil {
			t.Fatal(err)
		}
	}
	return sqlDB
}

type fakeRow struct {
	V         string  `json:"v"`
	UpdatedAt string  `json:"updatedAt"`
	DeletedAt *string `json:"deletedAt"`
}

func fakeSegment(coll, table string) segment {
	return segment{coll: coll, table: table, stamp: "updated_at", cols: "v, updated_at, deleted_at", tomb: true,
		encode: func(sc scanner) (string, int64, []byte, error) {
			var r fakeRow
			var rowid int64
			if err := sc.Scan(&rowid, &r.V, &r.UpdatedAt, &r.DeletedAt); err != nil {
				return "", 0, nil, err
			}
			raw, err := json.Marshal(r)
			return r.UpdatedAt, rowid, raw, err
		}}
}

func fakeSet() roundSet {
	return roundSet{
		order: []string{"alpha", "beta"},
		segs:  []segment{fakeSegment("alpha", "alpha_rows"), fakeSegment("beta", "beta_rows")},
		scope: func(ctx context.Context, q *sql.DB, userID, workspace int64) ([]string, Scope, error) {
			if workspace != 0 && workspace != 7 {
				return nil, Scope{}, ErrNotFound
			}
			return []string{"zh"}, Scope{Workspaces: []WorkspaceRef{{ID: 7, Language: "zh"}}, Languages: []string{"zh"}}, nil
		},
	}
}

func put(t *testing.T, sqlDB *sql.DB, table string, user int64, v, stamp string, deleted bool) {
	t.Helper()
	var del any
	if deleted {
		del = stamp
	}
	if _, err := sqlDB.Exec(`INSERT INTO `+table+` (user_id, v, updated_at, deleted_at) VALUES (?, ?, ?, ?)`, user, v, stamp, del); err != nil {
		t.Fatal(err)
	}
}

func restamp(t *testing.T, sqlDB *sql.DB, table, v, stamp string) {
	t.Helper()
	if _, err := sqlDB.Exec(`UPDATE `+table+` SET updated_at = ? WHERE v = ?`, stamp, v); err != nil {
		t.Fatal(err)
	}
}

func at(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func corePull(t *testing.T, sqlDB *sql.DB, user int64, req PageRequest) Page {
	t.Helper()
	p, err := pullPage(context.Background(), sqlDB, user, req, fakeSet(), nil)
	if err != nil {
		t.Fatalf("pullPage(%+v): %v", req, err)
	}
	return p
}

// vs returns the v of every row of coll on the page, and which were tombstones.
func vs(t *testing.T, p Page, coll string) (live, dead []string) {
	t.Helper()
	raw, ok := p.Collections[coll]
	if !ok {
		t.Fatalf("page has no %s key", coll)
	}
	var rows []fakeRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatalf("%s: %v", coll, err)
	}
	if rows == nil {
		t.Fatalf("%s is null", coll)
	}
	live, dead = []string{}, []string{}
	for _, r := range rows {
		live = append(live, r.V)
		if r.DeletedAt != nil {
			dead = append(dead, r.V)
		}
	}
	return live, dead
}

func want(t *testing.T, what string, got, wantList []string) {
	t.Helper()
	if !slices.Equal(got, wantList) {
		t.Errorf("%s = %v, want %v", what, got, wantList)
	}
}

func next(t *testing.T, p Page) string {
	t.Helper()
	if !p.More || p.Next == nil || p.Cursor != nil {
		t.Fatalf("page more=%v next=%v cursor=%v, want a continuation", p.More, p.Next, p.Cursor)
	}
	return *p.Next
}

func last(t *testing.T, p Page) string {
	t.Helper()
	if p.More || p.Next != nil || p.Cursor == nil {
		t.Fatalf("page more=%v next=%v cursor=%v, want the last page", p.More, p.Next, p.Cursor)
	}
	return *p.Cursor
}

func TestParsePageRequest(t *testing.T) {
	ok := []struct {
		query string
		want  PageRequest
	}{
		{"v=2", PageRequest{}},
		{"v=2&limit=1&collections=pluginData,cards&workspace=7&since=c2.x", PageRequest{Limit: 1, Only: map[string]bool{"pluginData": true, "cards": true}, Workspace: 7, Since: "c2.x"}},
		{"v=2&limit=2000", PageRequest{Limit: 2000}},
		{"v=2&page=p2.x", PageRequest{Page: "p2.x"}},
		{"v=2&collections=", PageRequest{}},
		{"v=2&tombstones=1", PageRequest{Tombstones: true}},
		{"v=2&tombstones=1&since=c2.x", PageRequest{Tombstones: true, Since: "c2.x"}},
	}
	for _, tc := range ok {
		q, _ := url.ParseQuery(tc.query)
		got, err := ParsePageRequest(q)
		if err != nil {
			t.Errorf("%s: %v", tc.query, err)
			continue
		}
		if got.Since != tc.want.Since || got.Page != tc.want.Page || got.Limit != tc.want.Limit || got.Workspace != tc.want.Workspace || got.Tombstones != tc.want.Tombstones || len(got.Only) != len(tc.want.Only) {
			t.Errorf("%s = %+v, want %+v", tc.query, got, tc.want)
		}
		for k := range tc.want.Only {
			if !got.Only[k] {
				t.Errorf("%s: Only lacks %s", tc.query, k)
			}
		}
	}
	bad := map[string]error{
		"v=2&limit=0":                        ErrPageInvalid,
		"v=2&limit=2001":                     ErrPageInvalid,
		"v=2&limit=abc":                      ErrPageInvalid,
		"v=2&limit=":                         ErrPageInvalid,
		"v=2&collections=pluginData,nope":    ErrPageInvalid,
		"v=2&collections=pluginData,entries": ErrMoved,
		"v=2&collections=levels":             ErrMoved,
		"v=2&page=p2.x&since=c2.y":           ErrPageInvalid,
		"v=2&page=p2.x&collections=cards":    ErrPageInvalid,
		"v=2&page=p2.x&workspace=7":          ErrPageInvalid,
		"v=2&page=p2.x&limit=10":             ErrPageInvalid,
		"v=2&workspace=abc":                  ErrPageInvalid,
		"v=2&workspace=0":                    ErrPageInvalid,
		"v=2&workspace=-3":                   ErrPageInvalid,
		"v=2&tombstones=0":                   ErrPageInvalid,
		"v=2&tombstones=":                    ErrPageInvalid,
		"v=2&tombstones=true":                ErrPageInvalid,
		"v=2&page=p2.x&tombstones=1":         ErrPageInvalid,
	}
	for query, wantErr := range bad {
		q, _ := url.ParseQuery(query)
		if _, err := ParsePageRequest(q); !errors.Is(err, wantErr) {
			t.Errorf("%s: err = %v, want %v", query, err, wantErr)
		}
	}
}

func TestPullPageRefusesBadRequests(t *testing.T) {
	sqlDB := coreDB(t)
	ctx := context.Background()
	for name, tc := range map[string]struct {
		req  PageRequest
		want error
	}{
		"limit 2001":            {PageRequest{Limit: 2001}, ErrPageInvalid},
		"negative limit":        {PageRequest{Limit: -1}, ErrPageInvalid},
		"unknown collection":    {PageRequest{Only: map[string]bool{"gamma": true}}, ErrPageInvalid},
		"moved collection":      {PageRequest{Only: map[string]bool{"alpha": true, "entries": true}}, ErrMoved},
		"page with since":       {PageRequest{Page: "p2.x", Since: "c2.y"}, ErrPageInvalid},
		"page with limit":       {PageRequest{Page: "p2.x", Limit: 3}, ErrPageInvalid},
		"page with collections": {PageRequest{Page: "p2.x", Only: map[string]bool{"alpha": true}}, ErrPageInvalid},
		"page with workspace":   {PageRequest{Page: "p2.x", Workspace: 7}, ErrPageInvalid},
		"page with tombstones":  {PageRequest{Page: "p2.x", Tombstones: true}, ErrPageInvalid},
		"garbled page":          {PageRequest{Page: "p2.not-base64!"}, ErrPageInvalid},
		"an RFC 3339 since":     {PageRequest{Since: "2026-11-12T09:00:00Z"}, ErrPageInvalid},
		"a foreign workspace":   {PageRequest{Workspace: 9}, ErrNotFound},
	} {
		if _, err := pullPage(ctx, sqlDB, 1, tc.req, fakeSet(), nil); !errors.Is(err, tc.want) {
			t.Errorf("%s: err = %v, want %v", name, err, tc.want)
		}
	}
}

func TestPagesStopAtTheLimitAndLookAhead(t *testing.T) {
	sqlDB := coreDB(t)
	for i, v := range []string{"a1", "a2", "a3", "a4"} {
		put(t, sqlDB, "alpha_rows", 1, v, "2026-11-12T09:0"+string(rune('0'+i))+":00Z", false)
	}
	now := at("2026-11-12T10:00:00Z")
	p := corePull(t, sqlDB, 1, PageRequest{Limit: 2, Only: map[string]bool{"alpha": true}, Now: now})
	got, _ := vs(t, p, "alpha")
	want(t, "page 1", got, []string{"a1", "a2"})
	if _, ok := p.Collections["beta"]; ok {
		t.Error("an unrequested collection is on the page")
	}
	p = corePull(t, sqlDB, 1, PageRequest{Page: next(t, p), Now: now})
	got, _ = vs(t, p, "alpha")
	want(t, "page 2", got, []string{"a3", "a4"})
	// The round's rows end exactly at the limit: the look-ahead makes this
	// the last page instead of an empty one after it.
	last(t, p)

	// With beta requested too, a full page whose collection is done still
	// has more when the next collection has rows.
	put(t, sqlDB, "beta_rows", 1, "b1", "2026-11-12T08:00:00Z", false)
	p = corePull(t, sqlDB, 1, PageRequest{Limit: 4, Now: now})
	got, _ = vs(t, p, "alpha")
	want(t, "alpha", got, []string{"a1", "a2", "a3", "a4"})
	p = corePull(t, sqlDB, 1, PageRequest{Page: next(t, p), Now: now})
	got, _ = vs(t, p, "beta")
	want(t, "beta", got, []string{"b1"})
	last(t, p)
}

func TestPagesCrossCollectionsInRoundOrder(t *testing.T) {
	sqlDB := coreDB(t)
	put(t, sqlDB, "beta_rows", 1, "b1", "2026-11-12T08:00:00Z", false)
	put(t, sqlDB, "beta_rows", 1, "b2", "2026-11-12T08:00:00Z", false)
	put(t, sqlDB, "alpha_rows", 1, "a1", "2026-11-12T09:30:00Z", false)
	put(t, sqlDB, "alpha_rows", 1, "a2", "2026-11-12T09:00:00Z", false)
	now := at("2026-11-12T10:00:00Z")
	p := corePull(t, sqlDB, 1, PageRequest{Limit: 3, Now: now})
	a, _ := vs(t, p, "alpha")
	b, _ := vs(t, p, "beta")
	want(t, "page 1 alpha", a, []string{"a2", "a1"})
	want(t, "page 1 beta", b, []string{"b1"})
	p = corePull(t, sqlDB, 1, PageRequest{Page: next(t, p), Now: now.Add(time.Second)})
	a, _ = vs(t, p, "alpha")
	b, _ = vs(t, p, "beta")
	want(t, "page 2 alpha", a, []string{})
	want(t, "page 2 beta", b, []string{"b2"})
	last(t, p)
}

func TestPagesKeepToTheByteBudget(t *testing.T) {
	sqlDB := coreDB(t)
	big := strings.Repeat("x", 300*1024)
	var names []string
	for i := 1; i <= 15; i++ {
		v := big + string(rune('A'+i))
		put(t, sqlDB, "alpha_rows", 1, v, time.Date(2026, 11, 12, 9, i, 0, 0, time.UTC).Format(time.RFC3339), false)
		names = append(names, v)
	}
	huge := strings.Repeat("y", 5*1024*1024)
	put(t, sqlDB, "alpha_rows", 1, huge, "2026-11-12T09:30:00Z", false)
	put(t, sqlDB, "alpha_rows", 1, "tail", "2026-11-12T09:31:00Z", false)
	now := at("2026-11-12T10:00:00Z")
	var pages [][]string
	req := PageRequest{Only: map[string]bool{"alpha": true}, Now: now}
	for {
		p := corePull(t, sqlDB, 1, req)
		got, _ := vs(t, p, "alpha")
		if len(got) == 0 {
			t.Fatal("an empty page while rows remain")
		}
		size := 0
		for _, v := range got {
			size += len(v)
		}
		if len(got) > 1 && size > MaxPageBytes {
			t.Errorf("page of %d rows holds %d bytes of data, over the budget", len(got), size)
		}
		pages = append(pages, got)
		if !p.More {
			break
		}
		req = PageRequest{Page: *p.Next, Now: now}
	}
	if len(pages) != 4 {
		t.Fatalf("%d pages, want 4 (13 rows, 2 rows, the huge row alone, tail)", len(pages))
	}
	want(t, "page 1", pages[0], names[:13])
	want(t, "page 2", pages[1], names[13:])
	want(t, "page 3", pages[2], []string{huge})
	want(t, "page 4", pages[3], []string{"tail"})
}

func TestARowRewrittenMidRoundComesNextRound(t *testing.T) {
	sqlDB := coreDB(t)
	put(t, sqlDB, "alpha_rows", 1, "d1", "2026-11-12T09:00:00Z", false)
	put(t, sqlDB, "alpha_rows", 1, "d2", "2026-11-12T09:01:00Z", false)
	only := map[string]bool{"alpha": true}
	p := corePull(t, sqlDB, 1, PageRequest{Limit: 1, Only: only, Now: at("2026-11-12T10:00:00Z")})
	got, _ := vs(t, p, "alpha")
	want(t, "page 1", got, []string{"d1"})
	restamp(t, sqlDB, "alpha_rows", "d1", "2026-11-12T10:00:05Z")
	p = corePull(t, sqlDB, 1, PageRequest{Page: next(t, p), Now: at("2026-11-12T10:00:06Z")})
	got, _ = vs(t, p, "alpha")
	want(t, "page 2", got, []string{"d2"})
	cur := last(t, p)
	p = corePull(t, sqlDB, 1, PageRequest{Since: cur, Limit: 1, Only: only, Now: at("2026-11-12T10:05:00Z")})
	got, _ = vs(t, p, "alpha")
	want(t, "next round", got, []string{"d1"})
	last(t, p)
}

func TestALateRowInsideTheLagComesNextRound(t *testing.T) {
	sqlDB := coreDB(t)
	put(t, sqlDB, "alpha_rows", 1, "d1", "2026-11-12T09:00:00Z", false)
	only := map[string]bool{"alpha": true}
	p := corePull(t, sqlDB, 1, PageRequest{Only: only, Now: at("2026-11-12T10:00:00Z")})
	cur := last(t, p)
	// Stamped until - 10 s by a writer that committed after the round read
	// its region.
	put(t, sqlDB, "alpha_rows", 1, "late", "2026-11-12T09:59:50Z", false)
	p = corePull(t, sqlDB, 1, PageRequest{Since: cur, Only: only, Now: at("2026-11-12T10:01:00Z")})
	got, _ := vs(t, p, "alpha")
	want(t, "next round", got, []string{"late"})
}

func TestTombstonesOnlyWithSince(t *testing.T) {
	sqlDB := coreDB(t)
	put(t, sqlDB, "alpha_rows", 1, "live", "2026-11-12T09:00:00Z", false)
	put(t, sqlDB, "alpha_rows", 1, "dead", "2026-11-12T09:01:00Z", true)
	put(t, sqlDB, "alpha_rows", 2, "other", "2026-11-12T09:02:00Z", false)
	only := map[string]bool{"alpha": true}
	p := corePull(t, sqlDB, 1, PageRequest{Only: only, Now: at("2026-11-12T09:30:00Z")})
	got, dead := vs(t, p, "alpha")
	want(t, "from no since", got, []string{"live"})
	want(t, "tombstones from no since", dead, []string{})
	cur := last(t, p)
	restamp(t, sqlDB, "alpha_rows", "dead", "2026-11-12T09:40:00Z")
	p = corePull(t, sqlDB, 1, PageRequest{Since: cur, Only: only, Now: at("2026-11-12T10:00:00Z")})
	got, dead = vs(t, p, "alpha")
	want(t, "delta", got, []string{"dead"})
	want(t, "delta tombstones", dead, []string{"dead"})
}

// tombstones=1 ships tombstones in a round from no since too (a client that
// stamps its writes after the server's must see them), on every page of the
// round, and binds the cursor: the next round must ask for it again.
func TestTombstonesFlagShipsTombstonesFromNoSince(t *testing.T) {
	sqlDB := coreDB(t)
	put(t, sqlDB, "alpha_rows", 1, "live", "2026-11-12T09:00:00Z", false)
	put(t, sqlDB, "alpha_rows", 1, "dead", "2026-11-12T09:01:00Z", true)
	put(t, sqlDB, "beta_rows", 1, "gone", "2026-11-12T09:02:00Z", true)
	put(t, sqlDB, "alpha_rows", 2, "other", "2026-11-12T09:02:00Z", true)
	now := at("2026-11-12T09:30:00Z")
	p := corePull(t, sqlDB, 1, PageRequest{Limit: 1, Tombstones: true, Now: now})
	got, dead := vs(t, p, "alpha")
	want(t, "first page", got, []string{"live"})
	want(t, "first page tombstones", dead, []string{})
	p = corePull(t, sqlDB, 1, PageRequest{Page: next(t, p)})
	got, dead = vs(t, p, "alpha")
	want(t, "second page", got, []string{"dead"})
	want(t, "second page tombstones", dead, []string{"dead"})
	p = corePull(t, sqlDB, 1, PageRequest{Page: next(t, p)})
	got, dead = vs(t, p, "beta")
	want(t, "third page", got, []string{"gone"})
	want(t, "third page tombstones", dead, []string{"gone"})
	cur := last(t, p)

	plain := corePull(t, sqlDB, 1, PageRequest{Now: now})
	got, _ = vs(t, plain, "alpha")
	want(t, "without the flag", got, []string{"live"})
	got, _ = vs(t, plain, "beta")
	want(t, "without the flag (beta)", got, []string{})

	if _, err := pullPage(context.Background(), sqlDB, 1, PageRequest{Since: cur, Now: now}, fakeSet(), nil); !errors.Is(err, ErrPageInvalid) {
		t.Errorf("a tombstones cursor without the flag: err = %v, want ErrPageInvalid", err)
	}
	if _, err := pullPage(context.Background(), sqlDB, 1, PageRequest{Since: last(t, plain), Tombstones: true, Now: now}, fakeSet(), nil); !errors.Is(err, ErrPageInvalid) {
		t.Errorf("a plain cursor with the flag: err = %v, want ErrPageInvalid", err)
	}
	p = corePull(t, sqlDB, 1, PageRequest{Since: cur, Tombstones: true, Now: at("2026-11-12T10:00:00Z")})
	last(t, p)
}

func TestTheCursorLagsUntilByThirtySeconds(t *testing.T) {
	sqlDB := coreDB(t)
	p := corePull(t, sqlDB, 1, PageRequest{Now: at("2026-11-12T10:00:00.700Z")})
	if !p.Until.Equal(at("2026-11-12T10:00:00Z")) {
		t.Errorf("until = %v, want the second of the clock", p.Until)
	}
	cur, err := decodeCursor(last(t, p), 1, filters{Collections: []string{"alpha", "beta"}})
	if err != nil {
		t.Fatal(err)
	}
	if cur.Time != "2026-11-12T09:59:30Z" {
		t.Errorf("cursor time = %s, want until - 30 s", cur.Time)
	}
	if p.Format != 2 || p.Restarted == nil || len(p.Collections) != 2 {
		t.Errorf("page = %+v", p)
	}
	for name, raw := range p.Collections {
		if string(raw) != "[]" {
			t.Errorf("%s = %s, want []", name, raw)
		}
	}
	if p.Scope == nil {
		t.Error("first page without scope")
	}
}

func TestTokensBindUserAndFilters(t *testing.T) {
	sqlDB := coreDB(t)
	put(t, sqlDB, "alpha_rows", 1, "a1", "2026-11-12T09:00:00Z", false)
	put(t, sqlDB, "alpha_rows", 1, "a2", "2026-11-12T09:01:00Z", false)
	put(t, sqlDB, "alpha_rows", 2, "b1", "2026-11-12T09:01:00Z", false)
	ctx := context.Background()
	only := map[string]bool{"alpha": true}
	now := at("2026-11-12T10:00:00Z")
	p := corePull(t, sqlDB, 1, PageRequest{Limit: 1, Only: only, Now: now})
	tok := next(t, p)
	if _, err := pullPage(ctx, sqlDB, 2, PageRequest{Page: tok, Now: now}, fakeSet(), nil); !errors.Is(err, ErrPageInvalid) {
		t.Errorf("user 2 with user 1's page token: err = %v", err)
	}
	p = corePull(t, sqlDB, 1, PageRequest{Page: tok, Now: now})
	cur := last(t, p)
	for name, req := range map[string]PageRequest{
		"other user":        {Since: cur, Only: only},
		"other collections": {Since: cur},
		"workspace added":   {Since: cur, Only: only, Workspace: 7},
	} {
		user := int64(1)
		if name == "other user" {
			user = 2
		}
		if _, err := pullPage(ctx, sqlDB, user, req, fakeSet(), nil); !errors.Is(err, ErrPageInvalid) {
			t.Errorf("%s: err = %v, want ErrPageInvalid", name, err)
		}
	}
	// A different limit is not a different filter set.
	p = corePull(t, sqlDB, 1, PageRequest{Since: cur, Only: only, Limit: 7, Now: now.Add(time.Minute)})
	last(t, p)
}
