package api_test

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"qinqin/internal/plugins"
)

type activityBody struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Sources []struct {
		Type     string `json:"type"`
		Plugin   string `json:"plugin"`
		Label    string `json:"label"`
		Unit     string `json:"unit"`
		Describe struct {
			One   string `json:"one"`
			Other string `json:"other"`
		} `json:"describe"`
	} `json:"sources"`
	Cells []struct {
		Day       string  `json:"day"`
		Workspace int64   `json:"workspace"`
		Type      string  `json:"type"`
		Points    int64   `json:"points"`
		Raw       float64 `json:"raw"`
	} `json:"cells"`
}

var statsULID int

// statsServer returns a server with the built-in plugins registered and
// one user with a zh workspace.
func statsServer(t *testing.T) (url, token string, ws int64) {
	t.Helper()
	ts, sqlDB := newServer(t)
	for _, raw := range plugins.Builtin() {
		if _, err := plugins.RegisterBuiltin(context.Background(), sqlDB, raw); err != nil {
			t.Fatal(err)
		}
	}
	token = registerUser(t, ts.URL, "owner", "")
	return ts.URL, token, statsWorkspace(t, ts.URL, token, "zh")
}

func statsWorkspace(t *testing.T, url, token, language string) int64 {
	t.Helper()
	resp := doJSON(t, http.MethodPost, url, "/api/workspaces", token, map[string]string{"language": language})
	var w struct {
		ID int64 `json:"id"`
	}
	decodeJSON(t, resp, &w)
	return w.ID
}

// postEvent stores one event through the batch route.
func postEvent(t *testing.T, url, token string, ws int64, ts, typ, payload string) {
	t.Helper()
	statsULID++
	id := fmt.Sprintf("01J%023d", statsULID)
	body := fmt.Sprintf(`{"events":[{"id":%q,"workspaceId":%d,"ts":%q,"type":%q,"payload":%s}]}`, id, ws, ts, typ, payload)
	if resp := doRaw(t, http.MethodPost, url, "/api/events/batch", token, body); resp.StatusCode != http.StatusOK {
		t.Fatalf("post event: status %d", resp.StatusCode)
	}
}

func getActivity(t *testing.T, url, token, query string) (*http.Response, activityBody) {
	t.Helper()
	resp := doJSON(t, http.MethodGet, url, "/api/stats/activity"+query, token, nil)
	var out activityBody
	if resp.StatusCode == http.StatusOK {
		decodeJSON(t, resp, &out)
	}
	return resp, out
}

func TestStatsActivityDefaults(t *testing.T) {
	url, token, _ := statsServer(t)
	// The handler reads the clock itself: accept the UTC day before or
	// after the request, so a run across midnight cannot flake.
	before := time.Now().UTC()
	resp, body := getActivity(t, url, token, "")
	after := time.Now().UTC()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	ok := false
	for _, day := range []time.Time{before, after} {
		if body.To == day.Format("2006-01-02") && body.From == day.AddDate(0, 0, -90).Format("2006-01-02") {
			ok = true
		}
	}
	if !ok {
		t.Errorf("window = %s..%s, want today (UTC) and the 90 days before", body.From, body.To)
	}
	if body.Cells == nil || len(body.Cells) != 0 {
		t.Errorf("cells = %#v, want empty non-nil", body.Cells)
	}
	if len(body.Sources) != 3 {
		t.Fatalf("sources = %d, want 3", len(body.Sources))
	}
	want := []struct{ typ, plugin, unit string }{
		{"review", "qinqin-flashcards", "count"},
		{"read", "qinqin-reader", "seconds"},
		{"journal", "qinqin-journal", "count"},
	}
	for i, w := range want {
		s := body.Sources[i]
		if s.Type != w.typ || s.Plugin != w.plugin || s.Unit != w.unit || s.Label == "" || !strings.Contains(s.Describe.Other, "{n}") {
			t.Errorf("source %d = %+v, want %v", i, s, w)
		}
	}
}

func TestStatsActivityRawCellsEmptyJSONArray(t *testing.T) {
	url, token, _ := statsServer(t)
	resp := doJSON(t, http.MethodGet, url, "/api/stats/activity", token, nil)
	if got := readAll(t, resp); !strings.Contains(got, `"cells":[]`) {
		t.Errorf("body = %s, want cells as []", got)
	}
}

func TestStatsActivityRangeAndCells(t *testing.T) {
	url, token, ws := statsServer(t)
	ws2 := statsWorkspace(t, url, token, "ja")
	postEvent(t, url, token, ws, "2026-11-13T10:00:00Z", "review", `{}`)
	postEvent(t, url, token, ws, "2026-11-13T11:00:00Z", "review", `{}`)
	postEvent(t, url, token, ws2, "2026-11-13T11:00:00Z", "read", `{"seconds":900}`)
	postEvent(t, url, token, ws, "2026-11-01T11:00:00Z", "review", `{}`)

	resp, body := getActivity(t, url, token, "?from=2026-11-10&to=2026-11-14")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if body.From != "2026-11-10" || body.To != "2026-11-14" {
		t.Errorf("window = %s..%s", body.From, body.To)
	}
	if len(body.Cells) != 2 {
		t.Fatalf("cells = %+v, want 2", body.Cells)
	}
	if c := body.Cells[0]; c.Day != "2026-11-13" || c.Workspace != ws || c.Type != "review" || c.Points != 2 {
		t.Errorf("cell 0 = %+v", c)
	}
	if c := body.Cells[1]; c.Workspace != ws2 || c.Type != "read" || c.Points != 3 || c.Raw != 900 {
		t.Errorf("cell 1 = %+v", c)
	}

	_, only := getActivity(t, url, token, fmt.Sprintf("?from=2026-11-10&to=2026-11-14&workspace=%d", ws2))
	if len(only.Cells) != 1 || only.Cells[0].Type != "read" {
		t.Errorf("workspace filter cells = %+v", only.Cells)
	}
}

func TestStatsActivityBadRequests(t *testing.T) {
	url, token, _ := statsServer(t)
	for name, q := range map[string]string{
		"bad month":     "?from=2026-13-01&to=2026-11-14",
		"bad to":        "?to=nope",
		"from after to": "?from=2026-11-14&to=2026-11-13",
		"367 days":      "?from=2025-11-13&to=2026-11-14",
		"bad workspace": "?workspace=x",
	} {
		if resp, _ := getActivity(t, url, token, q); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", name, resp.StatusCode)
		}
	}
	// 366 days inclusive is 365 days apart + 1; the cap is 366 days.
	if resp, _ := getActivity(t, url, token, "?from=2025-11-14&to=2026-11-14"); resp.StatusCode != http.StatusOK {
		t.Errorf("366-day span: status = %d, want 200", resp.StatusCode)
	}
}

func TestStatsActivityAuthAndOwnership(t *testing.T) {
	ts, sqlDB := newServer(t)
	for _, raw := range plugins.Builtin() {
		if _, err := plugins.RegisterBuiltin(context.Background(), sqlDB, raw); err != nil {
			t.Fatal(err)
		}
	}
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	aws := statsWorkspace(t, ts.URL, alice, "zh")
	bws := statsWorkspace(t, ts.URL, bob, "zh")
	postEvent(t, ts.URL, alice, aws, "2026-11-13T10:00:00Z", "review", `{}`)
	postEvent(t, ts.URL, bob, bws, "2026-11-13T10:00:00Z", "review", `{}`)
	postEvent(t, ts.URL, bob, bws, "2026-11-13T10:00:00Z", "review", `{}`)

	if resp, _ := getActivity(t, ts.URL, "", ""); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no token: status = %d, want 401", resp.StatusCode)
	}
	if resp, _ := getActivity(t, ts.URL, alice, fmt.Sprintf("?workspace=%d", bws)); resp.StatusCode != http.StatusNotFound {
		t.Errorf("foreign workspace: status = %d, want 404", resp.StatusCode)
	}
	_, body := getActivity(t, ts.URL, alice, "?from=2026-11-13&to=2026-11-13")
	if len(body.Cells) != 1 || body.Cells[0].Points != 1 {
		t.Errorf("alice cells = %+v, want her one review only", body.Cells)
	}
}
