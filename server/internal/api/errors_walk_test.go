package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
	if _, ok := cat[body.Error]; !ok {
		return "code " + body.Error + " is not in errors.json: " + abbreviate(w.Body.String())
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

func walkRequest(h http.Handler, method, path, body, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	r.RemoteAddr = "192.0.2.20:1234"
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestEveryErrorAnswerIsCodedJSON(t *testing.T) {
	cat := errorCatalogue(t)
	s, h, fresh, _, _ := newGateServerFresh(t)
	var failures []walkFailure
	for _, rt := range s.routes() {
		method, path, _ := strings.Cut(rt.pattern, " ")
		bodies := []string{""}
		if method != http.MethodGet && method != http.MethodHead {
			bodies = []string{"", "{}", "{", `{"workspaceId": 999999, "workspace": 999999, "ids": [1]}`}
		}
		a := fresh()
		for _, tok := range []string{"", a.user, a.admin} {
			for _, wild := range []string{"999999", "x"} {
				p := pathVar.ReplaceAllString(path, wild)
				for _, q := range []string{"", "?workspace=999999", "?workspace=x&limit=x&since=x&lang=x"} {
					for _, b := range bodies {
						w := walkRequest(h, method, p+q, b, tok)
						if what := checkErrorAnswer(cat, w); what != "" {
							failures = append(failures, walkFailure{rt.pattern, method + " " + p + q + " body " + b + ": " + what})
						}
					}
				}
			}
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
