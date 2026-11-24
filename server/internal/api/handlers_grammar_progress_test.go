package api_test

import (
	"net/http"
	"strconv"
	"testing"

	"qinqin/internal/api"
	"qinqin/internal/dbtest"
)

// Grammar lesson progress (#199): a user's own workspace only; the server
// keeps the best score.
func TestGrammarProgressRoutes(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ts := newTestServer(sqlDB, api.New(sqlDB, t.TempDir(), nil))
	t.Cleanup(ts.Close)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	ws := createWorkspace(t, ts.URL, alice, "zh", "")
	bobWS := createWorkspace(t, ts.URL, bob, "zh", "")
	q := func(ws int64) string { return "?workspace=" + strconv.FormatInt(ws, 10) }
	run := map[string]any{"packId": "zh-grammar", "lessonId": "le-change", "score": 3, "total": 4}

	for _, m := range []string{http.MethodGet, http.MethodPost} {
		if r := doJSON(t, m, ts.URL, "/api/grammar/progress"+q(ws), "", run); r.StatusCode != 401 {
			t.Errorf("%s without a token: %d", m, r.StatusCode)
		}
		if r := doJSON(t, m, ts.URL, "/api/grammar/progress"+q(ws), bob, run); r.StatusCode != 404 {
			t.Errorf("%s in another user's workspace: %d, want 404", m, r.StatusCode)
		}
		if r := doJSON(t, m, ts.URL, "/api/grammar/progress", alice, run); r.StatusCode != 400 {
			t.Errorf("%s without a workspace: %d, want 400", m, r.StatusCode)
		}
	}
	var p map[string]any
	r := doJSON(t, http.MethodPost, ts.URL, "/api/grammar/progress"+q(ws), alice, run)
	decodeJSON(t, r, &p)
	if r.StatusCode != 200 || p["best"] != 3.0 || p["total"] != 4.0 || p["lessonId"] != "le-change" || p["completedAt"] == "" {
		t.Fatalf("record: %d %v", r.StatusCode, p)
	}
	r = doJSON(t, http.MethodPost, ts.URL, "/api/grammar/progress"+q(ws), alice, map[string]any{"packId": "zh-grammar", "lessonId": "le-change", "score": 1, "total": 4})
	decodeJSON(t, r, &p)
	if p["best"] != 3.0 {
		t.Errorf("a lower run lowered the best: %v", p)
	}
	for name, body := range map[string]any{
		"score above total": map[string]any{"packId": "zh-grammar", "lessonId": "le", "score": 5, "total": 4},
		"no score":          map[string]any{"packId": "zh-grammar", "lessonId": "le", "total": 4},
		"bad lesson":        map[string]any{"packId": "zh-grammar", "lessonId": "Le!", "score": 1, "total": 4},
	} {
		if r := doJSON(t, http.MethodPost, ts.URL, "/api/grammar/progress"+q(ws), alice, body); r.StatusCode != 400 {
			t.Errorf("%s: %d, want 400", name, r.StatusCode)
		}
	}
	var list []map[string]any
	r = doJSON(t, http.MethodGet, ts.URL, "/api/grammar/progress"+q(ws), alice, nil)
	decodeJSON(t, r, &list)
	if r.StatusCode != 200 || len(list) != 1 || list[0]["best"] != 3.0 {
		t.Errorf("alice's list: %d %v", r.StatusCode, list)
	}
	r = doJSON(t, http.MethodGet, ts.URL, "/api/grammar/progress"+q(bobWS), bob, nil)
	decodeJSON(t, r, &list)
	if r.StatusCode != 200 || len(list) != 0 {
		t.Errorf("bob's list: %d %v, want []", r.StatusCode, list)
	}
}
