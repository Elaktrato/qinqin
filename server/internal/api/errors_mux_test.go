package api

import (
	"encoding/json"
	"io"
	"net/http"
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

// TestRecoverAnswersCodedInternal: a handler panic before anything was
// written is a coded 500 internal; after the status went out the
// connection is left as it is; http.ErrAbortHandler keeps aborting.
func TestRecoverAnswersCodedInternal(t *testing.T) {
	cat := errorCatalogue(t)
	serve := func(h http.HandlerFunc) (w *httptest.ResponseRecorder, panicked any) {
		w = httptest.NewRecorder()
		func() {
			defer func() { panicked = recover() }()
			recoverPanics(h).ServeHTTP(w, httptest.NewRequest("GET", "/api/x", nil))
		}()
		return w, panicked
	}
	w, p := serve(func(http.ResponseWriter, *http.Request) { panic("boom") })
	if p != nil || w.Code != 500 || checkErrorAnswer(cat, w) != "" || !strings.Contains(w.Body.String(), `"internal"`) {
		t.Fatalf("panic before writing: %v %d %q", p, w.Code, w.Body.String())
	}
	w, p = serve(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"a":`))
		panic("late")
	})
	if p != nil || w.Code != 200 || w.Body.String() != `{"a":` {
		t.Fatalf("panic after writing: %v %d %q", p, w.Code, w.Body.String())
	}
	_, p = serve(func(http.ResponseWriter, *http.Request) { panic(http.ErrAbortHandler) })
	if p != http.ErrAbortHandler {
		t.Fatalf("ErrAbortHandler was swallowed: %v", p)
	}
}

type flushReaderFrom struct {
	*httptest.ResponseRecorder
	readFrom bool
}

func (f *flushReaderFrom) ReadFrom(r io.Reader) (int64, error) {
	f.readFrom = true
	return io.Copy(f.ResponseRecorder, r)
}

// TestCodedWritersPassThrough: the wrappers unwrap (Flush through a
// ResponseController) and hand io.ReaderFrom on while no error status was
// swallowed, so sendfile still works.
func TestCodedWritersPassThrough(t *testing.T) {
	under := &flushReaderFrom{ResponseRecorder: httptest.NewRecorder()}
	cw := &codedErrors{ResponseWriter: under}
	if err := http.NewResponseController(cw).Flush(); err != nil {
		t.Fatalf("Flush through codedErrors: %v", err)
	}
	if n, err := io.Copy(cw, struct{ io.Reader }{strings.NewReader("abc")}); n != 3 || err != nil || !under.readFrom || under.Body.String() != "abc" {
		t.Fatalf("ReadFrom: %d %v %v %q", n, err, under.readFrom, under.Body.String())
	}
	swallowed := &flushReaderFrom{ResponseRecorder: httptest.NewRecorder()}
	cw = &codedErrors{ResponseWriter: swallowed}
	cw.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
	io.Copy(cw, struct{ io.Reader }{strings.NewReader("text body")})
	if swallowed.Body.Len() != 0 {
		t.Fatalf("a swallowed error body reached the client: %q", swallowed.Body.String())
	}
	rw := &recorded{ResponseWriter: httptest.NewRecorder()}
	if err := http.NewResponseController(rw).Flush(); err != nil {
		t.Fatalf("Flush through the recover writer: %v", err)
	}
}
