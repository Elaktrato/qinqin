package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestUnmatchedAPIRequestsAreCodedJSON: a path no route matches is 404
// not_found and a known path with another method 405 method_not_allowed,
// both as JSON, the 405 with the mux's Allow header.
func TestUnmatchedAPIRequestsAreCodedJSON(t *testing.T) {
	cat := errorCatalogue(t)
	_, h, a, _ := newGateServer(t)
	for _, c := range []struct {
		method, path string
		status       int
		code         string
	}{
		{"GET", "/api/no-such-route", 404, "not_found"},
		{"POST", "/api/no/such/route", 404, "not_found"},
		{"GET", "/api/", 404, "not_found"},
		{"DELETE", "/api/search", 405, "method_not_allowed"},
		{"PATCH", "/api/workspaces", 405, "method_not_allowed"},
		{"POST", "/healthz", 405, "method_not_allowed"},
	} {
		for _, tok := range []string{"", a.user} {
			w := walkRequest(h, c.method, c.path, "", tok)
			if w.Code != c.status {
				t.Errorf("%s %s = %d, want %d", c.method, c.path, w.Code, c.status)
				continue
			}
			if what := checkErrorAnswer(cat, w); what != "" {
				t.Errorf("%s %s: %s", c.method, c.path, what)
				continue
			}
			var body struct{ Error string }
			json.Unmarshal(w.Body.Bytes(), &body)
			if body.Error != c.code {
				t.Errorf("%s %s code %q, want %q", c.method, c.path, body.Error, c.code)
			}
			if c.status == 405 && w.Header().Get("Allow") == "" {
				t.Errorf("%s %s: 405 without Allow", c.method, c.path)
			}
		}
	}
}

// TestServeContentErrorsAreCodedJSON: the 416 and 412 that http.ServeContent
// writes itself come out as coded JSON; a 206, a 200 and a 304 are left as
// they are.
func TestServeContentErrorsAreCodedJSON(t *testing.T) {
	cat := errorCatalogue(t)
	mod := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	serve := func(h map[string]string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "/api/x", nil)
		for k, v := range h {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		serveContent(w, r, mod, strings.NewReader("0123456789"))
		return w
	}
	for _, c := range []struct {
		name   string
		h      map[string]string
		status int
		code   string
	}{
		{"range outside", map[string]string{"Range": "bytes=50-60"}, 416, "range_not_satisfiable"},
		{"failed precondition", map[string]string{"If-Unmodified-Since": "Mon, 01 Jan 2024 00:00:00 GMT"}, 412, "precondition_failed"},
	} {
		w := serve(c.h)
		if w.Code != c.status {
			t.Fatalf("%s: status %d, want %d", c.name, w.Code, c.status)
		}
		if what := checkErrorAnswer(cat, w); what != "" {
			t.Fatalf("%s: %s", c.name, what)
		}
		var body struct{ Error string }
		json.Unmarshal(w.Body.Bytes(), &body)
		if body.Error != c.code {
			t.Fatalf("%s: code %q, want %q", c.name, body.Error, c.code)
		}
	}
	if w := serve(map[string]string{"Range": "bytes=2-4"}); w.Code != 206 || w.Body.String() != "234" {
		t.Fatalf("range: %d %q", w.Code, w.Body.String())
	}
	if w := serve(nil); w.Code != 200 || w.Body.String() != "0123456789" {
		t.Fatalf("whole: %d %q", w.Code, w.Body.String())
	}
	if w := serve(map[string]string{"If-Modified-Since": "Fri, 01 Jan 2027 00:00:00 GMT"}); w.Code != 304 || w.Body.Len() != 0 {
		t.Fatalf("not modified: %d %q", w.Code, w.Body.String())
	}
}
