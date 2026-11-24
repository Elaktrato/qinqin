package api_test

import (
	"io"
	"net/http"
	"testing"

	"qinqin/internal/api"
	"qinqin/internal/dbtest"
)

func TestHealthz(t *testing.T) {
	sqlDB := dbtest.Open(t)

	ts := newTestServer(sqlDB, api.New(sqlDB, t.TempDir(), nil))
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if got := string(body); got != "ok" {
		t.Errorf("body = %q, want %q", got, "ok")
	}
}
