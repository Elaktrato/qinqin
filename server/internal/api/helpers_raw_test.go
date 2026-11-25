package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

// rowBody mirrors the response of the keyed row routes.
type rowBody struct {
	Key         string          `json:"key"`
	UserID      int64           `json:"userId"`
	WorkspaceID *int64          `json:"workspaceId"`
	Data        json.RawMessage `json:"data"`
	Version     int             `json:"version"`
}

// doRaw performs a request with a raw string body and the given bearer
// token ("" for none), returning the undecoded response. doJSON cannot
// carry an invalid or verbatim body; keyed row values are raw JSON.
func doRaw(t *testing.T, method, tsURL, path, token, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, tsURL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("build %s %s: %v", method, path, err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func readAll(t *testing.T, resp *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// canonJSON re-encodes a JSON value so escaping and spacing do not matter.
func canonJSON(t *testing.T, raw []byte) string {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("bad JSON %s: %v", raw, err)
	}
	b, _ := json.Marshal(v)
	return string(b)
}
