package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// errorBody decodes a recorded error answer and checks the fixed shape:
// application/json, a non-empty error code and a non-empty message.
func errorBody(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json (body %q)", ct, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q is not JSON: %v", w.Body.String(), err)
	}
	if w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("error answer without nosniff")
	}
	if code, _ := body["error"].(string); code == "" {
		t.Fatalf("body %q has no error code", w.Body.String())
	}
	if msg, _ := body["message"].(string); msg == "" {
		t.Fatalf("body %q has no message", w.Body.String())
	}
	return body
}

func TestWriteErrorShape(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusNotFound, "not_found", "No such entry.")
	if w.Code != 404 {
		t.Fatalf("status %d", w.Code)
	}
	body := errorBody(t, w)
	if body["error"] != "not_found" || body["message"] != "No such entry." || len(body) != 2 {
		t.Fatalf("body %v", body)
	}
}

func TestWriteErrorExtraMembers(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusConflict, "highlight_overlap", "The text is already highlighted.",
		map[string]any{"existingId": 7, "error": "spoofed", "message": "spoofed"})
	body := errorBody(t, w)
	if body["error"] != "highlight_overlap" || body["message"] != "The text is already highlighted." || body["existingId"] != float64(7) {
		t.Fatalf("body %v", body)
	}
}

func decodeReq(body string) *http.Request {
	return httptest.NewRequest(http.MethodPost, "/api/x", strings.NewReader(body))
}

func TestDecodeBody(t *testing.T) {
	type in struct {
		Name string `json:"name"`
	}
	cases := []struct {
		name, body string
		strict     bool
		status     int
		code       string
	}{
		{"valid", `{"name":"a"}`, false, 0, ""},
		{"valid strict", `{"name":"a"}`, true, 0, ""},
		{"malformed", `{`, false, 400, "bad_request"},
		{"wrong type", `{"name":1}`, false, 400, "bad_request"},
		{"empty", ``, false, 400, "bad_request"},
		{"unknown field lenient", `{"name":"a","x":1}`, false, 0, ""},
		{"unknown field strict", `{"name":"a","x":1}`, true, 400, "bad_request"},
		{"trailing data lenient", `{"name":"a"} {}`, false, 0, ""},
		{"trailing data strict", `{"name":"a"} {}`, true, 400, "bad_request"},
		{"over the cap", `{"name":"` + strings.Repeat("a", 100) + `"}`, false, 413, "too_large"},
		{"over the cap strict", `{"name":"` + strings.Repeat("a", 100) + `"}`, true, 413, "too_large"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			var v in
			ok := decodeBody(w, decodeReq(c.body), &v, 64, c.strict)
			if c.status == 0 {
				if !ok || v.Name != "a" {
					t.Fatalf("ok=%v v=%+v body=%q", ok, v, w.Body.String())
				}
				return
			}
			if ok || w.Code != c.status {
				t.Fatalf("ok=%v status=%d, want %d", ok, w.Code, c.status)
			}
			if got := errorBody(t, w)["error"]; got != c.code {
				t.Fatalf("code %v, want %s", got, c.code)
			}
		})
	}
}

func TestBadBodyAndReadBodyAreCoded(t *testing.T) {
	w := httptest.NewRecorder()
	badBody(w, errors.New("syntax"))
	if w.Code != 400 || errorBody(t, w)["error"] != "bad_request" {
		t.Fatalf("badBody malformed: %d %q", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	badBody(w, &http.MaxBytesError{Limit: 1})
	if w.Code != 413 || errorBody(t, w)["error"] != "too_large" {
		t.Fatalf("badBody too big: %d %q", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	if _, ok := readBody(w, decodeReq(strings.Repeat("a", 100)), 10); ok || w.Code != 413 || errorBody(t, w)["error"] != "too_large" {
		t.Fatalf("readBody over cap: %d %q", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	writeTooLarge(w)
	if w.Code != 413 || errorBody(t, w)["error"] != "too_large" {
		t.Fatalf("writeTooLarge: %d %q", w.Code, w.Body.String())
	}
}
