package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/auth"
)

// TestCorePluginNavLayoutRow proves the phone navigation
// (docs/contracts/settings/nav-layout.json, the qinqin-core row "nav-layout")
// needs nothing of its own on the server: the registered qinqin-core plugin
// stores it user-global, every pull form carries it with a null workspace
// (also a pull narrowed to one workspace), a push follows last-write-wins,
// and another user never sees it.
func TestCorePluginNavLayoutRow(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/settings/nav-layout.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		PluginID string          `json:"pluginId"`
		Key      string          `json:"key"`
		Scope    string          `json:"scope"`
		Row      json.RawMessage `json:"row"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if fixture.PluginID != "qinqin-core" || fixture.Key != "nav-layout" || fixture.Scope != "user-global" {
		t.Fatalf("fixture names %s/%s (%s)", fixture.PluginID, fixture.Key, fixture.Scope)
	}
	row := string(fixture.Row)

	sqlDB, err := openData(t.TempDir())
	if err != nil {
		t.Fatalf("openData: %v", err)
	}
	defer sqlDB.Close()
	ctx := context.Background()
	if err := registerBuiltinPlugins(ctx, sqlDB); err != nil {
		t.Fatal(err)
	}
	tokens := map[string]string{}
	var aliceID int64
	for _, name := range []string{"alice", "bob"} {
		u, err := auth.CreateUser(ctx, sqlDB, name, "pw-"+name, false)
		if err != nil {
			t.Fatal(err)
		}
		if name == "alice" {
			aliceID = u.ID
		}
		if tokens[name], err = auth.Login(ctx, sqlDB, name, "pw-"+name); err != nil {
			t.Fatal(err)
		}
	}
	srv := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil))
	defer srv.Close()
	do := func(who, method, path, body string) (int, []byte) {
		t.Helper()
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+tokens[who])
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, b
	}
	type pulled struct {
		PluginID    string          `json:"pluginId"`
		Key         string          `json:"key"`
		WorkspaceID *int64          `json:"workspaceId"`
		Data        json.RawMessage `json:"data"`
		UpdatedAt   string          `json:"updatedAt"`
	}
	find := func(body []byte) *pulled {
		t.Helper()
		var page struct {
			Collections struct {
				PluginData []pulled `json:"pluginData"`
			} `json:"collections"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			t.Fatalf("decode pull %s: %v", body, err)
		}
		rows := page.Collections.PluginData
		for i := range rows {
			if rows[i].PluginID == "qinqin-core" && rows[i].Key == "nav-layout" {
				return &rows[i]
			}
		}
		return nil
	}
	const path = "/api/plugins/qinqin-core/data/nav-layout"

	if st, _ := do("alice", http.MethodGet, path, ""); st != http.StatusNotFound {
		t.Fatalf("GET before any write = %d, want 404 (missing row = the defaults)", st)
	}
	if st, b := do("alice", http.MethodPut, path, row); st != http.StatusOK || !strings.Contains(string(b), `"workspaceId":null`) {
		t.Fatalf("PUT = %d %s", st, b)
	}
	if st, b := do("alice", http.MethodGet, path, ""); st != http.StatusOK {
		t.Fatalf("GET = %d", st)
	} else {
		var got pulled
		json.Unmarshal(b, &got)
		if got.WorkspaceID != nil || !jsonEqual(t, got.Data, row) {
			t.Fatalf("GET = %s", b)
		}
	}

	// The paged pull carries it; a pull narrowed to a workspace too.
	var ws struct{ ID int64 }
	if err := sqlDB.QueryRow(`INSERT INTO workspaces (user_id, language, name, updated_at) VALUES (?, 'zh', 'Chinese', '2026-11-17T00:00:00Z') RETURNING id`,
		aliceID).Scan(&ws.ID); err != nil {
		t.Fatal(err)
	}
	// A v2 round ships rows stamped before its first second (sync/README.md):
	// let the write's second pass.
	time.Sleep(1100 * time.Millisecond)
	for _, q := range []string{
		"/api/sync/pull?v=2&collections=pluginData",
		"/api/sync/pull?v=2&collections=pluginData&workspace=" + jsonNumber(ws.ID),
	} {
		st, b := do("alice", http.MethodGet, q, "")
		got := find(b)
		if st != http.StatusOK || got == nil || got.WorkspaceID != nil || !jsonEqual(t, got.Data, row) {
			t.Fatalf("%s: %d, nav-layout row %+v\n%s", q, st, got, b)
		}
	}

	// Push: a newer write wins, an older one is skipped.
	push := func(data, stamp string) string {
		_, b := do("alice", http.MethodPost, "/api/sync/push", `{"pluginData":[{"pluginId":"qinqin-core","key":"nav-layout","workspaceId":null,"data":`+data+`,"updatedAt":"`+stamp+`"}]}`)
		return string(b)
	}
	newer := `{"version":1,"phone":"drawer","bar":["stats"],"tablet":"rail"}`
	if b := push(newer, "2999-01-01T00:00:00Z"); !strings.Contains(b, `"dataAccepted":1`) {
		t.Fatalf("newer push = %s", b)
	}
	if b := push(row, "2001-01-01T00:00:00Z"); !strings.Contains(b, `"dataSkipped":1`) {
		t.Fatalf("older push = %s", b)
	}
	if _, b := do("alice", http.MethodGet, path, ""); !strings.Contains(string(b), `"phone":"drawer"`) {
		t.Fatalf("after the pushes %s", b)
	}

	// Bob has no nav-layout row and cannot see Alice's.
	if st, _ := do("bob", http.MethodGet, path, ""); st != http.StatusNotFound {
		t.Errorf("bob GET = %d", st)
	}
	if _, b := do("bob", http.MethodGet, "/api/sync/pull?v=2&collections=pluginData", ""); find(b) != nil {
		t.Error("bob's pull carries alice's nav-layout row")
	}
}
