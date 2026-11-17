package api_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/plugins"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

// docs/contracts/sync/push-result.json through POST /api/sync/push (B5):
// the push answer as built, pinned. Written against the code without
// changing it.

type pushCase struct {
	Name    string          `json:"name"`
	Setup   *pushSetup      `json:"setup"`
	Body    json.RawMessage `json:"body"`
	RawBody string          `json:"rawBody"`
	Expect  struct {
		Status     int             `json:"status"`
		JSON       json.RawMessage `json:"json"`
		Text       string          `json:"text"`
		TextPrefix string          `json:"textPrefix"`
	} `json:"expect"`
	Stored *struct {
		Events               *int                       `json:"events"`
		PluginData           []string                   `json:"pluginData"`
		Cards                []string                   `json:"cards"`
		PluginDataValue      map[string]json.RawMessage `json:"pluginDataValue"`
		CardVersionUnchanged bool                       `json:"cardVersionUnchanged"`
	} `json:"stored"`
}

type pushSetup struct {
	Events     []json.RawMessage `json:"events"`
	PluginData []struct {
		PluginID    string          `json:"pluginId"`
		Key         string          `json:"key"`
		WorkspaceID json.RawMessage `json:"workspaceId"`
		Data        json.RawMessage `json:"data"`
		UpdatedAt   string          `json:"updatedAt"`
	} `json:"pluginData"`
	Cards []json.RawMessage `json:"cards"`
}

var stringPlaceholder = regexp.MustCompile(`"\$string:(\d+)"`)

// expandPush replaces $ws, $bobWs and "$string:n" in a fixture JSON text.
func expandPush(raw string, ws, bobWS int64) string {
	raw = strings.ReplaceAll(raw, `"$ws"`, strconv.FormatInt(ws, 10))
	raw = strings.ReplaceAll(raw, `"$bobWs"`, strconv.FormatInt(bobWS, 10))
	return stringPlaceholder.ReplaceAllStringFunc(raw, func(m string) string {
		n, _ := strconv.Atoi(stringPlaceholder.FindStringSubmatch(m)[1])
		return `"` + strings.Repeat("x", n) + `"`
	})
}

// jsonPadded is a valid JSON push body of exactly n bytes.
func jsonPadded(n int) string {
	head, tail := `{"events":[],"pad":"`, `"}`
	return head + strings.Repeat("x", n-len(head)-len(tail)) + tail
}

func jsonValueEqual(a, b []byte) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	xa, _ := json.Marshal(x)
	ya, _ := json.Marshal(y)
	return bytes.Equal(xa, ya)
}

func TestContractPushResult(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/sync/push-result.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Keys   []string `json:"keys"`
		Limits struct {
			BodyBytes int `json:"bodyBytes"`
			ItemBytes int `json:"itemBytes"`
		} `json:"limits"`
		Cases []pushCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if file.Limits.BodyBytes != 8<<20 || file.Limits.ItemBytes != 256<<10 {
		t.Errorf("limits %+v, server 8 MiB and 256 KiB", file.Limits)
	}
	for _, c := range file.Cases {
		t.Run(c.Name, func(t *testing.T) {
			ctx := context.Background()
			ts, sqlDB := newServer(t)
			for _, m := range plugins.Builtin() {
				if _, err := plugins.RegisterBuiltin(ctx, sqlDB, m); err != nil {
					t.Fatal(err)
				}
			}
			alice := registerUser(t, ts.URL, "alice", "")
			bob := registerUser(t, ts.URL, "bob", alice)
			ws := createWorkspace(t, ts.URL, alice, "zh", "Chinese")
			bobWS := createWorkspace(t, ts.URL, bob, "zh", "Chinese")
			var aliceID int64
			sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'alice'`).Scan(&aliceID)
			setupKeys := pushSetupRows(t, sqlDB, aliceID, ws, bobWS, c.Setup)

			body := c.RawBody
			if strings.HasPrefix(body, "$jsonPadded:") {
				n, _ := strconv.Atoi(strings.TrimPrefix(body, "$jsonPadded:"))
				body = jsonPadded(n)
			} else if body == "" {
				body = expandPush(string(c.Body), ws, bobWS)
			}
			req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/sync/push", strings.NewReader(body))
			req.Header.Set("Authorization", "Bearer "+alice)
			req.Header.Set("Content-Type", "application/json")
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			got, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode != c.Expect.Status {
				t.Fatalf("status %d, want %d: %.300s", resp.StatusCode, c.Expect.Status, got)
			}
			if c.Expect.Status == http.StatusOK {
				var top map[string]json.RawMessage
				if err := json.Unmarshal(got, &top); err != nil {
					t.Fatal(err)
				}
				keys := make([]string, 0, len(top))
				for k := range top {
					keys = append(keys, k)
				}
				want := slices.Clone(file.Keys)
				sort.Strings(keys)
				sort.Strings(want)
				if !slices.Equal(keys, want) {
					t.Errorf("answer keys %v, want %v", keys, want)
				}
			}
			if c.Expect.JSON != nil && !jsonValueEqual(got, c.Expect.JSON) {
				t.Errorf("body %s, want %s", got, c.Expect.JSON)
			}
			if c.Expect.Text != "" && string(got) != c.Expect.Text+"\n" {
				t.Errorf("text %q, want %q", got, c.Expect.Text+"\n")
			}
			if c.Expect.TextPrefix != "" && !strings.HasPrefix(string(got), c.Expect.TextPrefix) {
				t.Errorf("text %q, want prefix %q", got, c.Expect.TextPrefix)
			}
			if c.Stored != nil {
				checkPushStored(t, sqlDB, aliceID, setupKeys, c)
			}
		})
	}
}

// pushSetupRows stores a case's setup rows with their stamps and returns
// the setup plugin keys.
func pushSetupRows(t *testing.T, sqlDB *sql.DB, user, ws, bobWS int64, s *pushSetup) map[string]bool {
	t.Helper()
	keys := map[string]bool{}
	if s == nil {
		return keys
	}
	ctx := context.Background()
	for _, raw := range s.Events {
		var e struct {
			ID, Device, TS, Type string
			WorkspaceID          int64           `json:"workspaceId"`
			Payload              json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal([]byte(expandPush(string(raw), ws, bobWS)), &e); err != nil {
			t.Fatal(err)
		}
		if _, err := sqlDB.Exec(`INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			e.ID, user, e.WorkspaceID, e.Device, e.TS, e.Type, string(e.Payload), e.TS); err != nil {
			t.Fatal(err)
		}
	}
	for _, r := range s.PluginData {
		var wsID any
		if w := expandPush(string(r.WorkspaceID), ws, bobWS); w != "null" && w != "" {
			wsID, _ = strconv.ParseInt(w, 10, 64)
		}
		if _, err := sqlDB.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
			r.PluginID, user, wsID, r.Key, string(r.Data), r.UpdatedAt, r.UpdatedAt); err != nil {
			t.Fatal(err)
		}
		keys[r.Key] = true
	}
	for _, raw := range s.Cards {
		row, err := rows.Decode(rows.Cards, []byte(expandPush(string(raw), ws, bobWS)))
		if err != nil {
			t.Fatal(err)
		}
		at := row.M().UpdatedAt.UTC().Format("2006-01-02T15:04:05Z")
		if err := study.InsertStored(ctx, sqlDB, user, row, 1, at, at, nil); err != nil {
			t.Fatal(err)
		}
	}
	return keys
}

func checkPushStored(t *testing.T, sqlDB *sql.DB, user int64, setupKeys map[string]bool, c pushCase) {
	t.Helper()
	s := c.Stored
	strs := func(query string) []string {
		t.Helper()
		list, err := sqlDB.Query(query, user)
		if err != nil {
			t.Fatal(err)
		}
		defer list.Close()
		out := []string{}
		for list.Next() {
			var v string
			list.Scan(&v)
			out = append(out, v)
		}
		return out
	}
	if s.Events != nil {
		var n int
		sqlDB.QueryRow(`SELECT COUNT(*) FROM study_events WHERE user_id = ?`, user).Scan(&n)
		if n != *s.Events {
			t.Errorf("%d events stored, want %d", n, *s.Events)
		}
	}
	if s.PluginData != nil {
		got := slices.DeleteFunc(strs(`SELECT key FROM plugin_data WHERE user_id = ? AND deleted_at IS NULL ORDER BY key`),
			func(k string) bool { return setupKeys[k] })
		if !slices.Equal(got, s.PluginData) {
			t.Errorf("plugin keys %v, want %v", got, s.PluginData)
		}
	}
	if s.Cards != nil {
		if got := strs(`SELECT id FROM study_cards WHERE user_id = ? AND deleted_at IS NULL ORDER BY id`); !slices.Equal(got, s.Cards) {
			t.Errorf("cards %v, want %v", got, s.Cards)
		}
	}
	for key, want := range s.PluginDataValue {
		var data string
		sqlDB.QueryRow(`SELECT data FROM plugin_data WHERE user_id = ? AND key = ?`, user, key).Scan(&data)
		if !jsonValueEqual([]byte(data), want) {
			t.Errorf("%s = %s, want %s", key, data, want)
		}
	}
	if s.CardVersionUnchanged {
		var v int
		sqlDB.QueryRow(`SELECT version FROM study_cards WHERE user_id = ?`, user).Scan(&v)
		if v != 1 {
			t.Errorf("card version %d, want 1 (no write)", v)
		}
	}
}
