package api_test

import (
	"net/http"
	"strconv"
	"strings"
	"testing"
)

// Sync push and the event batch are the largest bodies the API accepts;
// both cap them, answering 413 instead of reading without bound.
func TestLargeBodiesAreRejected(t *testing.T) {
	ts, _ := newServer(t)
	token := registerUser(t, ts.URL, "owner", "")

	huge := `{"events":[],"pluginData":[],"pad":"` + strings.Repeat("x", 9<<20) + `"}`
	if resp := doRaw(t, http.MethodPost, ts.URL, "/api/sync/push", token, huge); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized sync push status = %d, want 413", resp.StatusCode)
	}
	hugeBatch := `{"events":[],"pad":"` + strings.Repeat("x", 9<<20) + `"}`
	if resp := doRaw(t, http.MethodPost, ts.URL, "/api/events/batch", token, hugeBatch); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized event batch status = %d, want 413", resp.StatusCode)
	}
}

// An event id is a ULID; anything else is a client bug caught at the
// door, not stored (and not silently mistaken for a duplicate).
func TestEventIDMustBeULID(t *testing.T) {
	ts, _ := newServer(t)
	token := registerUser(t, ts.URL, "owner", "")
	ws := doJSON(t, http.MethodPost, ts.URL, "/api/workspaces", token, map[string]string{"language": "zh"})
	var w struct {
		ID int64 `json:"id"`
	}
	decodeJSON(t, ws, &w)

	body := `{"events":[{"id":"not-a-ulid","workspaceId":` + strconv.FormatInt(w.ID, 10) + `,"ts":"2026-11-10T10:00:00Z","type":"review","payload":{}}]}`
	for _, path := range []string{"/api/events/batch", "/api/sync/push"} {
		if resp := doRaw(t, http.MethodPost, ts.URL, path, token, body); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s with a non-ULID id: status = %d, want 400", path, resp.StatusCode)
		}
	}
}
