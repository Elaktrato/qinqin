package api_test

import (
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/dbtest"
	"qinqin/internal/drills"
)

type activityBody struct {
	From     string `json:"from"`
	To       string `json:"to"`
	TimeZone string `json:"timeZone"`
	Sources  []struct {
		Type    string `json:"type"`
		Feature string `json:"feature"`
		Unit    string `json:"unit"`
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
	ts, _ := newServer(t)
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

// statsServerAt is statsServer with the server clock fixed.
func statsServerAt(t *testing.T, now time.Time) (url, token string, ws int64) {
	t.Helper()
	sqlDB := dbtest.Open(t)
	ts := newTestServer(sqlDB, api.New(sqlDB, t.TempDir(), nil, api.WithClock(func() time.Time { return now })))
	t.Cleanup(ts.Close)
	token = registerUser(t, ts.URL, "owner", "")
	return ts.URL, token, statsWorkspace(t, ts.URL, token, "zh")
}

func TestStatsActivityDefaults(t *testing.T) {
	// 2026-11-15T15:30:00Z is already the 16th in Tokyo.
	now := time.Date(2026, 11, 15, 15, 30, 0, 0, time.UTC)
	url, token, _ := statsServerAt(t, now)
	resp, body := getActivity(t, url, token, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if body.To != "2026-11-15" || body.From != "2026-08-17" || body.TimeZone != "UTC" {
		t.Errorf("no zone: %s..%s %s, want UTC 2026-08-17..2026-11-15", body.From, body.To, body.TimeZone)
	}
	if resp := doRaw(t, http.MethodPut, url, "/api/me/time-zone", token, `{"zone":"Asia/Tokyo"}`); resp.StatusCode != http.StatusOK {
		t.Fatalf("put zone: %d", resp.StatusCode)
	}
	_, body = getActivity(t, url, token, "")
	if body.To != "2026-11-16" || body.From != "2026-08-18" || body.TimeZone != "Asia/Tokyo" {
		t.Errorf("tokyo: %s..%s %s, want 2026-08-18..2026-11-16 in Asia/Tokyo", body.From, body.To, body.TimeZone)
	}
	if body.Cells == nil || len(body.Cells) != 0 {
		t.Errorf("cells = %#v, want empty non-nil", body.Cells)
	}
	want := []struct{ typ, feature, unit string }{
		{"review", "flashcards", "count"},
		{"read", "reader", "seconds"},
		{"journal", "journal", "count"},
		{"script", "scripts", "count"},
		{"grammar", "grammar", "count"},
	}
	// Then one count source per registered drill (docs/contracts/drills/).
	for _, id := range drills.IDs {
		want = append(want, struct{ typ, feature, unit string }{drills.EventType(id), drills.Feature, "count"})
	}
	if len(body.Sources) != len(want) {
		t.Fatalf("sources = %d, want %d", len(body.Sources), len(want))
	}
	for i, w := range want {
		s := body.Sources[i]
		if s.Type != w.typ || s.Feature != w.feature || s.Unit != w.unit {
			t.Errorf("source %d = %+v, want %v", i, s, w)
		}
	}
}

// Zone changes through the API move no past day.
func TestStatsActivityZoneChangeKeepsPast(t *testing.T) {
	now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	url, token, ws := statsServerAt(t, now)
	// Clearly past events, each hour for a week, put on the same days in any zone.
	for i := 0; i < 24*7; i++ {
		ts := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(i) * time.Hour)
		postEvent(t, url, token, ws, ts.Format(time.RFC3339), "review", `{}`)
	}
	put := func(zone string) {
		t.Helper()
		if resp := doRaw(t, http.MethodPut, url, "/api/me/time-zone", token, `{"zone":"`+zone+`"}`); resp.StatusCode != http.StatusOK {
			t.Fatalf("put %s: %d", zone, resp.StatusCode)
		}
	}
	put("Asia/Tokyo")
	_, before := getActivity(t, url, token, "?from=2026-11-01&to=2026-11-08")
	if len(before.Cells) == 0 {
		t.Fatal("no cells")
	}
	for _, zone := range []string{"America/Los_Angeles", "Pacific/Kiritimati", "Europe/Berlin"} {
		put(zone)
		_, after := getActivity(t, url, token, "?from=2026-11-01&to=2026-11-08")
		if !reflect.DeepEqual(before.Cells, after.Cells) || after.TimeZone != zone {
			t.Errorf("%s: cells moved or zone %q wrong", zone, after.TimeZone)
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
	ts, _ := newServer(t)
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
