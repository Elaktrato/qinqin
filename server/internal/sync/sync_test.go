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
	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/levels"
	"qinqin/internal/model"
	"qinqin/internal/plugins"
	"qinqin/internal/sentences"
	chinsync "qinqin/internal/sync"
)

func init() {
	lang.Register(lang.Zh{})
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
	u, err := auth.CreateUser(context.Background(), sqlDB, username, "pw-"+username, false)
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

// seedWorld imports the shared dictionary and levels fixtures: entries
// 好, 你好, 妳好 with senses, and hsk-mini level memberships.
func seedWorld(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	ctx := context.Background()
	dictPack, err := dict.LoadPack("../dict/testdata/mkgloss")
	if err != nil {
		t.Fatalf("load dictionary fixture: %v", err)
	}
	if _, err := dict.Import(ctx, sqlDB, dictPack); err != nil {
		t.Fatalf("import dictionary fixture: %v", err)
	}
	levelsPack, err := dict.LoadPack("../levels/testdata/hsk-mini")
	if err != nil {
		t.Fatalf("load levels fixture: %v", err)
	}
	if _, err := levels.Import(ctx, sqlDB, levelsPack); err != nil {
		t.Fatalf("import levels fixture: %v", err)
	}
}

// backdate rewrites every synced table's updated_at to long ago, so a
// later pull sees only rows changed after this call regardless of the
// second-truncated clock.
func backdate(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	for _, table := range []string{"entries", "entry_links", "senses", "level_members",
		"sentences", "plugin_data", "plugin_states"} {
		if _, err := sqlDB.Exec(`UPDATE ` + table + ` SET updated_at = '2020-01-01T00:00:00Z'`); err != nil {
			t.Fatalf("backdate %s: %v", table, err)
		}
	}
}

func mustPull(t *testing.T, sqlDB *sql.DB, userID int64, cursor time.Time) chinsync.Delta {
	t.Helper()
	d, err := chinsync.Pull(context.Background(), sqlDB, userID, cursor)
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	return d
}

func TestPullAll(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice, bob := newUser(t, sqlDB, "alice"), newUser(t, sqlDB, "bob")
	seedWorld(t, sqlDB)

	st := entries.Store{DB: sqlDB}
	hao, err := st.GetByWritten(ctx, "好", "character", "zh")
	if err != nil {
		t.Fatalf("get 好: %v", err)
	}
	if _, err := sentences.AddUser(ctx, sqlDB, alice, hao.ID, model.Sentence{Hanzi: "好！", Pinyin: "hǎo", Translation: "Good!"}); err != nil {
		t.Fatalf("alice sentence: %v", err)
	}
	if _, err := sentences.AddUser(ctx, sqlDB, bob, hao.ID, model.Sentence{Hanzi: "很好", Pinyin: "hěn hǎo", Translation: "Very good"}); err != nil {
		t.Fatalf("bob sentence: %v", err)
	}
	if _, err := plugins.PutData(ctx, sqlDB, alice, nil, "heatmap", "settings", json.RawMessage(`{"a":1}`)); err != nil {
		t.Fatalf("alice data: %v", err)
	}
	if _, err := plugins.PutData(ctx, sqlDB, bob, nil, "heatmap", "settings", json.RawMessage(`{"b":2}`)); err != nil {
		t.Fatalf("bob data: %v", err)
	}

	d := mustPull(t, sqlDB, alice, time.Time{})

	if d.Cursor.Before(time.Now().UTC().Add(-5*time.Minute)) || d.Cursor.After(time.Now().UTC()) {
		t.Errorf("cursor = %v, want shortly before server now", d.Cursor)
	}
	if len(d.Entries) < 3 {
		t.Fatalf("entries = %d, want the imported world (好, 你好, 妳好)", len(d.Entries))
	}
	for _, e := range d.Entries {
		if e.Written == "好" && (len(e.Readings) == 0 || e.Language != "zh") {
			t.Errorf("entry 好 shipped without readings/language: %+v", e)
		}
	}
	if len(d.Senses) == 0 || len(d.LevelMembers) == 0 {
		t.Errorf("senses=%d levelMembers=%d, want both populated", len(d.Senses), len(d.LevelMembers))
	}
	if len(d.Sentences) != 1 || d.Sentences[0].Hanzi != "好！" {
		t.Errorf("sentences = %+v, want only alice's own", d.Sentences)
	}
	if len(d.PluginData) != 1 || string(d.PluginData[0].Data) != `{"a":1}` {
		t.Errorf("pluginData = %+v, want only alice's row", d.PluginData)
	}

	// Collections marshal as [] when empty, never null.
	empty := mustPull(t, sqlDB, alice, time.Now().UTC().Add(time.Hour))
	raw, _ := json.Marshal(empty)
	var generic map[string]any
	_ = json.Unmarshal(raw, &generic)
	for _, k := range []string{"entries", "links", "senses", "levelMembers", "sentences", "pluginData", "pluginStates"} {
		if arr, ok := generic[k].([]any); !ok || len(arr) != 0 {
			t.Errorf("empty delta %s = %v, want []", k, generic[k])
		}
	}
}

func TestPullShipsTombstones(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	seedWorld(t, sqlDB)

	first := mustPull(t, sqlDB, alice, time.Time{})
	if len(first.Senses) == 0 {
		t.Fatal("first pull has no senses")
	}
	backdate(t, sqlDB)

	var dictID int64
	if err := sqlDB.QueryRow(`SELECT id FROM dictionaries WHERE pack_id = 'mkgloss'`).Scan(&dictID); err != nil {
		t.Fatalf("find dictionary: %v", err)
	}
	if err := dict.Uninstall(ctx, sqlDB, dictID); err != nil {
		t.Fatalf("uninstall: %v", err)
	}

	second := mustPull(t, sqlDB, alice, first.Cursor)
	if len(second.Senses) == 0 {
		t.Fatal("second pull shipped no senses, want tombstones")
	}
	for _, s := range second.Senses {
		if s.DeletedAt == nil {
			t.Errorf("sense %d shipped live after uninstall, want tombstone", s.ID)
		}
	}
	if len(second.Entries) != 0 {
		t.Errorf("entries re-sent after uninstall: %+v — only senses changed", second.Entries)
	}
}

func TestPullShipsEntryChanges(t *testing.T) {
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	seedWorld(t, sqlDB)
	backdate(t, sqlDB)

	cursor := mustPull(t, sqlDB, alice, time.Now().UTC().Add(-time.Minute)).Cursor
	id, err := entries.Store{DB: sqlDB}.Upsert(context.Background(), &model.Entry{
		Language: "zh", Kind: "word", Written: "谢谢",
		Readings: []model.Reading{{Type: "pinyin", Value: "xiè xie"}}})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	d := mustPull(t, sqlDB, alice, cursor)
	if len(d.Entries) != 1 || d.Entries[0].ID != id || len(d.Entries[0].Readings) == 0 {
		t.Fatalf("entries = %+v, want only the new entry %d with readings", d.Entries, id)
	}
}

func TestPushEventsAndLWW(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	alice := newUser(t, sqlDB, "alice")
	ws := newWorkspace(t, sqlDB, alice)
	if err := plugins.Register(ctx, sqlDB, []byte(`{"id":"flashcards","name":"Flashcards","version":"1.0","type":"feature"}`)); err != nil {
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
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir()))
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
	creds, _ := json.Marshal(map[string]string{"username": "owner", "password": "pw-owner"})
	resp, err := http.Post(tsURL+"/api/auth/register", "application/json", bytes.NewReader(creds))
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	resp.Body.Close()
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
