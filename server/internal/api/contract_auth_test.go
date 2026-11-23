package api_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/api"
)

const contractDir = "../../../docs/contracts/auth"

func readFixture(t *testing.T, name string) map[string]json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(contractDir, name))
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]json.RawMessage
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	return out
}

type fixtureCase struct {
	Status int `json:"status"`
	Body   any `json:"body"`
}

// sameShape compares key sets and JSON value types recursively; values are
// ignored. An array's elements are all compared with the fixture's first.
func sameShape(t *testing.T, where string, want, got any) {
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
				t.Errorf("%s: response lacks documented key %q", where, k)
			}
		}
		for k := range g {
			if _, ok := w[k]; !ok {
				t.Errorf("%s: response has undocumented key %q", where, k)
			}
		}
		for k, wv := range w {
			if gv, ok := g[k]; ok {
				sameShape(t, where+"."+k, wv, gv)
			}
		}
	case []any:
		g, ok := got.([]any)
		if !ok {
			t.Errorf("%s: got %T, want an array", where, got)
			return
		}
		if len(w) > 0 {
			if len(g) == 0 {
				t.Errorf("%s: empty array cannot show the element shape", where)
			}
			for i, ge := range g {
				sameShape(t, fmt.Sprintf("%s[%d]", where, i), w[0], ge)
			}
		}
	default:
		if fmt.Sprintf("%T", want) != fmt.Sprintf("%T", got) {
			t.Errorf("%s: type %T, fixture says %T", where, got, want)
		}
	}
}

func secretFree(t *testing.T, file string, v any) {
	t.Helper()
	switch x := v.(type) {
	case map[string]any:
		for k, e := range x {
			if k == "token" {
				if s, _ := e.(string); s != "tok_example" {
					t.Errorf("%s: token value %q is not the obvious fake tok_example", file, s)
				}
			}
			secretFree(t, file, e)
		}
	case []any:
		for _, e := range x {
			secretFree(t, file, e)
		}
	}
}

func callJSON(t *testing.T, ts *httptest.Server, method, path, token string, body any) (int, any) {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, ts.URL+path, rdr)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out any
	if resp.StatusCode != 204 {
		json.NewDecoder(resp.Body).Decode(&out)
	}
	return resp.StatusCode, out
}

// Every fixture is decoded and compared with a real response, so the files
// cannot drift from the server.
func TestAuthContractFixturesMatchTheServer(t *testing.T) {
	policy := api.DefaultAuthPolicy()
	policy.Client.Burst = 1000 // the scenario signs in far more often than a person
	ts, sqlDB := newPolicyServer(t, api.WithAuthPolicy(policy))
	alice := registerUser(t, ts.URL, "alice", "")
	bobbyAdmin := alice
	registerUser(t, ts.URL, "bobby", bobbyAdmin)
	registerUser(t, ts.URL, "dora", bobbyAdmin)
	sqlDB.Exec(`UPDATE users SET disabled_at = '2026-01-01T00:00:00Z' WHERE username = 'dora'`)
	sqlDB.Exec(`UPDATE users SET must_change_password = 1, must_change_after = 0 WHERE username = 'bobby'`)
	pwc := login(t, ts.URL, "bobby")
	other := login(t, ts.URL, "alice")
	var otherID int64
	for _, r := range listSessions(t, ts.URL, alice) {
		if r["current"] != true {
			otherID = int64(r["id"].(float64))
		}
	}
	_ = other

	login200 := func(user string, extra map[string]any) func() (int, any) {
		return func() (int, any) {
			b := map[string]any{"username": user, "password": "secret-pass-" + user}
			for k, v := range extra {
				b[k] = v
			}
			return callJSON(t, ts, "POST", "/api/auth/login", "", b)
		}
	}
	cases := map[string]map[string]func() (int, any){
		"login-responses.json": {
			"ok":                       login200("alice", map[string]any{"deviceName": "qinqin Android - Pixel 8"}),
			"password_change_required": login200("bobby", nil),
			"account_disabled":         login200("dora", nil),
		},
		"me.json": {
			"full":            func() (int, any) { return callJSON(t, ts, "GET", "/api/auth/me", alice, nil) },
			"password_change": func() (int, any) { return callJSON(t, ts, "GET", "/api/auth/me", pwc, nil) },
		},
		"sessions.json": {
			"list": func() (int, any) { return callJSON(t, ts, "GET", "/api/account/sessions", alice, nil) },
			"revoke_one": func() (int, any) {
				return callJSON(t, ts, "DELETE", "/api/account/sessions/"+strconv.FormatInt(otherID, 10), alice, nil)
			},
			"restricted": func() (int, any) { return callJSON(t, ts, "GET", "/api/workspaces", pwc, nil) },
			"wrong_password": func() (int, any) {
				return callJSON(t, ts, "POST", "/api/account/password", alice, map[string]any{"currentPassword": "not-it-at-all", "newPassword": "a-new-long-password"})
			},
			"weak_password": func() (int, any) {
				return callJSON(t, ts, "POST", "/api/account/password", alice, map[string]any{"currentPassword": "secret-pass-alice", "newPassword": "short"})
			},
			"revoke_scope": func() (int, any) {
				login(t, ts.URL, "alice")
				login(t, ts.URL, "alice")
				return callJSON(t, ts, "POST", "/api/account/sessions/revoke", alice, map[string]any{"scope": "others"})
			},
			"change_password": func() (int, any) {
				return callJSON(t, ts, "POST", "/api/account/password", alice, map[string]any{"currentPassword": "secret-pass-alice", "newPassword": "a-new-long-password"})
			},
			"logout": func() (int, any) { return callJSON(t, ts, "POST", "/api/auth/logout", alice, nil) },
		},
	}
	// Order matters for the stateful ones in sessions.json: run the
	// non-destructive cases first, change_password and logout last.
	order := []string{"list", "restricted", "wrong_password", "weak_password", "revoke_one", "revoke_scope", "change_password", "logout"}
	// Fixed order: sessions.json changes alice's password and ends her session.
	for _, file := range []string{"login-responses.json", "me.json", "sessions.json"} {
		byName := cases[file]
		fx := readFixture(t, file)
		names := []string{}
		if file == "sessions.json" {
			names = order
		} else {
			for n := range byName {
				names = append(names, n)
			}
		}
		for _, name := range names {
			raw, ok := fx[name]
			if !ok {
				t.Errorf("%s has no case %q", file, name)
				continue
			}
			var c fixtureCase
			if err := json.Unmarshal(raw, &c); err != nil {
				t.Fatalf("%s/%s: %v", file, name, err)
			}
			secretFree(t, file+"/"+name, c.Body)
			status, body := byName[name]()
			if status != c.Status {
				t.Errorf("%s/%s: status %d, fixture says %d", file, name, status, c.Status)
			}
			if c.Body == nil {
				if body != nil {
					t.Errorf("%s/%s: expected no body, got %v", file, name, body)
				}
				continue
			}
			sameShape(t, file+"/"+name, c.Body, body)
			got, isMap := body.(map[string]any)
			if m, ok := c.Body.(map[string]any); ok && isMap {
				if want, ok := m["error"]; ok {
					if got := got["error"]; got != want {
						t.Errorf("%s/%s: error code %v, fixture says %v", file, name, got, want)
					}
				}
				if want, ok := m["status"]; ok {
					if got := got["status"]; got != want {
						t.Errorf("%s/%s: status word %v, fixture says %v", file, name, got, want)
					}
				}
			}
		}
		for n := range fx {
			if _, ok := byName[n]; !ok {
				t.Errorf("%s: fixture %q is not exercised by any test", file, n)
			}
		}
	}
}

// errors.json is the one catalogue: every code of throttle-responses.json
// must be in it with the same status.
func TestAuthErrorCatalogueIsCoherent(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(contractDir, "errors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cat map[string]json.RawMessage
	json.Unmarshal(raw, &cat)
	status := map[string]int{}
	for code, r := range cat {
		if strings.HasPrefix(code, "_") {
			continue
		}
		var e struct {
			Status  int    `json:"status"`
			Meaning string `json:"meaning"`
		}
		if err := json.Unmarshal(r, &e); err != nil || e.Status == 0 || e.Meaning == "" {
			t.Errorf("errors.json %q: %v / %+v", code, err, e)
		}
		status[code] = e.Status
	}

	// Worked examples of the throttling contract.
	traw, _ := os.ReadFile(filepath.Join(contractDir, "throttle-responses.json"))
	var ex map[string]struct {
		Status int `json:"status"`
		Body   struct {
			Error string `json:"error"`
		} `json:"body"`
	}
	if err := json.Unmarshal(traw, &ex); err != nil {
		t.Fatal(err)
	}
	for name, e := range ex {
		if st, ok := status[e.Body.Error]; !ok || st != e.Status {
			t.Errorf("throttle-responses.json %q: code %q status %d vs errors.json %d (present %v)", name, e.Body.Error, e.Status, st, ok)
		}
	}

	// Every writeError call site names a catalogued code with its status:
	// TestEveryErrorGoesThroughWriteError (errors_static_test.go).
}
