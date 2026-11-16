package api_test

import (
	"net/http"
	"strconv"
	"testing"
)

// A session restricted by a forced password change or an MFA enrolment is
// anonymous on GET /api/entries/{id}: it sees the shared entry, never its
// owner's overlay, and is not turned away.
func TestGetEntryWithRestrictedSessionIsAnonymousView(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	fa := lexID(t, sqlDB, "zh", "character", "发")
	path := "/api/entries/" + strconv.FormatInt(fa, 10)
	alice := registerUser(t, ts.URL, "alice", "")
	if resp := doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{"written": "發"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT patch: status %d", resp.StatusCode)
	}
	var full entryBody
	decodeJSON(t, doJSON(t, http.MethodGet, ts.URL, path, alice, nil), &full)
	if full.Written != "發" {
		t.Fatalf("full session sees %q, want her patch", full.Written)
	}

	restrictions := map[string]string{
		"password change": `UPDATE users SET must_change_password = 1 WHERE username = 'alice'`,
		"mfa enrolment":   `UPDATE users SET must_change_password = 0 WHERE username = 'alice'; UPDATE sessions SET level = 'enroll'`,
	}
	for name, stmt := range restrictions {
		if _, err := sqlDB.Exec(stmt); err != nil {
			t.Fatal(err)
		}
		resp := doJSON(t, http.MethodGet, ts.URL, path, alice, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("%s: status %d, want 200 anonymous view", name, resp.StatusCode)
		}
		var body entryBody
		decodeJSON(t, resp, &body)
		if body.Written != "发" {
			t.Errorf("%s: sees %q, want the shared 发", name, body.Written)
		}
	}
}
