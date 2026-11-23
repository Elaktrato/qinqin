package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/dbtest"
)

// gateActors are the callers of the authorization matrix.
type gateActors struct {
	anon, user, admin, pwc, pwcAdmin, enr, enrAdmin string
}

// newGateServer returns the server and a first set of actors; fresh() makes
// new sessions for the same users, so a route that ends a session (logout)
// cannot spoil the next route of the walk.
func newGateServer(t *testing.T) (*server, http.Handler, gateActors, *sql.DB) {
	s, h, _, a, sqlDB := newGateServerFresh(t)
	return s, h, a, sqlDB
}

func newGateServerFresh(t *testing.T, opts ...Option) (*server, http.Handler, func() gateActors, gateActors, *sql.DB) {
	t.Helper()
	sqlDB := dbtest.Open(t)
	s := newServer(sqlDB, t.TempDir(), nil, opts...)
	ids := map[string]int64{}
	user := func(name string, admin, mustChange bool) {
		res, err := sqlDB.Exec(`INSERT INTO users (username, hash, admin, updated_at, created_at, must_change_password, must_change_after)
			VALUES (?, 'x', ?, 't', 't', ?, 0)`, name, admin, mustChange)
		if err != nil {
			t.Fatal(err)
		}
		ids[name], _ = res.LastInsertId()
	}
	user("gate-user", false, false)
	user("gate-admin", true, false)
	user("gate-pwc", false, true)
	user("gate-pwc-admin", true, true)
	user("gate-enr", false, false)
	user("gate-enr-admin", true, false)
	session := func(name, level string) string {
		tok, err := auth.NewSession(context.Background(), sqlDB, ids[name], auth.LoginOptions{Level: level})
		if err != nil {
			t.Fatal(err)
		}
		return tok
	}
	fresh := func() gateActors {
		return gateActors{
			user:     session("gate-user", "full"),
			admin:    session("gate-admin", "full"),
			pwc:      session("gate-pwc", "full"),
			pwcAdmin: session("gate-pwc-admin", "full"),
			enr:      session("gate-enr", "enroll"),
			enrAdmin: session("gate-enr-admin", "enroll"),
		}
	}
	return s, s.handler(), fresh, fresh(), sqlDB
}

var pathVar = regexp.MustCompile(`\{[^}]+\}`)

// gateRequest performs the request a route's pattern describes: a valid
// path (every wildcard "1") and, for writes, a well-formed JSON body.
func gateRequest(t *testing.T, h http.Handler, pattern, token string) (status int, code string) {
	t.Helper()
	method, path, _ := strings.Cut(pattern, " ")
	path = pathVar.ReplaceAllString(path, "1")
	var body *strings.Reader
	if method == http.MethodGet || method == http.MethodHead {
		body = strings.NewReader("")
	} else {
		body = strings.NewReader("{}")
	}
	r := httptest.NewRequest(method, path, body)
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
	return w.Code, e.Error
}

func isGateCode(code string) bool {
	return code == "unauthorized" || code == "forbidden" ||
		code == "password_change_required" || code == "mfa_enrollment_required"
}

// TestRouteWalkMatchesDeclaredAccess drives every pattern of routes() as
// every kind of caller and checks the handler behaves as the route's
// declared access says. A route without a declared policy fails, and so does
// a handler that does not enforce the policy it declares, so a new route
// cannot reach the mux without an access decision that actually holds.
func TestRouteWalkMatchesDeclaredAccess(t *testing.T) {
	s, h, fresh, _, _ := newGateServerFresh(t)
	routes := s.routes()
	if len(routes) < 80 {
		t.Fatalf("routes() has %d entries; the table lost routes", len(routes))
	}
	seen := map[string]bool{}
	for _, rt := range routes {
		if seen[rt.pattern] {
			t.Errorf("%s is declared twice", rt.pattern)
		}
		seen[rt.pattern] = true
		a := fresh()
		check := func(who, token string, wantStatus int, wantCode string) {
			t.Helper()
			status, code := gateRequest(t, h, rt.pattern, token)
			if status != wantStatus || code != wantCode {
				t.Errorf("%s [%s] as %s = %d %q, want %d %q", rt.pattern, rt.access, who, status, code, wantStatus, wantCode)
			}
		}
		through := func(who, token string) {
			t.Helper()
			status, code := gateRequest(t, h, rt.pattern, token)
			if isGateCode(code) {
				t.Errorf("%s [%s] as %s = %d %q: the gate stopped a caller it must let through", rt.pattern, rt.access, who, status, code)
			}
		}
		const pc, enr = "password_change_required", "mfa_enrollment_required"
		switch rt.access {
		case accPublic:
			for who, tok := range map[string]string{"anon": a.anon, "user": a.user, "pwc": a.pwc, "enr": a.enr, "admin": a.admin} {
				through(who, tok)
			}
		case accUser:
			check("anon", a.anon, 401, "unauthorized")
			check("pwc", a.pwc, 403, pc)
			check("pwcAdmin", a.pwcAdmin, 403, pc)
			check("enr", a.enr, 403, enr)
			check("enrAdmin", a.enrAdmin, 403, enr)
			through("user", a.user)
			through("admin", a.admin)
		case accAdmin:
			check("anon", a.anon, 403, "forbidden")
			check("user", a.user, 403, "forbidden")
			check("pwc", a.pwc, 403, pc)
			check("pwcAdmin", a.pwcAdmin, 403, pc)
			check("enr", a.enr, 403, enr)
			check("enrAdmin", a.enrAdmin, 403, enr)
			through("admin", a.admin)
		case accAdminSignedIn:
			check("anon", a.anon, 401, "unauthorized")
			check("user", a.user, 403, "forbidden")
			check("pwc", a.pwc, 403, pc)
			check("pwcAdmin", a.pwcAdmin, 403, pc)
			check("enr", a.enr, 403, enr)
			check("enrAdmin", a.enrAdmin, 403, enr)
			through("admin", a.admin)
		case accSession:
			if len(rt.allow) == 0 {
				t.Errorf("%s: accSession without allow; use accUser", rt.pattern)
			}
			check("anon", a.anon, 401, "unauthorized")
			through("user", a.user)
			through("admin", a.admin)
			if slices.Contains(rt.allow, restrictionPasswordChange) {
				through("pwc", a.pwc)
			} else {
				check("pwc", a.pwc, 403, pc)
			}
			if slices.Contains(rt.allow, restrictionMFAEnrollment) {
				through("enr", a.enr)
			} else {
				check("enr", a.enr, 403, enr)
			}
		default:
			t.Errorf("%s has no declared access (%q): decide public, user, admin or session", rt.pattern, rt.access)
		}
	}
}

// A restricted session is anonymous on an optional-auth route: it does not
// get the owner's overlay and is not turned away either.
func TestOptionalUserTreatsRestrictedAsAnonymous(t *testing.T) {
	s, _, a, sqlDB := newGateServer(t)
	for _, c := range []struct {
		who, token string
		wantUser   bool
	}{{"user", a.user, true}, {"anon", "", false}, {"pwc", a.pwc, false}, {"enr", a.enr, false}, {"pwcAdmin", a.pwcAdmin, false}} {
		r := httptest.NewRequest("GET", "/", nil)
		if c.token != "" {
			r.Header.Set("Authorization", "Bearer "+c.token)
		}
		if got := s.optionalUser(r) != nil; got != c.wantUser {
			t.Errorf("%s: optionalUser present = %v, want %v", c.who, got, c.wantUser)
		}
	}
	_ = sqlDB
}

// A session born before an admin forced a change stays restricted too: the
// flag, not the session's age, restricts it.
func TestFlagSetAfterLoginRestrictsExistingSession(t *testing.T) {
	_, h, a, sqlDB := newGateServer(t)
	if status, _ := gateRequest(t, h, "GET /api/workspaces", a.user); status != 200 {
		t.Fatalf("baseline status %d", status)
	}
	if _, err := sqlDB.Exec(`UPDATE users SET must_change_password = 1 WHERE username = 'gate-user'`); err != nil {
		t.Fatal(err)
	}
	if status, code := gateRequest(t, h, "GET /api/workspaces", a.user); status != 403 || code != "password_change_required" {
		t.Errorf("after the flag: %d %q, want 403 password_change_required", status, code)
	}
}

// An admin whose session is restricted is no admin on the legacy
// admin-bearer registration path.
func TestRestrictedAdminCannotRegisterUsers(t *testing.T) {
	_, h, a, _ := newGateServer(t)
	for who, tok := range map[string]string{"pwcAdmin": a.pwcAdmin, "enrAdmin": a.enrAdmin} {
		r := httptest.NewRequest("POST", "/api/auth/register", strings.NewReader(`{"username":"newperson","password":"long-enough-pw"}`))
		r.Header.Set("Authorization", "Bearer "+tok)
		r.RemoteAddr = "192.0.2.11:1"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 403 || !strings.Contains(w.Body.String(), "registration_closed") {
			t.Errorf("%s: %d %s, want 403 registration_closed", who, w.Code, w.Body.String())
		}
	}
}
