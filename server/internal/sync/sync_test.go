// Package sync_test exercises delta sync over a real SQLite database:
// the pull (every row changed since a cursor, tombstones included) and
// the push (idempotent events, last-write-wins plugin data), through the
// library and over real HTTP.
package sync_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/auth"
	"qinqin/internal/db"
	"qinqin/internal/lang"
	"qinqin/internal/model"
	"qinqin/internal/plugins"
	chinsync "qinqin/internal/sync"
)

func init() {
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
}

// validManifest is a feature manifest that passes plugins.ParseManifest:
// sdk 1, owns-data, no surfaces or events. extra is a list of JSON members
// appended last, so a repeated key overrides the default.
func validManifest(id, extra string) string {
	if extra != "" {
		extra = "," + extra
	}
	return `{"id":"` + id + `","name":"X","version":"1.0","type":"feature","sdk":1,"surfaces":[],"permissions":["owns-data"],"hooks":[],"events":[]` + extra + `}`
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

// newUser creates a user and returns its id.
func newUser(t *testing.T, sqlDB *sql.DB, username string) int64 {
	t.Helper()
	u, err := auth.CreateUser(context.Background(), sqlDB, username, "secret-pass-"+username, false)
	if err != nil {
		t.Fatalf("create user %s: %v", username, err)
	}
	return u.ID
}

// newWorkspace creates a zh workspace for the user and returns its id.
func newWorkspace(t *testing.T, sqlDB *sql.DB, userID int64) int64 {
	t.Helper()
	res, err := sqlDB.Exec(`
		INSERT INTO workspaces (user_id, language, settings, updated_at)
		VALUES (?, 'zh', '{}', ?)`, userID, time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		t.Fatalf("create workspace: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

func mustPull(t *testing.T, sqlDB *sql.DB, userID int64, cursor time.Time) chinsync.Delta {
	t.Helper()
	d, err := chinsync.Pull(context.Background(), sqlDB, userID, cursor, nil)
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	return d
}

func TestPushEventsAndLWW(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	ws := newWorkspace(t, sqlDB, alice)
	if err := plugins.Register(ctx, sqlDB, []byte(validManifest("flashcards", ""))); err != nil {
		t.Fatalf("register plugin: %v", err)
	}

	evt := func(id string) model.StudyEvent {
		return model.StudyEvent{ID: id, UserID: 999, WorkspaceID: ws, Device: "phone",
			TS: time.Now().UTC(), Type: "review", Payload: json.RawMessage(`{}`)}
	}
	body := chinsync.PushBody{Events: []model.StudyEvent{evt("01J00000000000000000000001"), evt("01J00000000000000000000002")}}

	res, err := chinsync.Push(ctx, sqlDB, alice, body)
	if err != nil || res.EventsAccepted != 2 || res.EventDuplicates != 0 {
		t.Fatalf("first push = %+v, %v; want 2 accepted", res, err)
	}
	res, err = chinsync.Push(ctx, sqlDB, alice, body)
	if err != nil || res.EventsAccepted != 0 || res.EventDuplicates != 2 {
		t.Fatalf("retry push = %+v, %v; want 2 duplicates", res, err)
	}
	var owner int64
	if err := sqlDB.QueryRow(`SELECT user_id FROM study_events WHERE id = ?`, "01J00000000000000000000001").Scan(&owner); err != nil || owner != alice {
		t.Errorf("event owner = %d, %v; want the caller %d (body claimed 999)", owner, err, alice)
	}

	// Plugin data: seed the server row, then push older and newer copies.
	if _, err := plugins.PutData(ctx, sqlDB, alice, nil, "flashcards", "deck", json.RawMessage(`{"v":"server"}`)); err != nil {
		t.Fatalf("seed data: %v", err)
	}
	serverTime := time.Now().UTC()
	row := func(val string, at time.Time) model.PluginData {
		return model.PluginData{PluginID: "flashcards", Key: "deck", Data: json.RawMessage(val), UpdatedAt: at}
	}

	res, err = chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{PluginData: []model.PluginData{row(`{"v":"stale"}`, serverTime.Add(-time.Hour))}})
	if err != nil || res.DataSkipped != 1 || res.DataAccepted != 0 {
		t.Fatalf("older push = %+v, %v; want skipped", res, err)
	}
	got, err := plugins.GetData(ctx, sqlDB, alice, nil, "flashcards", "deck")
	if err != nil || string(got.Data) != `{"v":"server"}` || got.Version != 1 {
		t.Fatalf("after stale push = %+v, %v; want untouched server row v1", got, err)
	}

	res, err = chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{PluginData: []model.PluginData{row(`{"v":"fresh"}`, serverTime.Add(time.Hour))}})
	if err != nil || res.DataAccepted != 1 || res.DataSkipped != 0 {
		t.Fatalf("newer push = %+v, %v; want accepted", res, err)
	}
	got, err = plugins.GetData(ctx, sqlDB, alice, nil, "flashcards", "deck")
	if err != nil || string(got.Data) != `{"v":"fresh"}` || got.Version != 2 {
		t.Fatalf("after fresh push = %+v, %v; want fresh data at version 2", got, err)
	}

	// A newer incoming tombstone deletes the row.
	tomb := row(`null`, serverTime.Add(2*time.Hour))
	deleted := tomb.UpdatedAt
	tomb.DeletedAt = &deleted
	res, err = chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{PluginData: []model.PluginData{tomb}})
	if err != nil || res.DataAccepted != 1 {
		t.Fatalf("tombstone push = %+v, %v; want accepted", res, err)
	}
	if _, err := plugins.GetData(ctx, sqlDB, alice, nil, "flashcards", "deck"); !errors.Is(err, plugins.ErrNotFound) {
		t.Errorf("after tombstone push GetData err = %v, want ErrNotFound", err)
	}
}

func TestPushRejectsForeignWorkspaceAndUnknownPlugin(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice, bob := newUser(t, sqlDB, "alice"), newUser(t, sqlDB, "bob")
	bobWS := newWorkspace(t, sqlDB, bob)

	_, err := chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{Events: []model.StudyEvent{
		{ID: "01J00000000000000000000009", WorkspaceID: bobWS, TS: time.Now().UTC(), Type: "review", Payload: json.RawMessage(`{}`)}}})
	if !errors.Is(err, chinsync.ErrNotFound) {
		t.Errorf("foreign workspace event err = %v, want ErrNotFound", err)
	}
	_, err = chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{PluginData: []model.PluginData{
		{PluginID: "no-such-plugin", Key: "k", Data: json.RawMessage(`1`), UpdatedAt: time.Now().UTC()}}})
	if !errors.Is(err, chinsync.ErrNotFound) {
		t.Errorf("unknown plugin err = %v, want ErrNotFound", err)
	}
	_, err = chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{PluginData: []model.PluginData{
		{PluginID: "heatmap", WorkspaceID: &bobWS, Key: "k", Data: json.RawMessage(`1`), UpdatedAt: time.Now().UTC()}}})
	if !errors.Is(err, chinsync.ErrNotFound) {
		t.Errorf("foreign workspace data err = %v, want ErrNotFound", err)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM study_events`).Scan(&n); err != nil || n != 0 {
		t.Errorf("rejected pushes stored %d events, %v; want 0", n, err)
	}
}

func TestSyncEndpoints(t *testing.T) {
	sqlDB := newDB(t)
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil))
	t.Cleanup(ts.Close)
	seedWorld(t, sqlDB)

	// Anonymous callers are rejected.
	resp, err := http.Get(ts.URL + "/api/sync/pull")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous pull status = %d, want 401", resp.StatusCode)
	}

	token := registerAndLogin(t, ts.URL)
	call := func(method, path string, body any) *http.Response {
		var r *bytes.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			r = bytes.NewReader(b)
		} else {
			r = bytes.NewReader(nil)
		}
		req, _ := http.NewRequest(method, ts.URL+path, r)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		return resp
	}

	resp = call(http.MethodGet, "/api/sync/pull", nil)
	var delta chinsync.Delta
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&delta) != nil || len(delta.Entries) < 3 {
		t.Fatalf("pull status = %d entries = %d, want 200 with the world", resp.StatusCode, len(delta.Entries))
	}
	resp.Body.Close()

	resp = call(http.MethodGet, "/api/sync/pull?collections=pluginData,pluginStates", nil)
	var subset chinsync.Delta
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&subset) != nil ||
		len(subset.Entries) != 0 || len(subset.Senses) != 0 || len(subset.Sentences) != 0 {
		t.Fatalf("collections pull status = %d entries = %d, want 200 with only the requested collections", resp.StatusCode, len(subset.Entries))
	}
	resp.Body.Close()
	resp = call(http.MethodGet, "/api/sync/pull?collections=entries,bogus", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("unknown collection status = %d, want 400", resp.StatusCode)
	}

	resp = call(http.MethodGet, "/api/sync/pull?cursor=garbage", nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("bad cursor status = %d, want 400", resp.StatusCode)
	}

	resp = call(http.MethodPost, "/api/sync/push", map[string]any{"events": []any{
		map[string]any{"id": "01J00000000000000000000077", "workspaceId": 424242, "ts": time.Now().UTC().Format(time.RFC3339), "type": "review", "payload": map[string]any{}}}})
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("push to foreign workspace status = %d, want 404", resp.StatusCode)
	}

	resp = call(http.MethodPost, "/api/sync/push", map[string]any{"events": []any{}, "pluginData": []any{}})
	var res chinsync.PushResult
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&res) != nil {
		t.Errorf("empty push status = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()
}

// registerAndLogin creates the first (admin) user over HTTP and returns
// its bearer token.
func registerAndLogin(t *testing.T, tsURL string) string {
	t.Helper()
	creds, _ := json.Marshal(map[string]string{"username": "owner", "password": "secret-pass-owner"})
	resp, err := http.Post(tsURL+"/api/auth/register", "application/json", bytes.NewReader(creds))
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register status = %d, want 201", resp.StatusCode)
	}
	resp, err = http.Post(tsURL+"/api/auth/login", "application/json", bytes.NewReader(creds))
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	defer resp.Body.Close()
	var out struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || out.Token == "" {
		t.Fatalf("login body: %v token=%q", err, out.Token)
	}
	return out.Token
}

// TestPushSkipsUndeclaredWriter: a row for a plugin without owns-data is
// refused on its own; the events and the other rows of the push land.
func TestPushSkipsUndeclaredWriter(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	ws := newWorkspace(t, sqlDB, alice)
	for _, i := range []int{1, 2} { // flashcards, reader
		if _, err := plugins.RegisterBuiltin(ctx, sqlDB, plugins.Builtin()[i]); err != nil {
			t.Fatal(err)
		}
	}
	at := time.Now().UTC().Add(-time.Minute)
	evt := func(id, typ string) model.StudyEvent {
		return model.StudyEvent{ID: id, WorkspaceID: ws, Device: "phone", TS: time.Now().UTC(), Type: typ, Payload: json.RawMessage(`{}`)}
	}
	res, err := chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{
		Events: []model.StudyEvent{evt("01J00000000000000000000011", "review"), evt("01J00000000000000000000012", "read")},
		PluginData: []model.PluginData{
			{PluginID: "qinqin-reader", Key: "x", Data: json.RawMessage(`1`), UpdatedAt: at},
			{PluginID: "qinqin-flashcards", Key: "x", Data: json.RawMessage(`2`), UpdatedAt: at},
		},
	})
	if err != nil || res.EventsAccepted != 2 || res.DataAccepted != 1 || res.DataRefused != 1 {
		t.Fatalf("push = %+v, %v; want 2 events, 1 accepted, 1 refused", res, err)
	}
	if _, err := plugins.GetData(ctx, sqlDB, alice, nil, "qinqin-reader", "x"); !errors.Is(err, plugins.ErrNotFound) {
		t.Errorf("refused reader row present: %v", err)
	}
	if _, err := plugins.GetData(ctx, sqlDB, alice, nil, "qinqin-flashcards", "x"); err != nil {
		t.Errorf("flashcards row: %v", err)
	}
}

// TestPushAcceptsBuiltinWriters: every plugin id the web writes under is
// accepted by the built-in manifests.
func TestPushAcceptsBuiltinWriters(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	for _, raw := range plugins.Builtin() {
		if _, err := plugins.RegisterBuiltin(ctx, sqlDB, raw); err != nil {
			t.Fatal(err)
		}
	}
	at := time.Now().UTC().Add(-time.Minute)
	var rows []model.PluginData
	for _, id := range []string{"qinqin-flashcards", "qinqin-journal", "qinqin-core"} {
		rows = append(rows, model.PluginData{PluginID: id, Key: "k", Data: json.RawMessage(`{}`), UpdatedAt: at})
	}
	res, err := chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{PluginData: rows})
	if err != nil || res.DataAccepted != 3 || res.DataRefused != 0 {
		t.Fatalf("push = %+v, %v; want 3 accepted", res, err)
	}
}

// An event without a workspace (0) is invalid, as in POST /api/events/batch.
func TestPushRejectsEventWithoutWorkspace(t *testing.T) {
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	_, err := chinsync.Push(context.Background(), sqlDB, alice, chinsync.PushBody{Events: []model.StudyEvent{
		{ID: "01J00000000000000000000008", TS: time.Now().UTC(), Type: "review", Payload: json.RawMessage(`{}`)}}})
	if !errors.Is(err, chinsync.ErrInvalid) {
		t.Errorf("event without workspace err = %v, want ErrInvalid", err)
	}
}
