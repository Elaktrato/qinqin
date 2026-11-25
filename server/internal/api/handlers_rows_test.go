package api_test

import (
	"net/http"
	"strconv"
	"testing"
)

// The keyed row routes (#199): every one needs a user; rows are the
// caller's own, per workspace or user-global; only accepted key families,
// each in its scope.
func TestKeyedRowRoutes(t *testing.T) {
	ts, _ := newServer(t)
	admin := registerUser(t, ts.URL, "root", "")
	alice := registerUser(t, ts.URL, "alice", admin)
	bob := registerUser(t, ts.URL, "bob", admin)
	a1 := createWorkspace(t, ts.URL, alice, "zh", "One")
	a2 := createWorkspace(t, ts.URL, alice, "zh", "Two")
	b1 := createWorkspace(t, ts.URL, bob, "zh", "One")
	q := func(ws int64) string { return "?workspace=" + strconv.FormatInt(ws, 10) }
	const note = "/api/rows/note:1201"

	for _, rt := range []struct{ method, path string }{
		{http.MethodGet, "/api/rows" + q(a1)},
		{http.MethodGet, note + q(a1)},
		{http.MethodPut, note + q(a1)},
		{http.MethodDelete, note + q(a1)},
	} {
		if r := doRaw(t, rt.method, ts.URL, rt.path, "", `{}`); r.StatusCode != 401 {
			t.Errorf("%s %s without a token: %d", rt.method, rt.path, r.StatusCode)
		}
		// another user's workspace reads as missing
		if r := doRaw(t, rt.method, ts.URL, rt.path, bob, `{}`); r.StatusCode != 404 {
			t.Errorf("%s %s in alice's workspace as bob: %d, want 404", rt.method, rt.path, r.StatusCode)
		}
	}

	const aliceNote = `{"version":1,"entryId":1201,"text":"Horse\n<img src=x onerror=alert(1)>"}`
	r := doRaw(t, http.MethodPut, ts.URL, note+q(a1), alice, aliceNote)
	var row rowBody
	decodeJSON(t, r, &row)
	if r.StatusCode != 200 || row.Key != "note:1201" || row.Version != 1 || row.WorkspaceID == nil || *row.WorkspaceID != a1 {
		t.Fatalf("alice PUT: %d %+v", r.StatusCode, row)
	}
	if r := doRaw(t, http.MethodPut, ts.URL, note+q(a1), alice, aliceNote); r.StatusCode != 200 {
		t.Fatalf("second PUT: %d", r.StatusCode)
	}
	r = doJSON(t, http.MethodGet, ts.URL, note+q(a1), alice, nil)
	decodeJSON(t, r, &row)
	if r.StatusCode != 200 || canonJSON(t, row.Data) != canonJSON(t, []byte(aliceNote)) || row.Version != 2 {
		t.Errorf("alice GET: %d %+v", r.StatusCode, row)
	}

	// refused keys and scopes
	for name, c := range map[string]struct {
		method, path string
		want         int
	}{
		"a typed study key":            {http.MethodPut, "/api/rows/card:c-vocab-1" + q(a1), 404},
		"an unknown key":               {http.MethodGet, "/api/rows/knownfilter" + q(a1), 404},
		"a note without a workspace":   {http.MethodPut, note, 400},
		"the home layout in workspace": {http.MethodPut, "/api/rows/home-layout" + q(a1), 400},
		"a workspace that is no id":    {http.MethodGet, note + "?workspace=x", 400},
	} {
		if r := doRaw(t, c.method, ts.URL, c.path, alice, `{}`); r.StatusCode != c.want {
			t.Errorf("%s: %d, want %d", name, r.StatusCode, c.want)
		}
	}
	if r := doRaw(t, http.MethodPut, ts.URL, note+q(a1), alice, `not json`); r.StatusCode != 400 {
		t.Errorf("not JSON: %d, want 400", r.StatusCode)
	}

	// bob's own note on the same entry and his own user-global row stay his
	if r := doRaw(t, http.MethodPut, ts.URL, note+q(b1), bob, `{"version":1,"entryId":1201,"text":"bob's"}`); r.StatusCode != 200 {
		t.Fatalf("bob PUT own: %d", r.StatusCode)
	}
	if r := doRaw(t, http.MethodPut, ts.URL, "/api/rows/home-layout", bob, `{"version":1,"widgets":[]}`); r.StatusCode != 200 {
		t.Fatalf("bob PUT layout: %d", r.StatusCode)
	}
	listed := func(token, query string) []rowBody {
		t.Helper()
		r := doJSON(t, http.MethodGet, ts.URL, "/api/rows"+query, token, nil)
		if r.StatusCode != 200 {
			t.Fatalf("list %s: %d", query, r.StatusCode)
		}
		var rows []rowBody
		decodeJSON(t, r, &rows)
		return rows
	}
	if rows := listed(alice, q(a1)+"&prefix=note:"); len(rows) != 1 || canonJSON(t, rows[0].Data) != canonJSON(t, []byte(aliceNote)) {
		t.Errorf("alice's notes in workspace 1 = %+v", rows)
	}
	if rows := listed(alice, q(a2)); len(rows) != 0 {
		t.Errorf("alice's rows in workspace 2 = %+v", rows)
	}
	if rows := listed(alice, ""); len(rows) != 0 {
		t.Errorf("alice's user-global rows = %+v, want none (bob's layout is his)", rows)
	}
	if rows := listed(bob, ""); len(rows) != 1 || rows[0].Key != "home-layout" {
		t.Errorf("bob's user-global rows = %+v", rows)
	}

	if r := doJSON(t, http.MethodDelete, ts.URL, note+q(a1), alice, nil); r.StatusCode != 204 {
		t.Errorf("DELETE: %d", r.StatusCode)
	}
	if r := doJSON(t, http.MethodDelete, ts.URL, note+q(a1), alice, nil); r.StatusCode != 404 {
		t.Errorf("second DELETE: %d, want 404", r.StatusCode)
	}
	if r := doJSON(t, http.MethodGet, ts.URL, note+q(b1), bob, nil); r.StatusCode != 200 {
		t.Errorf("alice's delete reached bob: %d", r.StatusCode)
	}
}
