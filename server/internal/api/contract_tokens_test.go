package api_test

import (
	"encoding/json"
	"fmt"
	"strconv"
	"testing"
)

// sameTypes compares a fixture value with a response: the same keys, the
// same JSON types, arrays element by element (same length); null matches
// only null.
func sameTypes(t *testing.T, where string, want, got any) {
	t.Helper()
	switch w := want.(type) {
	case map[string]any:
		g, ok := got.(map[string]any)
		if !ok {
			t.Errorf("%s: got %T, want an object", where, got)
			return
		}
		for k := range w {
			if _, ok := g[k]; !ok {
				t.Errorf("%s: response lacks %q", where, k)
			}
		}
		for k := range g {
			if _, ok := w[k]; !ok {
				t.Errorf("%s: response has undocumented %q", where, k)
			}
		}
		for k, wv := range w {
			sameTypes(t, where+"."+k, wv, g[k])
		}
	case []any:
		g, ok := got.([]any)
		if !ok || len(g) != len(w) {
			t.Errorf("%s: got %v, want an array of %d", where, got, len(w))
			return
		}
		for i := range w {
			sameTypes(t, fmt.Sprintf("%s[%d]", where, i), w[i], g[i])
		}
	default:
		if fmt.Sprintf("%T", want) != fmt.Sprintf("%T", got) {
			t.Errorf("%s: type %T, fixture says %T", where, got, want)
		}
	}
}

// Every case of docs/contracts/auth/tokens.json is replayed against the
// server, in the order the scenario needs.
func TestTokenContractFixturesMatchTheServer(t *testing.T) {
	captureLog(t)
	ts, _ := newTokenServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	ws := createWorkspace(t, ts.URL, alice, "zh", "A")
	var write, read string
	var writeID int64
	create := func(b map[string]any, keep *string) func() (int, any) {
		return func() (int, any) {
			st, out := callJSON(t, ts, "POST", "/api/account/tokens", alice, b)
			if m, ok := out.(map[string]any); ok && st == 201 {
				*keep = m["token"].(string)
				if !patShape.MatchString(*keep) {
					t.Errorf("token %q is not token-shaped", "<redacted>")
				}
				m["token"] = "<token>"
			}
			return st, out
		}
	}
	var junk string
	cases := []struct {
		name string
		run  func() (int, any)
	}{
		{"create", func() (int, any) {
			st, out := create(tokenBody("cron sync", "write", 90, nil, "secret-pass-alice"), &write)()
			writeID = int64(out.(map[string]any)["accessToken"].(map[string]any)["id"].(float64))
			callJSON(t, ts, "GET", "/api/workspaces", write, nil) // a first use
			return st, out
		}},
		{"create_limited", create(tokenBody("reader export", "read", 7, ws, "secret-pass-alice"), &read)},
		{"list", func() (int, any) { return callJSON(t, ts, "GET", "/api/account/tokens", alice, nil) }},
		{"read_only", func() (int, any) {
			return callJSON(t, ts, "POST", "/api/events/batch", read, map[string]any{"events": []any{}})
		}},
		{"not_allowed", func() (int, any) { return callJSON(t, ts, "GET", "/api/auth/me", write, nil) }},
		{"workspace", func() (int, any) { return callJSON(t, ts, "GET", "/api/sync/pull", read, nil) }},
		{"invalid_name", create(tokenBody("   ", "read", 30, nil, "secret-pass-alice"), &junk)},
		{"invalid_days", create(tokenBody("forever", "read", 366, nil, "secret-pass-alice"), &junk)},
		{"wrong_password", create(tokenBody("cron sync", "read", 30, nil, "not-the-password"), &junk)},
		{"foreign_revoke", func() (int, any) {
			return callJSON(t, ts, "DELETE", "/api/account/tokens/"+strconv.FormatInt(writeID, 10), bob, nil)
		}},
		{"limit", func() (int, any) {
			for i := 0; i < 18; i++ {
				if st, _ := create(tokenBody("filler", "read", 30, nil, "secret-pass-alice"), &junk)(); st != 201 {
					t.Fatalf("filler %d: %d", i, st)
				}
			}
			return create(tokenBody("one too many", "read", 30, nil, "secret-pass-alice"), &junk)()
		}},
		{"revoke_one", func() (int, any) {
			return callJSON(t, ts, "DELETE", "/api/account/tokens/"+strconv.FormatInt(writeID, 10), alice, nil)
		}},
		{"unauthorized_expired", func() (int, any) { return callJSON(t, ts, "GET", "/api/workspaces", write, nil) }},
		{"revoke_all", func() (int, any) { return callJSON(t, ts, "DELETE", "/api/account/tokens", alice, nil) }},
	}
	fx := readFixture(t, "tokens.json")
	seen := map[string]bool{}
	for _, c := range cases {
		seen[c.name] = true
		var want fixtureCase
		if err := json.Unmarshal(fx[c.name], &want); err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		status, body := c.run()
		if status != want.Status {
			t.Errorf("tokens.json/%s: status %d, fixture says %d (%v)", c.name, status, want.Status, body)
		}
		if want.Body == nil {
			if body != nil {
				t.Errorf("tokens.json/%s: expected no body, got %v", c.name, body)
			}
			continue
		}
		sameTypes(t, "tokens.json/"+c.name, want.Body, body)
		if w, ok := want.Body.(map[string]any); ok {
			g, _ := body.(map[string]any)
			for _, k := range []string{"error", "message"} {
				if wv, ok := w[k]; ok && g[k] != wv {
					t.Errorf("tokens.json/%s: %s %v, fixture says %v", c.name, k, g[k], wv)
				}
			}
		}
	}
	for name := range fx {
		if name[0] != '_' && !seen[name] {
			t.Errorf("tokens.json case %q is not exercised", name)
		}
	}
}
