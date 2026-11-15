package api_test

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/db"
)

var tzNow = time.Date(2026, 11, 15, 10, 0, 0, 0, time.UTC)

// timeZoneServer serves the API with a fixed clock.
func timeZoneServer(t *testing.T, now time.Time) (*httptest.Server, *sql.DB) {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil, api.WithClock(func() time.Time { return now })))
	t.Cleanup(ts.Close)
	return ts, sqlDB
}

type tzFixtureCase struct {
	Name    string `json:"name"`
	Request struct {
		Method  string          `json:"method"`
		Path    string          `json:"path"`
		Body    json.RawMessage `json:"body"`
		RawBody *string         `json:"rawBody"`
		Token   *bool           `json:"token"`
	} `json:"request"`
	Setup  []struct{ Put json.RawMessage } `json:"setup"`
	Status int                             `json:"status"`
	Body   any                             `json:"body"`
}

func TestTimeZoneFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/study-day/time-zone-api.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []tzFixtureCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) < 20 {
		t.Fatalf("only %d cases", len(f.Cases))
	}
	for _, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			ts, sqlDB := timeZoneServer(t, tzNow)
			token := registerUser(t, ts.URL, "owner", "")
			for _, s := range c.Setup {
				resp := doRaw(t, http.MethodPut, ts.URL, "/api/me/time-zone", token, string(s.Put))
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("setup status %d", resp.StatusCode)
				}
			}
			if strings.HasPrefix(c.Name, "409") {
				fillTimeZoneHistory(t, sqlDB, 500)
			}
			auth := token
			if c.Request.Token != nil && !*c.Request.Token {
				auth = ""
			}
			var body string
			switch {
			case c.Request.RawBody != nil:
				body = *c.Request.RawBody
			case c.Request.Body != nil:
				body = string(c.Request.Body)
			}
			resp := doRaw(t, c.Request.Method, ts.URL, c.Request.Path, auth, body)
			if resp.StatusCode != c.Status {
				b, _ := io.ReadAll(resp.Body)
				t.Fatalf("status = %d, want %d (%s)", resp.StatusCode, c.Status, b)
			}
			if c.Body == nil {
				return
			}
			if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
				t.Errorf("content type %q", ct)
			}
			var got any
			decodeJSON(t, resp, &got)
			want := resolvePlaceholder(c.Body, tzNow.Format(time.RFC3339))
			if !reflect.DeepEqual(got, want) {
				t.Errorf("body = %v, want %v", got, want)
			}
		})
	}
}

func resolvePlaceholder(v any, now string) any {
	switch x := v.(type) {
	case string:
		if x == "<server now>" {
			return now
		}
	case []any:
		out := make([]any, len(x))
		for i := range x {
			out[i] = resolvePlaceholder(x[i], now)
		}
		return out
	case map[string]any:
		out := map[string]any{}
		for k, e := range x {
			out[k] = resolvePlaceholder(e, now)
		}
		return out
	}
	return v
}

func fillTimeZoneHistory(t *testing.T, sqlDB *sql.DB, n int) {
	t.Helper()
	var uid int64
	if err := sqlDB.QueryRow(`SELECT id FROM users LIMIT 1`).Scan(&uid); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`DELETE FROM user_time_zones`); err != nil {
		t.Fatal(err)
	}
	zones := []string{"Asia/Tokyo", "Europe/Berlin"}
	for i := 0; i < n; i++ {
		var from any
		if i > 0 {
			from = tzNow.Add(-24 * time.Hour * 400).Add(time.Duration(i) * time.Minute).Format("2006-01-02T15:04:05Z")
		}
		if _, err := sqlDB.Exec(`INSERT INTO user_time_zones (user_id, seq, zone, effective_from, created_at) VALUES (?, ?, ?, ?, 'x')`,
			uid, i, zones[i%2], from); err != nil {
			t.Fatal(err)
		}
	}
}

func TestTimeZoneRequiresAuthAndIsolatesUsers(t *testing.T) {
	ts, _ := timeZoneServer(t, tzNow)
	admin := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", admin)

	for _, m := range []string{http.MethodGet, http.MethodPut} {
		if resp := doRaw(t, m, ts.URL, "/api/me/time-zone", "", `{"zone":"UTC"}`); resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s without token: %d", m, resp.StatusCode)
		}
		if resp := doRaw(t, m, ts.URL, "/api/me/time-zone", "not-a-token", `{"zone":"UTC"}`); resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s with a bad token: %d", m, resp.StatusCode)
		}
	}
	doRaw(t, http.MethodPut, ts.URL, "/api/me/time-zone", admin, `{"zone":"Asia/Tokyo"}`)

	var got struct {
		Zone    *string `json:"zone"`
		History []any   `json:"history"`
	}
	decodeJSON(t, doRaw(t, http.MethodGet, ts.URL, "/api/me/time-zone", bob, ""), &got)
	if got.Zone != nil || len(got.History) != 0 {
		t.Errorf("bob sees %+v", got)
	}
	doRaw(t, http.MethodPut, ts.URL, "/api/me/time-zone", bob, `{"zone":"Europe/Berlin"}`)
	got.Zone, got.History = nil, nil
	decodeJSON(t, doRaw(t, http.MethodGet, ts.URL, "/api/me/time-zone", admin, ""), &got)
	if got.Zone == nil || *got.Zone != "Asia/Tokyo" || len(got.History) != 1 {
		t.Errorf("alice sees %+v", got)
	}
}

func TestTimeZoneRejectsUnknownKeysAndTrailingData(t *testing.T) {
	ts, _ := timeZoneServer(t, tzNow)
	tok := registerUser(t, ts.URL, "alice", "")
	for _, body := range []string{`{"zone":"UTC","extra":1}`, `{"zone":"UTC"} {}`, `{"zone":5}`, `[]`, ``} {
		resp := doRaw(t, http.MethodPut, ts.URL, "/api/me/time-zone", tok, body)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%q: status %d", body, resp.StatusCode)
		}
	}
}

// A submitted zone name is neither echoed in error bodies nor written to the log.
func TestTimeZoneNotEchoedOrLogged(t *testing.T) {
	var logs bytes.Buffer
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	ts, _ := timeZoneServer(t, tzNow)
	tok := registerUser(t, ts.URL, "alice", "")
	resp := doRaw(t, http.MethodPut, ts.URL, "/api/me/time-zone", tok, `{"zone":"Secret/Place"}`)
	b, _ := io.ReadAll(resp.Body)
	if strings.Contains(string(b), "Secret") {
		t.Errorf("echoed: %s", b)
	}
	doRaw(t, http.MethodPut, ts.URL, "/api/me/time-zone", tok, `{"zone":"Asia/Tokyo"}`)
	doRaw(t, http.MethodGet, ts.URL, "/api/me/time-zone", tok, "")
	if out := logs.String(); strings.Contains(out, "Secret") || strings.Contains(out, "Tokyo") {
		t.Errorf("zone names in the log: %q", out)
	}
}
