package sync_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
	chinsync "qinqin/internal/sync"
)

type legacyFixture struct {
	Setup struct {
		Typed []struct {
			Key        string          `json:"key"`
			Data       json.RawMessage `json:"data"`
			Version    int             `json:"version"`
			UpdatedAt  string          `json:"updatedAt"`
			ModifiedAt string          `json:"modifiedAt"`
			DeletedAt  *string         `json:"deletedAt"`
		} `json:"typed"`
		PluginData []legacyExpRow `json:"pluginData"`
	} `json:"setup"`
	Cases []struct {
		Name    string `json:"name"`
		Request struct {
			Method string          `json:"method"`
			Path   string          `json:"path"`
			Body   json.RawMessage `json:"body"`
		} `json:"request"`
		Expect struct {
			Status     int             `json:"status"`
			PluginData []legacyExpRow  `json:"pluginData"`
			Result     map[string]int  `json:"result"`
			TypedAfter []legacyAfter   `json:"typedAfter"`
			PluginAft  []legacyAfter   `json:"pluginDataAfter"`
			Row        *legacyExpRow   `json:"row"`
			Keys       []string        `json:"keys"`
			Code       string          `json:"code"`
			RowVersion int             `json:"rowVersion"`
			Raw        json.RawMessage `json:"-"`
		} `json:"expect"`
	} `json:"cases"`
}

type legacyExpRow struct {
	Key       string          `json:"key"`
	Workspace bool            `json:"workspace"`
	Data      json.RawMessage `json:"data"`
	Version   int             `json:"version"`
	UpdatedAt string          `json:"updatedAt"`
	DeletedAt *string         `json:"deletedAt"`
}

type legacyAfter struct {
	Key     string          `json:"key"`
	Absent  bool            `json:"absent"`
	Version int             `json:"version"`
	Deleted bool            `json:"deleted"`
	Data    json.RawMessage `json:"data"`
}

func readLegacyFixture(t *testing.T) legacyFixture {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/study/legacy-view.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx legacyFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	return fx
}

// legacyWorld is one fixture setup: a server, its owner and workspace.
type legacyWorld struct {
	db    *sql.DB
	url   string
	token string
	user  int64
	ws    int64
}

func newLegacyWorld(t *testing.T, fx legacyFixture) legacyWorld {
	t.Helper()
	sqlDB := newDB(t)
	registerReserved(t, sqlDB)
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil))
	t.Cleanup(ts.Close)
	w := legacyWorld{db: sqlDB, url: ts.URL, token: registerAndLogin(t, ts.URL)}
	sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'owner'`).Scan(&w.user)
	w.ws = newWorkspace(t, sqlDB, w.user)
	ctx := context.Background()
	for _, r := range fx.Setup.Typed {
		row, err := rows.FromLegacy(r.Key, r.Data)
		if err != nil {
			t.Fatalf("setup %s: %v", r.Key, err)
		}
		row.M().WorkspaceID = w.ws
		if err := study.InsertStored(ctx, sqlDB, w.user, row, r.Version, r.UpdatedAt, r.ModifiedAt, r.DeletedAt); err != nil {
			t.Fatal(err)
		}
	}
	for _, r := range fx.Setup.PluginData {
		var ws any
		if r.Workspace {
			ws = w.ws
		}
		if _, err := sqlDB.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at, deleted_at)
			VALUES ('qinqin-flashcards', ?, ?, ?, ?, ?, ?, ?, ?)`, w.user, ws, r.Key, string(r.Data), r.Version, r.UpdatedAt, r.UpdatedAt, r.DeletedAt); err != nil {
			t.Fatal(err)
		}
	}
	return w
}

func (w legacyWorld) do(t *testing.T, method, path string, body json.RawMessage) (int, []byte) {
	t.Helper()
	ws := strconv.FormatInt(w.ws, 10)
	path = strings.ReplaceAll(path, "$ws", ws)
	text := strings.ReplaceAll(string(body), `"$ws"`, ws)
	req, _ := http.NewRequest(method, w.url+path, strings.NewReader(text))
	req.Header.Set("Authorization", "Bearer "+w.token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, out
}

func jsonEq(a, b []byte) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	return reflect.DeepEqual(x, y)
}

// legacySet normalises plugin data rows for comparison as a set.
func legacySet(t *testing.T, ws int64, got []map[string]json.RawMessage) []string {
	t.Helper()
	out := []string{}
	for _, r := range got {
		var key string
		var wsID *int64
		var version int
		var updated string
		var deleted *string
		json.Unmarshal(r["key"], &key)
		json.Unmarshal(r["workspaceId"], &wsID)
		json.Unmarshal(r["version"], &version)
		json.Unmarshal(r["updatedAt"], &updated)
		json.Unmarshal(r["deletedAt"], &deleted)
		var data any
		json.Unmarshal(r["data"], &data)
		d, _ := json.Marshal(data)
		del := "live"
		if deleted != nil {
			del = *deleted
		}
		out = append(out, strings.Join([]string{key, strconv.FormatBool(wsID != nil && *wsID == ws), string(d), strconv.Itoa(version), updated, del}, "|"))
	}
	sort.Strings(out)
	return out
}

func expSet(rowsIn []legacyExpRow, ws int64) []map[string]json.RawMessage {
	var out []map[string]json.RawMessage
	for _, r := range rowsIn {
		m := map[string]json.RawMessage{}
		m["key"], _ = json.Marshal(r.Key)
		if r.Workspace {
			m["workspaceId"], _ = json.Marshal(ws)
		} else {
			m["workspaceId"] = json.RawMessage(`null`)
		}
		m["data"] = r.Data
		m["version"], _ = json.Marshal(r.Version)
		m["updatedAt"], _ = json.Marshal(r.UpdatedAt)
		m["deletedAt"], _ = json.Marshal(r.DeletedAt)
		out = append(out, m)
	}
	return out
}

// checkAfter verifies the typed and plugin-data state a case expects.
func checkAfter(t *testing.T, w legacyWorld, typed, plugin []legacyAfter) {
	t.Helper()
	ctx := context.Background()
	for _, a := range typed {
		f, id, _ := rows.KeyIdentity(a.Key)
		r, ok, err := study.Load(ctx, w.db, w.user, w.ws, f, id)
		if err != nil {
			t.Fatal(err)
		}
		if a.Absent {
			if ok {
				t.Errorf("typed %s exists, want absent", a.Key)
			}
			continue
		}
		if !ok {
			t.Errorf("typed %s absent", a.Key)
			continue
		}
		if r.M().Version != a.Version || (r.M().DeletedAt != nil) != a.Deleted {
			t.Errorf("typed %s: version %d deleted %v, want %d %v", a.Key, r.M().Version, r.M().DeletedAt != nil, a.Version, a.Deleted)
		}
		_, data := rows.ToLegacy(r)
		want := a.Data
		if strings.Contains(string(want), `"$now"`) {
			var m map[string]any
			json.Unmarshal(data, &m)
			if at, err := time.Parse(time.RFC3339, m["updatedAt"].(string)); err != nil || time.Since(at) > time.Minute {
				t.Errorf("typed %s: updatedAt %v is not the server clock", a.Key, m["updatedAt"])
			}
			want = json.RawMessage(strings.ReplaceAll(string(want), `"$now"`, strconv.Quote(m["updatedAt"].(string))))
		}
		if !jsonEq(data, want) {
			t.Errorf("typed %s data %s, want %s", a.Key, data, want)
		}
	}
	for _, a := range plugin {
		var deleted sql.NullString
		err := w.db.QueryRow(`SELECT deleted_at FROM plugin_data WHERE user_id = ? AND pack_id = 'qinqin-flashcards' AND key = ?`, w.user, a.Key).Scan(&deleted)
		if a.Absent {
			if err != sql.ErrNoRows {
				t.Errorf("plugin_data %s exists (%v), want absent", a.Key, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("plugin_data %s: %v", a.Key, err)
			continue
		}
		if deleted.Valid != a.Deleted {
			t.Errorf("plugin_data %s deleted %v, want %v", a.Key, deleted.Valid, a.Deleted)
		}
	}
}

// The sync cases of legacy-view.json: what a cached v0.3.x shell pulls and
// pushes keeps working against the typed tables.
func TestLegacyViewSyncFixture(t *testing.T) {
	fx := readLegacyFixture(t)
	n := 0
	for _, c := range fx.Cases {
		if !strings.HasPrefix(c.Request.Path, "/api/sync/") {
			continue
		}
		n++
		t.Run(c.Name, func(t *testing.T) {
			w := newLegacyWorld(t, fx)
			status, body := w.do(t, c.Request.Method, c.Request.Path, c.Request.Body)
			if status != c.Expect.Status {
				t.Fatalf("status %d, want %d: %s", status, c.Expect.Status, body)
			}
			if c.Request.Method == http.MethodGet {
				var d struct {
					PluginData []map[string]json.RawMessage `json:"pluginData"`
				}
				json.Unmarshal(body, &d)
				var exp []map[string]json.RawMessage
				for _, m := range expSet(c.Expect.PluginData, w.ws) {
					exp = append(exp, m)
				}
				if got, want := legacySet(t, w.ws, d.PluginData), legacySet(t, w.ws, exp); !reflect.DeepEqual(got, want) {
					t.Errorf("pluginData:\n got %s\nwant %s", strings.Join(got, "\n     "), strings.Join(want, "\n     "))
				}
			}
			if c.Expect.Result != nil {
				var res map[string]int
				json.Unmarshal(body, &res)
				for k, v := range c.Expect.Result {
					if res[k] != v {
						t.Errorf("result %s = %d, want %d (%s)", k, res[k], v, body)
					}
				}
			}
			checkAfter(t, w, c.Expect.TypedAfter, c.Expect.PluginAft)
		})
	}
	if n < 10 {
		t.Errorf("only %d sync cases", n)
	}
}

// Two users: the legacy view never shows or writes another user's rows.
func TestLegacyViewIsolation(t *testing.T) {
	fx := readLegacyFixture(t)
	w := newLegacyWorld(t, fx)
	bob := newUser(t, w.db, "bob")
	bobWS := newWorkspace(t, w.db, bob)
	ctx := context.Background()
	r, _ := rows.FromLegacy("card:c-bob-1", json.RawMessage(`{"id":"c-bob-1","kind":"vocab","entryId":1,"deckIds":[],"createdAt":"t"}`))
	r.M().WorkspaceID = bobWS
	if err := study.InsertStored(ctx, w.db, bob, r, 1, "2026-11-10T08:00:00Z", "2026-11-10T08:00:00Z", nil); err != nil {
		t.Fatal(err)
	}
	_, body := w.do(t, http.MethodGet, "/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=pluginData,pluginStates", nil)
	if strings.Contains(string(body), "c-bob-1") || strings.Contains(string(body), `"workspaceId":`+strconv.FormatInt(bobWS, 10)) {
		t.Errorf("owner's legacy pull shows bob's rows: %s", body)
	}
	push := `{"events":[],"pluginData":[{"pluginId":"qinqin-flashcards","workspaceId":` + strconv.FormatInt(bobWS, 10) +
		`,"key":"card:c-bob-1","data":{"id":"c-bob-1","kind":"vocab","entryId":2,"deckIds":[],"createdAt":"t"},"updatedAt":"2026-11-13T00:00:00Z"}]}`
	if status, _ := w.do(t, http.MethodPost, "/api/sync/push", json.RawMessage(push)); status != http.StatusNotFound {
		t.Errorf("legacy push into bob's workspace: status %d, want 404", status)
	}
	got, _, _ := study.Load(ctx, w.db, bob, bobWS, rows.Cards, "c-bob-1")
	if got.(*rows.Card).EntryID != 1 || got.M().Version != 1 {
		t.Errorf("bob's card changed: %+v", got)
	}
	// Bob's own legacy pull holds only his card.
	d, err := chinsync.Pull(ctx, w.db, bob, time.Unix(0, 0), map[string]bool{"pluginData": true})
	if err != nil {
		t.Fatal(err)
	}
	if len(d.PluginData) != 1 || d.PluginData[0].Key != "card:c-bob-1" || *d.PluginData[0].WorkspaceID != bobWS {
		t.Errorf("bob's legacy pull = %+v", d.PluginData)
	}
}

// A leftover plugin row whose key a typed row also holds is shadowed in the
// legacy pull: the old shell sees one row per key, the typed one.
func TestLegacyPullShadowsLeftoverOfTypedKey(t *testing.T) {
	fx := readLegacyFixture(t)
	w := newLegacyWorld(t, fx)
	if _, err := w.db.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at)
		VALUES ('qinqin-flashcards', ?, ?, 'card:c-vocab-1201', '{"id":"c-vocab-1201","kind":"vocab","entryId":0.5,"deckIds":[],"createdAt":"t"}', 1, '2026-11-15T00:00:00Z')`, w.user, w.ws); err != nil {
		t.Fatal(err)
	}
	_, body := w.do(t, http.MethodGet, "/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=pluginData,pluginStates", nil)
	if n := strings.Count(string(body), `"key":"card:c-vocab-1201"`); n != 1 {
		t.Errorf("legacy pull holds card:c-vocab-1201 %d times, want 1: %s", n, body)
	}
	if strings.Contains(string(body), `0.5`) {
		t.Errorf("legacy pull shows the shadowed leftover")
	}
}
