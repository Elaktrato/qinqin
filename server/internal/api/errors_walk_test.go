package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/ratelimit"
)

// The error contract, checked on the answers (spec 2026-11-23-error-
// contract-design.md, section 4): every route of routes() is called as an
// anonymous caller, a user and an admin with an empty body, an empty
// object, a malformed body, unknown and non-numeric path values and an
// unknown workspace; then unmatched paths and wrong methods. Every answer
// with an error status must be application/json with a catalogue code and
// a message.

type walkFailure struct{ pattern, what string }

func checkErrorAnswer(cat map[string]int, w *httptest.ResponseRecorder) string {
	if w.Code < 400 || w.Code == 499 {
		return ""
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		return "Content-Type " + ct + ": " + abbreviate(w.Body.String())
	}
	var body struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		return "not JSON: " + abbreviate(w.Body.String())
	}
	st, ok := cat[body.Error]
	if !ok {
		return "code " + body.Error + " is not in errors.json: " + abbreviate(w.Body.String())
	}
	if w.Code != st && !slices.Contains(documentedStatuses[body.Error], w.Code) {
		return "code " + body.Error + " answered with " + strconv.Itoa(w.Code) + ", errors.json says " + strconv.Itoa(st)
	}
	if strings.TrimSpace(body.Message) == "" {
		return "no message: " + abbreviate(w.Body.String())
	}
	return ""
}

func abbreviate(s string) string {
	if len(s) > 120 {
		return s[:120] + "…"
	}
	return s
}

// unthrottled is the default sign-in policy with budgets no walk can use
// up: the walk is about the handlers' answers, the throttle has its own
// tests (authlimit_test.go).
func unthrottled() AuthPolicy {
	p := DefaultAuthPolicy()
	p.Client.Burst, p.Account.Burst, p.Pair.Free = 1<<20, 1<<20, 1<<20
	named := map[string]ratelimit.BucketPolicy{}
	for k, b := range p.Named {
		b.Burst = 1 << 20
		named[k] = b
	}
	p.Named = named
	return p
}

// walkAddr gives every walk request its own client address, so the sign-in
// throttle (per address) never answers for the handler.
var walkAddr int

func walkRequest(h http.Handler, method, path, body, token string, header ...string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	walkAddr++
	r.RemoteAddr = "10." + strconv.Itoa(walkAddr>>16&255) + "." + strconv.Itoa(walkAddr>>8&255) + "." + strconv.Itoa(walkAddr&255) + ":1234"
	for i := 0; i+1 < len(header); i += 2 {
		r.Header.Set(header[i], header[i+1])
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestEveryErrorAnswerIsCodedJSON(t *testing.T) {
	cat := errorCatalogue(t)
	s, h, fresh, _, _ := newGateServerFresh(t, WithAuthPolicy(unthrottled()))
	var failures []walkFailure
	seen := map[string]map[string]bool{} // pattern -> codes answered
	for _, rt := range s.routes() {
		method, path, _ := strings.Cut(rt.pattern, " ")
		seen[rt.pattern] = map[string]bool{}
		bodies := []string{""}
		if method != http.MethodGet && method != http.MethodHead {
			bodies = []string{"", "{}", "{", `{"workspaceId": 999999, "workspace": 999999, "ids": [1]}`,
				// Plausible credentials, challenges and tokens reach the deeper sign-in branches.
				`{"username": "gate-user", "password": "not the password 1", "challenge": "c", "method": "totp", "code": "123456",
				  "token": "t", "invite": "i", "email": "a@example.org", "newPassword": "a new password 123",
				  "currentPassword": "wrong password 1"}`}
		}
		a := fresh()
		for _, tok := range []string{"", a.user, a.admin} {
			for _, wild := range []string{"999999", "x"} {
				p := pathVar.ReplaceAllString(path, wild)
				for _, q := range []string{"", "?workspace=999999", "?workspace=x&limit=x&since=x&lang=x"} {
					for _, b := range bodies {
						w := walkRequest(h, method, p+q, b, tok, "Range", "bytes=999999999-")
						if what := checkErrorAnswer(cat, w); what != "" {
							failures = append(failures, walkFailure{rt.pattern, method + " " + p + q + " body " + b + ": " + what})
						}
						var e struct{ Error string }
						if json.Unmarshal(w.Body.Bytes(), &e) == nil && e.Error != "" {
							seen[rt.pattern][e.Error] = true
						}
					}
				}
			}
		}
	}
	// The walk reaches the handlers, not the throttle: no route answers it
	// with the sign-in throttle, and the sign-in routes reach their own
	// refusals.
	for pattern, codes := range seen {
		if codes["rate_limited"] || codes["busy"] {
			t.Errorf("%s: the walk was throttled (%v)", pattern, codes)
		}
	}
	for pattern, want := range map[string]string{
		"POST /api/auth/login":               "bad_credentials",
		"POST /api/auth/login/mfa":           "challenge_expired",
		"POST /api/auth/email-login/verify":  "email_login_unavailable",
		"POST /api/auth/reset":               "token_invalid",
		"POST /api/auth/reset/check":         "token_invalid",
		"POST /api/auth/invite/check":        "invite_invalid",
		"POST /api/account/password":         "wrong_password",
		"POST /api/account/mfa/totp/confirm": "setup_expired",
	} {
		if !seen[pattern][want] {
			t.Errorf("%s: the walk never reached %s (answered %v)", pattern, want, seen[pattern])
		}
	}
	reported := map[string]bool{}
	for _, f := range failures {
		if !reported[f.pattern] { // one line per route keeps the output readable
			reported[f.pattern] = true
			t.Errorf("%s: %s", f.pattern, f.what)
		}
	}
}
