package events_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"qinqin/internal/events"
	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// pagingWorld is alice with two workspaces and bob with one, over a real
// API server (users and workspaces are made the way the app makes them).
type pagingWorld struct {
	db            *sql.DB
	alice, bob    int64
	zh, es, bobWS int64
}

func newPagingWorld(t *testing.T) pagingWorld {
	t.Helper()
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	aliceID, alice := registerFirstUser(t, ts.URL, "alice")
	bobID, bob := registerUser(t, ts.URL, "bob", alice)
	return pagingWorld{db: sqlDB, alice: aliceID, bob: bobID,
		zh: createWorkspace(t, ts.URL, alice, "zh"), es: createWorkspace(t, ts.URL, alice, "es"),
		bobWS: createWorkspace(t, ts.URL, bob, "zh")}
}

// seed appends n events of user in workspace, three per second (so
// same-second ties exist), starting at base, with ids that do not sort
// like their insertion order.
func (w pagingWorld) seed(t *testing.T, user, workspace int64, n int, base time.Time, payload func(i int) string) {
	t.Helper()
	evs := make([]model.StudyEvent, 0, n)
	for i := 0; i < n; i++ {
		p := `{"i":` + fmt.Sprint(i) + `}`
		if payload != nil {
			p = payload(i)
		}
		evs = append(evs, model.StudyEvent{ID: newEventID(t), UserID: user, WorkspaceID: workspace, Device: "web",
			TS: base.Add(time.Duration(i/3) * time.Second), Type: []string{"review", "lookup", "read"}[i%3],
			Payload: json.RawMessage(p)})
	}
	if _, _, err := events.Append(context.Background(), w.db, evs); err != nil {
		t.Fatal(err)
	}
}

// walk follows a paged walk to its end and returns the pages.
func walk(t *testing.T, sqlDB *sql.DB, user int64, first events.PageRequest) []events.Page {
	t.Helper()
	var pages []events.Page
	req := first
	for n := 0; ; n++ {
		if n > 10000 {
			t.Fatal("walk does not end")
		}
		page, err := events.ListPage(context.Background(), sqlDB, user, req)
		if err != nil {
			t.Fatalf("page %d: %v", n, err)
		}
		pages = append(pages, page)
		if !page.More {
			if page.Next != nil {
				t.Fatalf("last page has next %q", *page.Next)
			}
			return pages
		}
		if page.Next == nil || !strings.HasPrefix(*page.Next, "e1.") {
			t.Fatalf("page %d: more without an e1. next", n)
		}
		req = events.PageRequest{Paged: true, Page: *page.Next, Workspace: first.Workspace}
	}
}

// concat is the items of every page, as the legacy array would hold them.
func concat(t *testing.T, pages []events.Page) string {
	t.Helper()
	parts := []string{}
	for _, p := range pages {
		for _, raw := range p.Events {
			parts = append(parts, string(raw))
		}
	}
	return "[" + strings.Join(parts, ",") + "]"
}

func legacy(t *testing.T, sqlDB *sql.DB, user int64, since time.Time, ws *int64) string {
	t.Helper()
	list, err := events.Since(context.Background(), sqlDB, user, since, ws)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(list)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

// TestListPageWalkEqualsLegacy: whatever the limit, a walk's pages
// concatenate to the legacy answer, for one workspace or all, with or
// without since; only the last page has more false; no page exceeds its
// limit; another user's rows never appear.
func TestListPageWalkEqualsLegacy(t *testing.T) {
	w := newPagingWorld(t)
	base := time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)
	w.seed(t, w.alice, w.zh, 40, base, nil)
	w.seed(t, w.alice, w.es, 11, base.Add(5*time.Second), nil)
	w.seed(t, w.bob, w.bobWS, 9, base, nil)
	since := base.Add(4 * time.Second)
	for _, limit := range []int{1, 2, 3, 7, 2000} {
		for _, ws := range []int64{0, w.zh, w.es} {
			for _, s := range []time.Time{{}, since} {
				var wsp *int64
				if ws != 0 {
					wsp = &ws
				}
				pages := walk(t, w.db, w.alice, events.PageRequest{Paged: true, Limit: limit, Since: s, Workspace: ws})
				if got, want := concat(t, pages), legacy(t, w.db, w.alice, s, wsp); got != want {
					t.Errorf("limit %d ws %d since %v: walk = %s\nwant %s", limit, ws, s, got, want)
				}
				for i, p := range pages {
					if len(p.Events) > limit {
						t.Errorf("limit %d: page %d holds %d", limit, i, len(p.Events))
					}
					if len(p.Events) == 0 && len(pages) > 1 {
						t.Errorf("limit %d ws %d: empty page %d in a walk of %d", limit, ws, i, len(pages))
					}
				}
			}
		}
	}
	if strings.Contains(concat(t, walk(t, w.db, w.alice, events.PageRequest{Paged: true, Limit: 5})), fmt.Sprintf(`"userId":%d`, w.bob)) {
		t.Error("alice's walk shows bob's events")
	}
}

// TestListPageLookAhead: a log of exactly limit rows is one page with more
// false; an empty log is one empty page.
func TestListPageLookAhead(t *testing.T) {
	w := newPagingWorld(t)
	w.seed(t, w.alice, w.zh, 6, time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC), nil)
	if pages := walk(t, w.db, w.alice, events.PageRequest{Paged: true, Limit: 6, Workspace: w.zh}); len(pages) != 1 || len(pages[0].Events) != 6 {
		t.Errorf("6 rows at limit 6: %d pages", len(pages))
	}
	if pages := walk(t, w.db, w.alice, events.PageRequest{Paged: true, Limit: 3, Workspace: w.zh}); len(pages) != 2 {
		t.Errorf("6 rows at limit 3: %d pages, want 2 (no trailing empty page)", len(pages))
	}
	pages := walk(t, w.db, w.alice, events.PageRequest{Paged: true, Limit: 3, Workspace: w.es})
	if len(pages) != 1 || pages[0].Events == nil || len(pages[0].Events) != 0 {
		t.Errorf("empty log: %+v, want one page with events []", pages)
	}
	if raw, _ := json.Marshal(pages[0]); string(raw) != `{"events":[],"more":false,"next":null}` {
		t.Errorf("empty page encodes as %s", raw)
	}
}

// TestListPageByteBudget: a page stops before the row that would take it
// past MaxPageBytes; a row above the budget ships alone.
func TestListPageByteBudget(t *testing.T) {
	w := newPagingWorld(t)
	big := `"` + strings.Repeat("x", events.MaxPageBytes/3) + `"`
	huge := `"` + strings.Repeat("y", events.MaxPageBytes+10) + `"`
	w.seed(t, w.alice, w.zh, 7, time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC), func(i int) string {
		if i == 5 {
			return huge
		}
		return big
	})
	pages := walk(t, w.db, w.alice, events.PageRequest{Paged: true, Limit: 2000, Workspace: w.zh})
	var sizes []int
	for _, p := range pages {
		size := 0
		for _, raw := range p.Events {
			size += len(raw)
		}
		if len(p.Events) > 1 && size > events.MaxPageBytes {
			t.Errorf("page of %d rows holds %d bytes", len(p.Events), size)
		}
		sizes = append(sizes, len(p.Events))
	}
	// Rows 0-2 fit (3 × a third, minus the envelope: two fit, the third tips it), row 5 alone.
	ws := w.zh
	if got, want := concat(t, pages), legacy(t, w.db, w.alice, time.Time{}, &ws); got != want {
		t.Error("budgeted walk differs from the legacy answer")
	}
	if fmt.Sprint(sizes) != "[2 2 1 1 1]" {
		t.Errorf("page sizes = %v, want [2 2 1 1 1]", sizes)
	}
}

// TestListPageContinuationRules: the continuation's workspace must be the
// token's, and the token must be the caller's.
func TestListPageContinuationRules(t *testing.T) {
	w := newPagingWorld(t)
	w.seed(t, w.alice, w.zh, 4, time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC), nil)
	first, err := events.ListPage(context.Background(), w.db, w.alice, events.PageRequest{Paged: true, Limit: 1, Workspace: w.zh})
	if err != nil || first.Next == nil {
		t.Fatalf("first page: %v", err)
	}
	for name, req := range map[string]events.PageRequest{
		"no workspace":    {Paged: true, Page: *first.Next},
		"other workspace": {Paged: true, Page: *first.Next, Workspace: w.es},
	} {
		if _, err := events.ListPage(context.Background(), w.db, w.alice, req); !errors.Is(err, events.ErrPageInvalid) {
			t.Errorf("%s: err = %v, want ErrPageInvalid", name, err)
		}
	}
	if _, err := events.ListPage(context.Background(), w.db, w.bob, events.PageRequest{Paged: true, Page: *first.Next, Workspace: w.zh}); !errors.Is(err, events.ErrPageInvalid) {
		t.Errorf("bob replays alice's token: err = %v, want ErrPageInvalid", err)
	}
	all, err := events.ListPage(context.Background(), w.db, w.alice, events.PageRequest{Paged: true, Limit: 1})
	if err != nil || all.Next == nil {
		t.Fatalf("combined first page: %v", err)
	}
	if _, err := events.ListPage(context.Background(), w.db, w.alice, events.PageRequest{Paged: true, Page: *all.Next, Workspace: w.zh}); !errors.Is(err, events.ErrPageInvalid) {
		t.Errorf("combined token with a workspace: err = %v, want ErrPageInvalid", err)
	}
}
