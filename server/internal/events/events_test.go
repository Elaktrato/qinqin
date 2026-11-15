// Package events_test exercises the study-event store end to end:
// Append/Since over a real SQLite database, the batch push and the
// event list over real HTTP.
package events_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/db"
	"qinqin/internal/events"
	"qinqin/internal/lang"
	"qinqin/internal/model"

	"github.com/oklog/ulid/v2"
)

// eventBody mirrors the JSON an event carries on the wire, both in a
// batch push and in the list response.
type eventBody struct {
	ID          string          `json:"id"`
	UserID      int64           `json:"userId"`
	WorkspaceID int64           `json:"workspaceId"`
	Device      string          `json:"device"`
	TS          string          `json:"ts"`
	Type        string          `json:"type"`
	Payload     json.RawMessage `json:"payload"`
}

// batchResult mirrors the response of POST /api/events/batch.
type batchResult struct {
	Accepted   int `json:"accepted"`
	Duplicates int `json:"duplicates"`
}

// newDB opens a fresh migrated database.
func newDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

// newServer opens a fresh migrated database and serves the API on it.
func newServer(t *testing.T) (*httptest.Server, *sql.DB) {
	t.Helper()
	sqlDB := newDB(t)
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil))
	t.Cleanup(ts.Close)
	return ts, sqlDB
}

// registerFirstUser creates the first user — the instance admin —
// through the API and returns its id and bearer token.
func registerFirstUser(t *testing.T, tsURL, username string) (int64, string) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username, "password": "secret-pass-" + username})
	resp, err := http.Post(tsURL+"/api/auth/register", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("register %s: %v", username, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register %s: status = %d, want %d", username, resp.StatusCode, http.StatusCreated)
	}
	var u model.User
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		t.Fatalf("decode register response: %v", err)
	}
	return u.ID, login(t, tsURL, username)
}

// registerUser creates another user — the first user's admin token
// authorizes it — and returns its id and bearer token.
func registerUser(t *testing.T, tsURL, username, adminToken string) (int64, string) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username, "password": "secret-pass-" + username})
	req, err := http.NewRequest(http.MethodPost, tsURL+"/api/auth/register", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("build register request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+adminToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("register %s: %v", username, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register %s: status = %d, want %d", username, resp.StatusCode, http.StatusCreated)
	}
	var u model.User
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		t.Fatalf("decode register response: %v", err)
	}
	return u.ID, login(t, tsURL, username)
}

// login returns a fresh bearer token for username.
func login(t *testing.T, tsURL, username string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username, "password": "secret-pass-" + username})
	resp, err := http.Post(tsURL+"/api/auth/login", "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("login %s: %v", username, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login %s: status = %d, want %d", username, resp.StatusCode, http.StatusOK)
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode login response: %v", err)
	}
	return out.Token
}

// doJSON performs a JSON request with the given bearer token ("" for
// none) and returns the undecoded response.
func doJSON(t *testing.T, method, tsURL, path, token string, body any) *http.Response {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, tsURL+path, rdr)
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

// decodeJSON decodes resp into v, failing the test on error.
func decodeJSON(t *testing.T, resp *http.Response, v any) {
	t.Helper()
	if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
		t.Fatalf("decode response: %v", err)
	}
}

// createWorkspace opens the caller's workspace for language and
// returns its id.
func createWorkspace(t *testing.T, tsURL, token, language string) int64 {
	t.Helper()
	resp := doJSON(t, http.MethodPost, tsURL, "/api/workspaces", token, map[string]string{"language": language})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST %s workspace: status = %d, want %d", language, resp.StatusCode, http.StatusCreated)
	}
	var ws struct {
		ID int64 `json:"id"`
	}
	decodeJSON(t, resp, &ws)
	if ws.ID == 0 {
		t.Fatalf("created %s workspace has no id", language)
	}
	return ws.ID
}

// newEventID returns a fresh client-generated ULID, the id scheme the
// offline client stamps on every event.
func newEventID(t *testing.T) string {
	t.Helper()
	return ulid.Make().String()
}

// eventRows counts the study_events table.
func eventRows(t *testing.T, sqlDB *sql.DB) int {
	t.Helper()
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM study_events`).Scan(&n); err != nil {
		t.Fatalf("count study_events: %v", err)
	}
	return n
}

func TestEventAppendAndSince(t *testing.T) {
	// zh registers as a code pack, exactly as main.go does for the server.
	lang.Register(lang.Zh{})

	ts, sqlDB := newServer(t)
	aliceID, alice := registerFirstUser(t, ts.URL, "alice")
	bobID, bob := registerUser(t, ts.URL, "bob", alice)
	zhWS := createWorkspace(t, ts.URL, alice, "zh")
	esWS := createWorkspace(t, ts.URL, alice, "es")
	bobWS := createWorkspace(t, ts.URL, bob, "zh")

	// Store level: Append writes a batch, Since reads it back.
	day1 := time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)
	day2 := time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)
	day3 := time.Date(2026, 11, 3, 9, 0, 0, 0, time.UTC)
	batch := []model.StudyEvent{
		{ID: newEventID(t), UserID: aliceID, WorkspaceID: zhWS, Device: "phone", TS: day1, Type: "review", Payload: json.RawMessage(`{"card":"一"}`)},
		{ID: newEventID(t), UserID: aliceID, WorkspaceID: zhWS, Device: "phone", TS: day2, Type: "lookup"},
		{ID: newEventID(t), UserID: aliceID, WorkspaceID: esWS, Device: "web", TS: day3, Type: "review", Payload: json.RawMessage(`{"card":"hola"}`)},
	}
	accepted, duplicates, err := events.Append(context.Background(), sqlDB, batch)
	if err != nil {
		t.Fatalf("Append: %v", err)
	}
	if accepted != 3 || duplicates != 0 {
		t.Errorf("Append = accepted %d, duplicates %d, want 3, 0", accepted, duplicates)
	}

	// The same batch again is all duplicates, never an error.
	accepted, duplicates, err = events.Append(context.Background(), sqlDB, batch)
	if err != nil {
		t.Fatalf("Append retry: %v", err)
	}
	if accepted != 0 || duplicates != 3 {
		t.Errorf("Append retry = accepted %d, duplicates %d, want 0, 3", accepted, duplicates)
	}

	// Since without a workspace spans all the user's workspaces, in ts
	// order, round-tripping every field.
	got, err := events.Since(context.Background(), sqlDB, aliceID, time.Time{}, nil)
	if err != nil {
		t.Fatalf("Since all: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("Since all = %d events, want 3", len(got))
	}
	for i, want := range batch {
		if got[i].ID != want.ID || got[i].UserID != want.UserID || got[i].WorkspaceID != want.WorkspaceID ||
			got[i].Device != want.Device || got[i].Type != want.Type || !got[i].TS.Equal(want.TS) {
			t.Errorf("Since all[%d] = %+v, want %+v", i, got[i], want)
		}
	}
	if string(got[0].Payload) != `{"card":"一"}` || string(got[2].Payload) != `{"card":"hola"}` {
		t.Errorf("Since payloads = %q, %q, want the stored JSON", got[0].Payload, got[2].Payload)
	}
	if string(got[1].Payload) != "null" {
		t.Errorf("payload of the payload-less event = %q, want null", got[1].Payload)
	}

	// since is inclusive: from day2 onward.
	got, err = events.Since(context.Background(), sqlDB, aliceID, day2, nil)
	if err != nil {
		t.Fatalf("Since day2: %v", err)
	}
	if len(got) != 2 || got[0].ID != batch[1].ID || got[1].ID != batch[2].ID {
		t.Errorf("Since day2 = %v, want the day2 and day3 events", idsOf(got))
	}

	// A workspace filter narrows to that workspace.
	got, err = events.Since(context.Background(), sqlDB, aliceID, time.Time{}, &zhWS)
	if err != nil {
		t.Fatalf("Since zh: %v", err)
	}
	if len(got) != 2 || got[0].ID != batch[0].ID || got[1].ID != batch[1].ID {
		t.Errorf("Since zh = %v, want the two zh events", idsOf(got))
	}
	got, err = events.Since(context.Background(), sqlDB, aliceID, day2, &zhWS)
	if err != nil {
		t.Fatalf("Since zh day2: %v", err)
	}
	if len(got) != 1 || got[0].ID != batch[1].ID {
		t.Errorf("Since zh day2 = %v, want the day2 zh event", idsOf(got))
	}
	got, err = events.Since(context.Background(), sqlDB, aliceID, time.Time{}, &esWS)
	if err != nil {
		t.Fatalf("Since es: %v", err)
	}
	if len(got) != 1 || got[0].ID != batch[2].ID {
		t.Errorf("Since es = %v, want the es event", idsOf(got))
	}

	// Another user's Since sees nothing of alice's.
	got, err = events.Since(context.Background(), sqlDB, bobID, time.Time{}, nil)
	if err != nil {
		t.Fatalf("Since bob: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("Since bob = %v, want no events", idsOf(got))
	}

	// A client TS in another offset stores as UTC.
	day4 := time.Date(2026, 11, 4, 17, 0, 0, 0, time.FixedZone("+08", 8*3600))
	late := model.StudyEvent{ID: newEventID(t), UserID: aliceID, WorkspaceID: zhWS, Device: "web", TS: day4, Type: "review"}
	if _, _, err := events.Append(context.Background(), sqlDB, []model.StudyEvent{late}); err != nil {
		t.Fatalf("Append offset-ts event: %v", err)
	}
	got, err = events.Since(context.Background(), sqlDB, aliceID, day3, &zhWS)
	if err != nil {
		t.Fatalf("Since zh day3: %v", err)
	}
	if len(got) != 1 || got[0].ID != late.ID || !got[0].TS.Equal(time.Date(2026, 11, 4, 9, 0, 0, 0, time.UTC)) {
		t.Errorf("offset-ts event = %+v, want 2026-11-04T09:00:00Z", got)
	}

	// Route level: GET /api/events requires auth.
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/events", "", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("GET without token: status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}

	// The list returns the caller's events with the same filters.
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/events", alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET events: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var list []eventBody
	decodeJSON(t, resp, &list)
	if len(list) != 4 {
		t.Fatalf("GET events = %d events, want 4", len(list))
	}
	if list[0].ID != batch[0].ID || list[0].UserID != aliceID || list[0].WorkspaceID != zhWS ||
		list[0].Device != "phone" || list[0].Type != "review" || list[0].TS != "2026-11-01T09:00:00Z" ||
		string(list[0].Payload) != `{"card":"一"}` {
		t.Errorf("GET events[0] = %+v, want the first appended event on the wire", list[0])
	}

	q := url.Values{"since": {day2.Format(time.RFC3339)}}
	resp = doJSON(t, http.MethodGet, ts.URL, "/api/events?"+q.Encode(), alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET events since day2: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	decodeJSON(t, resp, &list)
	if len(list) != 3 || list[0].ID != batch[1].ID || list[2].ID != late.ID {
		t.Errorf("GET events since day2 = %v, want the day2, day3, and day4 events", idsOfBodies(list))
	}

	q = url.Values{"workspace": {strconv.FormatInt(esWS, 10)}}
	resp = doJSON(t, http.MethodGet, ts.URL, "/api/events?"+q.Encode(), alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET es events: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	decodeJSON(t, resp, &list)
	if len(list) != 1 || list[0].ID != batch[2].ID {
		t.Errorf("GET es events = %v, want the es event", idsOfBodies(list))
	}

	q = url.Values{"since": {day3.Format(time.RFC3339)}, "workspace": {strconv.FormatInt(zhWS, 10)}}
	resp = doJSON(t, http.MethodGet, ts.URL, "/api/events?"+q.Encode(), alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET zh events since day3: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	decodeJSON(t, resp, &list)
	if len(list) != 1 || list[0].ID != late.ID {
		t.Errorf("GET zh events since day3 = %v, want the day4 zh event", idsOfBodies(list))
	}

	// Unknown and foreign workspaces are invisible: both are 404.
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/events?workspace=999999", alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("GET unknown workspace: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	q = url.Values{"workspace": {strconv.FormatInt(bobWS, 10)}}
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/events?"+q.Encode(), alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("GET foreign workspace: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}

	// Malformed filters are bad requests.
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/events?since=not-a-time", alice, nil); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("GET malformed since: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
	if resp := doJSON(t, http.MethodGet, ts.URL, "/api/events?workspace=NaN", alice, nil); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("GET malformed workspace: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}

	// Bob's list holds only his own events: none so far.
	resp = doJSON(t, http.MethodGet, ts.URL, "/api/events", bob, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET bob's events: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	decodeJSON(t, resp, &list)
	if len(list) != 0 {
		t.Errorf("GET bob's events = %v, want empty", idsOfBodies(list))
	}
}

func TestEventBatchIdempotent(t *testing.T) {
	// zh registers as a code pack, exactly as main.go does for the server.
	lang.Register(lang.Zh{})

	ts, sqlDB := newServer(t)
	aliceID, alice := registerFirstUser(t, ts.URL, "alice")
	_, bob := registerUser(t, ts.URL, "bob", alice)
	zhWS := createWorkspace(t, ts.URL, alice, "zh")
	esWS := createWorkspace(t, ts.URL, alice, "es")

	day1 := time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)
	day2 := time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)

	// The batch an offline client recorded: client-generated ULID ids,
	// client timestamps, and one bogus user id the server must ignore.
	batch := []model.StudyEvent{
		{ID: newEventID(t), UserID: 999, WorkspaceID: zhWS, Device: "phone", TS: day1, Type: "review", Payload: json.RawMessage(`{"card":"一","correct":true}`)},
		{ID: newEventID(t), WorkspaceID: esWS, Device: "phone", TS: day2, Type: "review", Payload: json.RawMessage(`{"card":"hola","correct":false}`)},
	}
	post := func(evs any) *http.Response {
		return doJSON(t, http.MethodPost, ts.URL, "/api/events/batch", alice, map[string]any{"events": evs})
	}

	resp := post(batch)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST batch: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var out batchResult
	decodeJSON(t, resp, &out)
	if out.Accepted != 2 || out.Duplicates != 0 {
		t.Errorf("POST batch = accepted %d, duplicates %d, want 2, 0", out.Accepted, out.Duplicates)
	}

	// The same batch retried after a flaky connection: duplicates, not
	// errors, and still only two rows (Review Focus #3).
	resp = post(batch)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST retry: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	decodeJSON(t, resp, &out)
	if out.Accepted != 0 || out.Duplicates != 2 {
		t.Errorf("POST retry = accepted %d, duplicates %d, want 0, 2", out.Accepted, out.Duplicates)
	}
	if rows := eventRows(t, sqlDB); rows != 2 {
		t.Errorf("study_events rows after retry = %d, want 2", rows)
	}

	// A partial retry: the known id counts duplicate, the new one is
	// accepted.
	partial := []model.StudyEvent{
		batch[0],
		{ID: newEventID(t), WorkspaceID: zhWS, Device: "phone", TS: day2, Type: "review", Payload: json.RawMessage(`{"card":"二","correct":true}`)},
	}
	resp = post(partial)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST partial retry: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	decodeJSON(t, resp, &out)
	if out.Accepted != 1 || out.Duplicates != 1 {
		t.Errorf("POST partial retry = accepted %d, duplicates %d, want 1, 1", out.Accepted, out.Duplicates)
	}
	if rows := eventRows(t, sqlDB); rows != 3 {
		t.Errorf("study_events rows after partial retry = %d, want 3", rows)
	}

	// Every stored row belongs to the caller, whatever the body claimed.
	var foreign int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM study_events WHERE user_id != ?`, aliceID).Scan(&foreign); err != nil {
		t.Fatalf("count foreign-owned rows: %v", err)
	}
	if foreign != 0 {
		t.Errorf("rows with a foreign user_id = %d, want 0 (user forced from token)", foreign)
	}

	// The stored events serve back with their client timestamps and
	// payloads intact.
	q := url.Values{"workspace": {strconv.FormatInt(zhWS, 10)}}
	resp = doJSON(t, http.MethodGet, ts.URL, "/api/events?"+q.Encode(), alice, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET zh events: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var list []eventBody
	decodeJSON(t, resp, &list)
	if len(list) != 2 || list[0].ID != batch[0].ID || list[1].ID != partial[1].ID {
		t.Fatalf("GET zh events = %v, want the two pushed zh events", idsOfBodies(list))
	}
	if list[0].UserID != aliceID || list[0].TS != "2026-11-01T09:00:00Z" ||
		string(list[0].Payload) != `{"card":"一","correct":true}` {
		t.Errorf("GET zh events[0] = %+v, want the pushed event on the wire", list[0])
	}

	// Empty batches are accepted no-ops.
	resp = post([]model.StudyEvent{})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST empty batch: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	decodeJSON(t, resp, &out)
	if out.Accepted != 0 || out.Duplicates != 0 {
		t.Errorf("POST empty batch = accepted %d, duplicates %d, want 0, 0", out.Accepted, out.Duplicates)
	}

	// The batch route requires auth and writes nothing without it.
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/events/batch", "", map[string]any{"events": batch}); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("POST without token: status = %d, want %d", resp.StatusCode, http.StatusUnauthorized)
	}
	if rows := eventRows(t, sqlDB); rows != 3 {
		t.Errorf("study_events rows after unauthenticated post = %d, want 3", rows)
	}

	// Unknown and foreign workspaces are 404; nothing is written.
	unknown := []model.StudyEvent{{ID: newEventID(t), WorkspaceID: 999999, Device: "phone", TS: day1, Type: "review"}}
	if resp := post(unknown); resp.StatusCode != http.StatusNotFound {
		t.Errorf("POST unknown workspace: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	bobWS := createWorkspace(t, ts.URL, bob, "zh")
	foreignWS := []model.StudyEvent{{ID: newEventID(t), WorkspaceID: bobWS, Device: "phone", TS: day1, Type: "review"}}
	if resp := post(foreignWS); resp.StatusCode != http.StatusNotFound {
		t.Errorf("POST foreign workspace: status = %d, want %d", resp.StatusCode, http.StatusNotFound)
	}
	if rows := eventRows(t, sqlDB); rows != 3 {
		t.Errorf("study_events rows after 404 batches = %d, want 3", rows)
	}

	// Malformed batches are rejected without writing.
	for _, body := range []any{
		"not-an-object",
		map[string]any{},              // no events key
		map[string]any{"events": nil}, // explicit null
		map[string]any{"events": []model.StudyEvent{ // no id
			{WorkspaceID: zhWS, Device: "phone", TS: day1, Type: "review"},
		}},
		map[string]any{"events": []model.StudyEvent{ // no ts
			{ID: newEventID(t), WorkspaceID: zhWS, Device: "phone", Type: "review"},
		}},
	} {
		if resp := doJSON(t, http.MethodPost, ts.URL, "/api/events/batch", alice, body); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("POST malformed batch %#v: status = %d, want %d", body, resp.StatusCode, http.StatusBadRequest)
		}
	}
	if rows := eventRows(t, sqlDB); rows != 3 {
		t.Errorf("study_events rows after malformed batches = %d, want 3", rows)
	}
}

// idsOf returns the ids of the events, for failure messages.
func idsOf(evs []model.StudyEvent) []string {
	ids := make([]string, len(evs))
	for i, ev := range evs {
		ids[i] = ev.ID
	}
	return ids
}

// idsOfBodies returns the ids of wire-format events, for failure
// messages.
func idsOfBodies(evs []eventBody) []string {
	ids := make([]string, len(evs))
	for i, ev := range evs {
		ids[i] = ev.ID
	}
	return ids
}

// TestEventBatchWorkspaceRequiredAndInBatchDuplicates pins two edges: an
// event without a workspaceId is a validation error (400, not a
// "workspace not found" 404), and one id repeated inside a single batch
// counts once as accepted and once as a duplicate.
func TestEventBatchWorkspaceRequiredAndInBatchDuplicates(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	_, alice := registerFirstUser(t, ts.URL, "alice")
	zhWS := createWorkspace(t, ts.URL, alice, "zh")
	ts0 := time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC).Format(time.RFC3339)

	missing := map[string]any{"events": []map[string]any{
		{"id": newEventID(t), "device": "phone", "ts": ts0, "type": "review"},
	}}
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/events/batch", alice, missing); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("POST without workspaceId: status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
	if rows := eventRows(t, sqlDB); rows != 0 {
		t.Errorf("study_events rows after rejected batch = %d, want 0", rows)
	}

	id := newEventID(t)
	ev := map[string]any{"id": id, "workspaceId": zhWS, "device": "phone", "ts": ts0, "type": "review"}
	resp := doJSON(t, http.MethodPost, ts.URL, "/api/events/batch", alice, map[string]any{"events": []map[string]any{ev, ev}})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST batch with repeated id: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var out batchResult
	decodeJSON(t, resp, &out)
	if out.Accepted != 1 || out.Duplicates != 1 {
		t.Errorf("batch with repeated id = accepted %d, duplicates %d, want 1, 1", out.Accepted, out.Duplicates)
	}
	if rows := eventRows(t, sqlDB); rows != 1 {
		t.Errorf("study_events rows = %d, want 1", rows)
	}
}
