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

// TestUserGlobalCoreRows proves the user-global settings rows the web
// keeps (the home layout, docs/contracts/settings/core-rows.json; the
// appearance, themes/appearance.json; the navigation layout,
// settings/nav-layout.json; the widget options, settings/widget-options.json)
// need nothing of their own on the server: the keyed rows store holds each
// user-global (#199), every pull form carries it with a null workspace (also
// a pull narrowed to one workspace), a push follows last-write-wins, and
// another user never sees it.
func TestUserGlobalCoreRows(t *testing.T) {
	fixtureRow := func(path string) (string, string) {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var f struct {
			Key   string          `json:"key"`
			Scope string          `json:"scope"`
			Row   json.RawMessage `json:"row"`
		}
		if err := json.Unmarshal(raw, &f); err != nil {
			t.Fatal(err)
		}
		if f.Scope != "user-global" {
			t.Fatalf("%s: scope %q", path, f.Scope)
		}
		return f.Key, string(f.Row)
	}
	cases := [][2]string{{"home-layout", `{"version":1,"widgets":["flashcards-summary","activity-heatmap"]}`}}
	for _, p := range []string{"../../../docs/contracts/themes/appearance.json", "../../../docs/contracts/settings/nav-layout.json",
		"../../../docs/contracts/settings/widget-options.json"} {
		k, r := fixtureRow(p)
		cases = append(cases, [2]string{k, r})
	}

	sqlDB, err := openData(t.TempDir())
	if err != nil {
		t.Fatalf("openData: %v", err)
	}
	defer sqlDB.Close()
	ctx := context.Background()
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
		Key         string          `json:"key"`
		WorkspaceID *int64          `json:"workspaceId"`
		Data        json.RawMessage `json:"data"`
	}
	find := func(body []byte, key string) *pulled {
		t.Helper()
		var page struct {
			Collections struct {
				Rows []pulled `json:"rows"`
			} `json:"collections"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			t.Fatalf("decode pull %s: %v", body, err)
		}
		for i, r := range page.Collections.Rows {
			if r.Key == key {
				return &page.Collections.Rows[i]
			}
		}
		return nil
	}
	var ws int64
	if err := sqlDB.QueryRow(`INSERT INTO workspaces (user_id, language, name, updated_at) VALUES (?, 'zh', 'Chinese', '2026-11-17T00:00:00Z') RETURNING id`,
		aliceID).Scan(&ws); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		key, row := c[0], c[1]
		path := "/api/rows/" + key
		if st, _ := do("alice", http.MethodGet, path, ""); st != http.StatusNotFound {
			t.Fatalf("%s: GET before any write = %d, want 404 (missing row = the defaults)", key, st)
		}
		if st, b := do("alice", http.MethodPut, path, row); st != http.StatusOK || !strings.Contains(string(b), `"workspaceId":null`) {
			t.Fatalf("%s: PUT = %d %s", key, st, b)
		}
		if st, b := do("alice", http.MethodGet, path, ""); st != http.StatusOK {
			t.Fatalf("%s: GET = %d", key, st)
		} else {
			var got pulled
			json.Unmarshal(b, &got)
			if got.WorkspaceID != nil || !jsonEqual(t, got.Data, row) {
				t.Fatalf("%s: GET = %s", key, b)
			}
		}
	}
	// A v2 round ships rows stamped before its first second (sync/README.md).
	time.Sleep(1100 * time.Millisecond)
	for _, q := range []string{"/api/sync/pull?v=2&collections=rows", "/api/sync/pull?v=2&collections=rows&workspace=" + jsonNumber(ws)} {
		st, b := do("alice", http.MethodGet, q, "")
		for _, c := range cases {
			if got := find(b, c[0]); st != http.StatusOK || got == nil || got.WorkspaceID != nil || !jsonEqual(t, got.Data, c[1]) {
				t.Fatalf("%s: %d, %s row %+v\n%s", q, st, c[0], got, b)
			}
		}
	}
	for _, c := range cases {
		key, row := c[0], c[1]
		push := func(data, stamp string) string {
			_, b := do("alice", http.MethodPost, "/api/sync/push", `{"rows":[{"key":"`+key+`","workspaceId":null,"data":`+data+`,"updatedAt":"`+stamp+`"}]}`)
			return string(b)
		}
		newer := `{"version":1,"pushed":true}`
		if b := push(newer, "2999-01-01T00:00:00Z"); !strings.Contains(b, `"dataAccepted":1`) {
			t.Fatalf("%s: newer push = %s", key, b)
		}
		if b := push(row, "2001-01-01T00:00:00Z"); !strings.Contains(b, `"dataSkipped":1`) {
			t.Fatalf("%s: older push = %s", key, b)
		}
		if _, b := do("alice", http.MethodGet, "/api/rows/"+key, ""); !strings.Contains(string(b), `"pushed":true`) {
			t.Fatalf("%s: after the pushes %s", key, b)
		}
		if st, _ := do("bob", http.MethodGet, "/api/rows/"+key, ""); st != http.StatusNotFound {
			t.Errorf("%s: bob GET = %d", key, st)
		}
	}
	if _, b := do("bob", http.MethodGet, "/api/sync/pull?v=2&collections=rows", ""); find(b, "appearance") != nil || find(b, "home-layout") != nil {
		t.Error("bob's pull carries alice's rows")
	}
}

func jsonNumber(n int64) string { b, _ := json.Marshal(n); return string(b) }

// jsonEqual compares two JSON documents by value, not formatting.
func jsonEqual(t *testing.T, got json.RawMessage, want string) bool {
	t.Helper()
	var a, b any
	if err := json.Unmarshal(got, &a); err != nil {
		t.Fatalf("decode %s: %v", got, err)
	}
	if err := json.Unmarshal([]byte(want), &b); err != nil {
		t.Fatalf("decode %s: %v", want, err)
	}
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return string(ja) == string(jb)
}
