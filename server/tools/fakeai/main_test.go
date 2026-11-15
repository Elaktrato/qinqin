package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandlerRoutesAndLogsNoSecrets(t *testing.T) {
	var logs bytes.Buffer
	srv := httptest.NewServer(handler(&logs))
	t.Cleanup(srv.Close)

	get := func(path, auth, hdr string) int {
		req, _ := http.NewRequest(http.MethodGet, srv.URL+path, nil)
		if auth != "" {
			req.Header.Set(hdr, auth)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if c := get("/v1/models", "Bearer sk-fake-SECRET-0001", "Authorization"); c != 200 {
		t.Errorf("openai models = %d", c)
	}
	if c := get("/v1/models", "Bearer sk-fake-bad-key-0001", "Authorization"); c != 401 {
		t.Errorf("bad key = %d, want 401 like ai.Fake", c)
	}
	if c := get("/v1beta/models/gemini-3.8-flash", "SECRET-GEMINI-0001", "x-goog-api-key"); c != 200 {
		t.Errorf("gemini model = %d", c)
	}
	if c := get("/v1/models", "", ""); c != 200 {
		t.Errorf("keyless = %d", c)
	}
	out := logs.String()
	for _, want := range []string{"GET /v1/models auth=yes", "GET /v1/models auth=no", "GET /v1beta/models/gemini-3.8-flash auth=yes"} {
		if !strings.Contains(out, want) {
			t.Errorf("log lacks %q:\n%s", want, out)
		}
	}
	if strings.Contains(out, "SECRET") || strings.Contains(out, "sk-fake") {
		t.Errorf("log leaks a key:\n%s", out)
	}
}
