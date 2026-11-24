// Package sync_test exercises delta sync over a real SQLite database:
// the paged pull and the push (idempotent events, last-write-wins plugin
// data and typed rows), through the library and over real HTTP.
package sync_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/auth"
	"qinqin/internal/dbtest"
	"qinqin/internal/keyed"
	"qinqin/internal/lang"
	"qinqin/internal/model"
	"qinqin/internal/study/rows"
	chinsync "qinqin/internal/sync"
)

func init() {
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
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

// delta is what the push tests read back: one full paged round (sync.PullPage)
// of the caller's keyed rows and typed study rows.
type delta struct {
	Rows         []model.KeyedRow       `json:"rows"`
	Cards        []rows.Card            `json:"cards"`
	Decks        []rows.Deck            `json:"decks"`
	DeckSettings []rows.DeckSettingsRow `json:"deckSettings"`
	Limits       []rows.LimitsRow       `json:"limits"`
	FsrsSets     []rows.FsrsSet         `json:"fsrsSets"`
	FsrsActive   []rows.FsrsActiveRow   `json:"fsrsActive"`
}

// pullDelta pulls a full paged round of userID: live rows only, or
// tombstones too when withTombstones; only limits the collections (nil:
// all). The round's clock runs a minute ahead, so rows written this second
// are in it.
func pullDelta(ctx context.Context, sqlDB *sql.DB, userID int64, withTombstones bool, only map[string]bool) (delta, error) {
	d := delta{}
	req := chinsync.PageRequest{Only: only, Tombstones: withTombstones, Now: time.Now().Add(time.Minute)}
	for {
		page, err := chinsync.PullPage(ctx, sqlDB, userID, req, nil)
		if err != nil {
			return delta{}, err
		}
		for name, raw := range page.Collections {
			switch name {
			case "rows":
				err = appendTo(&d.Rows, raw)
			case "cards":
				err = appendTo(&d.Cards, raw)
			case "decks":
				err = appendTo(&d.Decks, raw)
			case "deckSettings":
				err = appendTo(&d.DeckSettings, raw)
			case "limits":
				err = appendTo(&d.Limits, raw)
			case "fsrsSets":
				err = appendTo(&d.FsrsSets, raw)
			case "fsrsActive":
				err = appendTo(&d.FsrsActive, raw)
			}
			if err != nil {
				return delta{}, fmt.Errorf("%s: %w", name, err)
			}
		}
		if !page.More || page.Next == nil {
			return d, nil
		}
		req = chinsync.PageRequest{Page: *page.Next, Now: req.Now}
	}
}

// appendTo decodes a JSON array and appends it to list.
func appendTo[T any](list *[]T, raw json.RawMessage) error {
	var page []T
	if err := json.Unmarshal(raw, &page); err != nil {
		return err
	}
	*list = append(*list, page...)
	return nil
}

func mustPull(t *testing.T, sqlDB *sql.DB, userID int64) delta {
	t.Helper()
	d, err := pullDelta(context.Background(), sqlDB, userID, false, nil)
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	return d
}

func TestPushEventsAndLWW(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	ws := newWorkspace(t, sqlDB, alice)
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

	// Keyed rows: seed the server row, then push older and newer copies.
	if _, err := keyed.Put(ctx, sqlDB, alice, nil, "home-layout", json.RawMessage(`{"v":"server"}`), nil); err != nil {
		t.Fatalf("seed data: %v", err)
	}
	serverTime := time.Now().UTC()
	row := func(val string, at time.Time) model.KeyedRow {
		return model.KeyedRow{Key: "home-layout", Data: json.RawMessage(val), UpdatedAt: at}
	}

	res, err = chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{Rows: []model.KeyedRow{row(`{"v":"stale"}`, serverTime.Add(-time.Hour))}})
	if err != nil || res.DataSkipped != 1 || res.DataAccepted != 0 {
		t.Fatalf("older push = %+v, %v; want skipped", res, err)
	}
	got, err := keyed.Get(ctx, sqlDB, alice, nil, "home-layout")
	if err != nil || string(got.Data) != `{"v":"server"}` || got.Version != 1 {
		t.Fatalf("after stale push = %+v, %v; want untouched server row v1", got, err)
	}

	res, err = chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{Rows: []model.KeyedRow{row(`{"v":"fresh"}`, serverTime.Add(time.Hour))}})
	if err != nil || res.DataAccepted != 1 || res.DataSkipped != 0 {
		t.Fatalf("newer push = %+v, %v; want accepted", res, err)
	}
	got, err = keyed.Get(ctx, sqlDB, alice, nil, "home-layout")
	if err != nil || string(got.Data) != `{"v":"fresh"}` || got.Version != 2 {
		t.Fatalf("after fresh push = %+v, %v; want fresh data at version 2", got, err)
	}

	// A newer incoming tombstone deletes the row.
	tomb := row(`null`, serverTime.Add(2*time.Hour))
	deleted := tomb.UpdatedAt
	tomb.DeletedAt = &deleted
	res, err = chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{Rows: []model.KeyedRow{tomb}})
	if err != nil || res.DataAccepted != 1 {
		t.Fatalf("tombstone push = %+v, %v; want accepted", res, err)
	}
	if _, err := keyed.Get(ctx, sqlDB, alice, nil, "home-layout"); !errors.Is(err, keyed.ErrNotFound) {
		t.Errorf("after tombstone push Get err = %v, want ErrNotFound", err)
	}
	_ = ws
}

func TestPushRejectsForeignWorkspace(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice, bob := newUser(t, sqlDB, "alice"), newUser(t, sqlDB, "bob")
	bobWS := newWorkspace(t, sqlDB, bob)

	_, err := chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{Events: []model.StudyEvent{
		{ID: "01J00000000000000000000009", WorkspaceID: bobWS, TS: time.Now().UTC(), Type: "review", Payload: json.RawMessage(`{}`)}}})
	if !errors.Is(err, chinsync.ErrNotFound) {
		t.Errorf("foreign workspace event err = %v, want ErrNotFound", err)
	}
	_, err = chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{Rows: []model.KeyedRow{
		{WorkspaceID: &bobWS, Key: "notecfg", Data: json.RawMessage(`1`), UpdatedAt: time.Now().UTC()}}})
	if !errors.Is(err, chinsync.ErrNotFound) {
		t.Errorf("foreign workspace data err = %v, want ErrNotFound", err)
	}
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM study_events`).Scan(&n); err != nil || n != 0 {
		t.Errorf("rejected pushes stored %d events, %v; want 0", n, err)
	}
}

func TestSyncEndpoints(t *testing.T) {
	sqlDB := dbtest.Open(t)
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

	token := registerAndLogin(t, sqlDB, ts.URL)
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

	resp = call(http.MethodPost, "/api/sync/push", map[string]any{"events": []any{
		map[string]any{"id": "01J00000000000000000000077", "workspaceId": 424242, "ts": time.Now().UTC().Format(time.RFC3339), "type": "review", "payload": map[string]any{}}}})
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("push to foreign workspace status = %d, want 404", resp.StatusCode)
	}

	resp = call(http.MethodPost, "/api/sync/push", map[string]any{"events": []any{}, "rows": []any{}})
	var res chinsync.PushResult
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&res) != nil {
		t.Errorf("empty push status = %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()
}

// registerAndLogin creates the first (admin) user in the database, as
// `qinqin adduser --admin` does (no registration makes an admin, #211), and
// returns its bearer token.
func registerAndLogin(t *testing.T, sqlDB *sql.DB, tsURL string) string {
	t.Helper()
	if _, err := auth.CreateUser(context.Background(), sqlDB, "owner", "secret-pass-owner", true); err != nil {
		t.Fatalf("create admin: %v", err)
	}
	creds, _ := json.Marshal(map[string]string{"username": "owner", "password": "secret-pass-owner"})
	resp, err := http.Post(tsURL+"/api/auth/login", "application/json", bytes.NewReader(creds))
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

// TestPushRefusesKeysNoFamilyAccepts: a row of an unknown key, or of a key
// in the wrong scope, is refused on its own; the events and the other rows
// of the push land.
func TestPushRefusesKeysNoFamilyAccepts(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	ws := newWorkspace(t, sqlDB, alice)
	at := time.Now().UTC().Add(-time.Minute)
	evt := func(id, typ string) model.StudyEvent {
		return model.StudyEvent{ID: id, WorkspaceID: ws, Device: "phone", TS: time.Now().UTC(), Type: typ, Payload: json.RawMessage(`{}`)}
	}
	res, err := chinsync.Push(ctx, sqlDB, alice, chinsync.PushBody{
		Events: []model.StudyEvent{evt("01J00000000000000000000011", "review"), evt("01J00000000000000000000012", "read")},
		Rows: []model.KeyedRow{
			{Key: "x", Data: json.RawMessage(`1`), UpdatedAt: at},
			{Key: "note:1", Data: json.RawMessage(`1`), UpdatedAt: at},                           // a workspace row without one
			{Key: "card:c-vocab-1", WorkspaceID: &ws, Data: json.RawMessage(`1`), UpdatedAt: at}, // a typed family
			{Key: "known:5", WorkspaceID: &ws, Data: json.RawMessage(`2`), UpdatedAt: at},
		},
	})
	if err != nil || res.EventsAccepted != 2 || res.DataAccepted != 1 || res.DataRefused != 3 {
		t.Fatalf("push = %+v, %v; want 2 events, 1 accepted, 3 refused", res, err)
	}
	if list, err := keyed.List(ctx, sqlDB, alice, &ws, ""); err != nil || len(list) != 1 || list[0].Key != "known:5" {
		t.Errorf("stored rows %+v (%v), want known:5 only", list, err)
	}
}

// An event without a workspace (0) is invalid, as in POST /api/events/batch.
func TestPushRejectsEventWithoutWorkspace(t *testing.T) {
	sqlDB := dbtest.Open(t)
	alice := newUser(t, sqlDB, "alice")
	_, err := chinsync.Push(context.Background(), sqlDB, alice, chinsync.PushBody{Events: []model.StudyEvent{
		{ID: "01J00000000000000000000008", TS: time.Now().UTC(), Type: "review", Payload: json.RawMessage(`{}`)}}})
	if !errors.Is(err, chinsync.ErrInvalid) {
		t.Errorf("event without workspace err = %v, want ErrInvalid", err)
	}
}
