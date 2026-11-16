package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/model"
	"qinqin/internal/ratelimit"
)

// tokenActors are the access token callers of the route walk: user 1
// (gate-user) owns workspaces A and B, user 2 (gate-user2) owns C.
type tokenActors struct {
	patW, patR, patL, patExpired, adminPatW string
	wsA, wsB, wsC                           int64
}

// newTokenActors mints the tokens of the walk on the gate server's users.
func newTokenActors(t *testing.T, sqlDB *sql.DB) tokenActors {
	t.Helper()
	ctx := context.Background()
	id := func(name string) int64 {
		var n int64
		if err := sqlDB.QueryRow(`SELECT id FROM users WHERE username = ?`, name).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if _, err := sqlDB.Exec(`INSERT INTO users (username, hash, updated_at, created_at) VALUES ('gate-user2', 'x', 't', 't')`); err != nil {
		t.Fatal(err)
	}
	ws := func(user int64, name string) int64 {
		res, err := sqlDB.Exec(`INSERT INTO workspaces (user_id, language, name, updated_at) VALUES (?, 'zh', ?, '2026-01-01T00:00:00Z')`, user, name)
		if err != nil {
			t.Fatal(err)
		}
		n, _ := res.LastInsertId()
		return n
	}
	u1, u2, admin := id("gate-user"), id("gate-user2"), id("gate-admin")
	a := tokenActors{wsA: ws(u1, "A"), wsB: ws(u1, "B"), wsC: ws(u2, "C")}
	mint := func(user int64, scope string, days int, w *int64) string {
		tok, _, err := auth.CreateToken(ctx, sqlDB, user, auth.TokenRequest{Name: "walk", Scope: scope, ExpiresInDays: days, WorkspaceID: w})
		if err != nil {
			t.Fatal(err)
		}
		return tok
	}
	a.patW = mint(u1, "write", 30, nil)
	a.patR = mint(u1, "read", 30, nil)
	a.patL = mint(u1, "write", 30, &a.wsA)
	a.adminPatW = mint(admin, "write", 30, nil)
	a.patExpired = mint(u1, "write", 1, nil)
	if _, err := sqlDB.Exec(`UPDATE access_tokens SET expires_at = '2000-01-01T00:00:00Z' WHERE id = (SELECT MAX(id) FROM access_tokens)`); err != nil {
		t.Fatal(err)
	}
	return a
}

// tokenRequest is gateRequest with an optional ?workspace= value ("" none).
func tokenRequest(t *testing.T, h http.Handler, pattern, token, workspace string) (status int, code string, body []byte) {
	t.Helper()
	method, path, _ := strings.Cut(pattern, " ")
	path = pathVar.ReplaceAllString(path, "1")
	if workspace != "" {
		path += "?workspace=" + workspace
	}
	var rd *strings.Reader
	if method == http.MethodGet || method == http.MethodHead {
		rd = strings.NewReader("")
	} else {
		rd = strings.NewReader("{}")
	}
	r := httptest.NewRequest(method, path, rd)
	r.Header.Set("Content-Type", "application/json")
	r.RemoteAddr = "192.0.2.10:1234"
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	func() {
		defer func() {
			if p := recover(); p != nil {
				t.Errorf("%s panicked: %v", pattern, p)
			}
		}()
		h.ServeHTTP(w, r)
	}()
	var e struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &e)
	return w.Code, e.Error, w.Body.Bytes()
}

func isTokenGateCode(code string) bool {
	return isGateCode(code) || strings.HasPrefix(code, "token_") || code == "rate_limited"
}

// TestRouteWalkTokens drives every route of routes() with every kind of
// access token. A route without a rule refuses every token before lookup
// (also public routes); a route with one behaves as its rule says.
func TestRouteWalkTokens(t *testing.T) {
	s, h, _, _, sqlDB := newGateServerFresh(t)
	s.limits = newAuthLimits(walkPolicy())
	a := newTokenActors(t, sqlDB)
	A, B, C := strconv.FormatInt(a.wsA, 10), strconv.FormatInt(a.wsB, 10), strconv.FormatInt(a.wsC, 10)
	for _, rt := range s.routes() {
		check := func(who, token, ws string, wantStatus int, wantCode string) {
			t.Helper()
			status, code, _ := tokenRequest(t, h, rt.pattern, token, ws)
			if status != wantStatus || code != wantCode {
				t.Errorf("%s %+v as %s (ws %q) = %d %q, want %d %q", rt.pattern, rt.token, who, ws, status, code, wantStatus, wantCode)
			}
		}
		through := func(who, token, ws string) {
			t.Helper()
			status, code, _ := tokenRequest(t, h, rt.pattern, token, ws)
			if isTokenGateCode(code) || status == 401 {
				t.Errorf("%s %+v as %s (ws %q) = %d %q: the token gate stopped a caller it must let through", rt.pattern, rt.token, who, ws, status, code)
			}
		}
		if rt.token.scope == tokNone {
			for who, tok := range map[string]string{"patW": a.patW, "patR": a.patR, "patL": a.patL, "patExpired": a.patExpired, "adminPatW": a.adminPatW, "malformed": "qq_pat_x"} {
				check(who, tok, "", 403, "token_not_allowed")
			}
			continue
		}
		check("patExpired", a.patExpired, "", 401, "unauthorized")
		check("malformed", "qq_pat_x", "", 401, "unauthorized")
		ws := ""
		if rt.token.ws == wsQuery {
			ws = A
		}
		through("patW", a.patW, ws)
		through("adminPatW", a.adminPatW, "")
		if rt.token.scope == tokWrite {
			check("patR", a.patR, ws, 403, "token_read_only")
		} else {
			through("patR", a.patR, ws)
		}
		switch rt.token.ws {
		case wsNone:
			check("patL", a.patL, "", 403, "token_workspace")
			check("patL", a.patL, A, 403, "token_workspace")
		case wsGlobal:
			through("patL", a.patL, "")
		case wsQuery:
			through("patL", a.patL, A)
			check("patL", a.patL, "", 403, "token_workspace")
			check("patL", a.patL, B, 403, "token_workspace")
			check("patL", a.patL, C, 403, "token_workspace")
			check("patL", a.patL, "0"+A+"x", 403, "token_workspace")
		}
	}
}

// walkPolicy lifts the per-user token budget out of the walk's way.
func walkPolicy() AuthPolicy {
	p := DefaultAuthPolicy()
	p.Named["pat"] = ratelimit.BucketPolicy{Burst: 1_000_000, Every: time.Millisecond, MaxKeys: authTableCap}
	return p
}

// stubRoute is a route whose handler reports whether it ran and with which
// gate principal.
func stubRoute(rule tokenRule, ran *bool, got **auth.Principal) route {
	return route{pattern: "GET /stub", access: accUser, token: rule, handler: func(w http.ResponseWriter, r *http.Request) {
		*ran = true
		*got = gatePrincipal(r)
		w.WriteHeader(299)
	}}
}

func serveStub(s *server, rt route, token, query string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", "/stub"+query, nil)
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	s.tokenGate(rt)(w, r)
	return w
}

// The gate's checks run in the order of the spec (§4).
func TestTokenGateOrder(t *testing.T) {
	s, _, a, sqlDB := newGateServer(t)
	ta := newTokenActors(t, sqlDB)
	var ran bool
	var got *auth.Principal
	reset := func() { ran, got = false, nil }
	expect := func(name string, w *httptest.ResponseRecorder, status int, code string) {
		t.Helper()
		var e struct{ Error string }
		json.Unmarshal(w.Body.Bytes(), &e)
		if w.Code != status || e.Error != code || ran {
			t.Errorf("%s: %d %q (handler ran %v), want %d %q", name, w.Code, e.Error, ran, status, code)
		}
		reset()
	}
	// 1. no rule: refused before any lookup, even for a malformed string.
	expect("no rule, malformed", serveStub(s, stubRoute(noTok, &ran, &got), "qq_pat_x", ""), 403, "token_not_allowed")
	expect("no rule, valid", serveStub(s, stubRoute(noTok, &ran, &got), ta.patW, ""), 403, "token_not_allowed")
	// 2. one 401 body for malformed, unknown and expired.
	read := stubRoute(tokReadAny, &ran, &got)
	var bodies []string
	for _, tok := range []string{"qq_pat_x", "qq_pat_" + strings.Repeat("0", 64), ta.patExpired} {
		w := serveStub(s, read, tok, "")
		bodies = append(bodies, w.Body.String())
		expect("refused token", w, 401, "unauthorized")
	}
	if bodies[0] != bodies[1] || bodies[1] != bodies[2] {
		t.Errorf("401 bodies differ: %q", bodies)
	}
	// The anonymous 401 of a session route is the same body.
	if bodies[0] != `{"error":"unauthorized","message":"Sign in to continue."}` {
		t.Errorf("401 body %s", bodies[0])
	}
	// 3. a restricted owner gets the restriction before read-only.
	u1 := ta.patR
	sqlDB.Exec(`UPDATE users SET must_change_password = 1 WHERE username = 'gate-user'`)
	expect("restricted", serveStub(s, stubRoute(tokWriteAny, &ran, &got), u1, ""), 403, "password_change_required")
	sqlDB.Exec(`UPDATE users SET must_change_password = 0 WHERE username = 'gate-user'`)
	// 4. read-only before the workspace check.
	readL, _, err := auth.CreateToken(context.Background(), sqlDB, userIDNamed(t, sqlDB, "gate-user"), auth.TokenRequest{Name: "n", Scope: "read", ExpiresInDays: 1, WorkspaceID: &ta.wsA})
	if err != nil {
		t.Fatal(err)
	}
	expect("read-only first", serveStub(s, stubRoute(tokWriteAny, &ran, &got), readL, ""), 403, "token_read_only")
	// 5. workspace.
	expect("workspace", serveStub(s, stubRoute(tokWriteAny, &ran, &got), ta.patL, ""), 403, "token_workspace")
	expect("workspace twice", serveStub(s, stubRoute(tokWriteWS, &ran, &got), ta.patL, "?workspace="+strconv.FormatInt(ta.wsA, 10)+"&workspace="+strconv.FormatInt(ta.wsA, 10)), 403, "token_workspace")
	// 7. through, with the principal in the context.
	w := serveStub(s, stubRoute(tokWriteWS, &ran, &got), ta.patL, "?workspace="+strconv.FormatInt(ta.wsA, 10))
	if w.Code != 299 || !ran || got == nil || !got.ViaToken() || got.User.Username != "gate-user" {
		t.Errorf("through: %d ran %v principal %+v", w.Code, ran, got)
	}
	reset()
	// Without an access token the gate is a pass-through: no principal.
	for name, tok := range map[string]string{"session": a.user, "none": "", "garbage": "nonsense"} {
		w := serveStub(s, stubRoute(noTok, &ran, &got), tok, "")
		if w.Code != 299 || !ran || got != nil {
			t.Errorf("%s: %d ran %v principal %v; want a plain pass-through", name, w.Code, ran, got)
		}
		reset()
	}
}

func userIDNamed(t *testing.T, sqlDB *sql.DB, name string) int64 {
	t.Helper()
	var id int64
	if err := sqlDB.QueryRow(`SELECT id FROM users WHERE username = ?`, name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// Matrix 5: even a wrongly marked admin row would not serve a token: the
// admin helpers refuse a token principal themselves.
func TestAdminHelpersRefuseTokenPrincipals(t *testing.T) {
	s, _, _, _ := newGateServer(t)
	p := &auth.Principal{User: model.User{ID: 2, Username: "gate-admin", Admin: true}, Level: auth.LevelFull, TokenID: 7, TokenScope: "write"}
	r := httptest.NewRequest("GET", "/", nil).WithContext(context.WithValue(context.Background(), gatePrincipalKey{}, p))
	w := httptest.NewRecorder()
	if got := s.requireAdminPrincipal(w, r); got != nil || w.Code != 403 || !strings.Contains(w.Body.String(), "token_not_allowed") {
		t.Errorf("requireAdminPrincipal = %v, %d %s", got, w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	if got := s.requireAdmin(w, r); got != nil || w.Code != 403 || !strings.Contains(w.Body.String(), "token_not_allowed") {
		t.Errorf("requireAdmin = %v, %d %s", got, w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	if _, ok := s.requireCustomAdmin(w, r); ok || w.Code != 403 || !strings.Contains(w.Body.String(), "token_not_allowed") {
		t.Errorf("requireCustomAdmin = %v, %d %s", ok, w.Code, w.Body.String())
	}
}

// Matrix 23: a qq_pat_ bearer that did not come through the gate is
// anonymous to every helper.
func TestTokenWithoutGatePrincipalIsAnonymous(t *testing.T) {
	s, _, _, sqlDB := newGateServer(t)
	ta := newTokenActors(t, sqlDB)
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "Bearer "+ta.patW)
	w := httptest.NewRecorder()
	if u := s.requireUser(w, r); u != nil || w.Code != 401 {
		t.Errorf("requireUser = %v, %d", u, w.Code)
	}
	if u := s.optionalUser(r); u != nil {
		t.Errorf("optionalUser = %v", u)
	}
	w = httptest.NewRecorder()
	if p := s.requireAdminPrincipal(w, r); p != nil || w.Code != 403 {
		t.Errorf("requireAdminPrincipal = %v, %d", p, w.Code)
	}
}
