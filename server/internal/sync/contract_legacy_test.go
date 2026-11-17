package sync_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
	chinsync "qinqin/internal/sync"
)

// docs/contracts/sync/legacy-pull.json over HTTP: GET /api/sync/pull
// without v=2, each case on a fresh server for alice (the instance owner).

type legacyPullExpect struct {
	Status          int            `json:"status"`
	Keys            []string       `json:"keys"`
	Empty           []string       `json:"empty"`
	Typed           map[string]int `json:"typed"`
	LegacyRows      *int           `json:"legacyRows"`
	Sentences       string         `json:"sentences"`
	PluginData      []string       `json:"pluginData"`
	Deprecation     bool           `json:"deprecation"`
	Cursor          string         `json:"cursor"`
	Error           string         `json:"error"`
	MessageContains string         `json:"messageContains"`
	Text            string         `json:"text"`
	TextPrefix      string         `json:"textPrefix"`
}

type legacyPullCase struct {
	Name   string            `json:"name"`
	As     *string           `json:"as"`
	Query  map[string]string `json:"query"`
	Setup  []string          `json:"setup"`
	Now    string            `json:"now"`
	Expect legacyPullExpect  `json:"expect"`
	Then   *struct {
		Query  map[string]string `json:"query"`
		Expect legacyPullExpect  `json:"expect"`
	} `json:"then"`
}

func TestContractLegacyPull(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/sync/legacy-pull.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Headers map[string]string `json:"headers"`
		Keys    []string          `json:"keys"`
		Moved   []string          `json:"moved"`
		Cases   []legacyPullCase  `json:"cases"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := dec.Decode(&file); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(file.Keys, append([]string{"cursor"}, chinsync.Collections...)) {
		t.Errorf("fixture keys %v, server %v", file.Keys, chinsync.Collections)
	}
	if !slices.Equal(file.Moved, chinsync.MovedCollections) {
		t.Errorf("fixture moved %v, server %v", file.Moved, chinsync.MovedCollections)
	}
	for _, c := range file.Cases {
		t.Run(c.Name, func(t *testing.T) {
			if c.Now != "" {
				now, err := time.Parse(time.RFC3339, c.Now)
				if err != nil {
					t.Fatal(err)
				}
				defer chinsync.SetLegacyClock(func() time.Time { return now })()
			}
			sqlDB := newDB(t)
			registerReserved(t, sqlDB)
			ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil))
			t.Cleanup(ts.Close)
			token := registerAndLogin(t, ts.URL)
			var alice int64
			sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'owner'`).Scan(&alice)
			ws := newWorkspace(t, sqlDB, alice)
			ctx := context.Background()
			exec := func(q string, args ...any) {
				t.Helper()
				if _, err := sqlDB.Exec(q, args...); err != nil {
					t.Fatal(err)
				}
			}
			seeded := false
			for _, s := range c.Setup {
				switch s {
				case "lexicon", "packSentence":
					if !seeded {
						seedWorld(t, sqlDB) // a zh dictionary, links, levels and pack sentences
						seeded = true
					}
				case "ownSentence":
					exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (1, '', ?, '我的', '', '', '2026-11-12T08:00:00Z')`, alice)
				case "otherUsersSentence":
					bob := newUser(t, sqlDB, "bob")
					exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (1, '', ?, '他的', '', '', '2026-11-12T08:00:00Z')`, bob)
				case "typedCard":
					card := &rows.Card{ID: "c-1", Kind: "vocab", EntryID: 1, SkipKinds: []string{}, DeckIDs: []string{"general"}, CreatedAt: "2026-11-12T08:00:00Z"}
					card.WorkspaceID = ws
					if err := study.InsertStored(ctx, sqlDB, alice, card, 1, "2026-11-12T08:00:00Z", "2026-11-12T08:00:00Z", nil); err != nil {
						t.Fatal(err)
					}
				case "pluginRow":
					exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at) VALUES ('qinqin-core', ?, ?, 'live', '{}', 1, '2026-11-12T08:00:01Z', '2026-11-12T08:00:01Z')`, alice, ws)
				case "pluginTombstone":
					exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at, deleted_at) VALUES ('qinqin-core', ?, ?, 'tombstone', '{}', 2, '2026-11-12T08:00:02Z', '2026-11-12T08:00:02Z', '2026-11-12T08:00:02Z')`, alice, ws)
				default:
					t.Fatalf("unknown setup %q", s)
				}
			}
			as := token
			if c.As != nil {
				as = *c.As
			}
			checkLegacyPull(t, ts.URL, as, alice, c.Query, c.Expect, file.Headers)
			if c.Then != nil {
				checkLegacyPull(t, ts.URL, as, alice, c.Then.Query, c.Then.Expect, file.Headers)
			}
		})
	}
}

func checkLegacyPull(t *testing.T, base, token string, alice int64, query map[string]string, e legacyPullExpect, headers map[string]string) {
	t.Helper()
	q := url.Values{}
	for k, v := range query {
		q.Set(k, v)
	}
	req, _ := http.NewRequest(http.MethodGet, base+"/api/sync/pull?"+q.Encode(), nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != e.Status {
		t.Fatalf("status %d, want %d: %s", resp.StatusCode, e.Status, body)
	}
	if e.Deprecation {
		for k, v := range headers {
			if got := resp.Header.Get(k); got != v {
				t.Errorf("header %s = %q, want %q", k, got, v)
			}
		}
	}
	if e.Error != "" {
		var out struct{ Error, Message string }
		if err := json.Unmarshal(body, &out); err != nil || out.Error != e.Error || !strings.Contains(out.Message, e.MessageContains) {
			t.Errorf("error body %s, want %s with %q", body, e.Error, e.MessageContains)
		}
	}
	if e.Text != "" && strings.TrimSpace(string(body)) != e.Text {
		t.Errorf("text %q, want %q", body, e.Text)
	}
	if e.TextPrefix != "" && !strings.HasPrefix(string(body), e.TextPrefix) {
		t.Errorf("text %q, want prefix %q", body, e.TextPrefix)
	}
	if e.Status != http.StatusOK {
		return
	}
	// Top-level keys in order.
	dec := json.NewDecoder(bytes.NewReader(body))
	keys := []string{}
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		t.Fatalf("not an object: %s", body)
	}
	top := map[string]json.RawMessage{}
	for dec.More() {
		tok, _ := dec.Token()
		k := tok.(string)
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			t.Fatal(err)
		}
		keys = append(keys, k)
		top[k] = v
	}
	if e.Keys != nil && !slices.Equal(keys, e.Keys) {
		t.Errorf("keys %v, want %v", keys, e.Keys)
	}
	arrays := map[string][]map[string]any{}
	for _, k := range keys[1:] {
		var list []map[string]any
		if err := json.Unmarshal(top[k], &list); err != nil || list == nil {
			t.Errorf("%s is not an array: %s", k, top[k])
		}
		arrays[k] = list
	}
	for _, k := range e.Empty {
		if len(arrays[k]) != 0 {
			t.Errorf("%s has %d rows, want []", k, len(arrays[k]))
		}
	}
	for k, n := range e.Typed {
		if len(arrays[k]) != n {
			t.Errorf("%s has %d rows, want %d", k, len(arrays[k]), n)
		}
	}
	legacy := 0
	plugin := []string{}
	for _, r := range arrays["pluginData"] {
		switch r["pluginId"] {
		case rows.Namespace:
			legacy++
		case "qinqin-core":
			plugin = append(plugin, r["key"].(string))
		}
	}
	if e.LegacyRows != nil && legacy != *e.LegacyRows {
		t.Errorf("%d legacy rows in pluginData, want %d", legacy, *e.LegacyRows)
	}
	if e.PluginData != nil && !slices.Equal(plugin, e.PluginData) {
		t.Errorf("pluginData %v, want %v", plugin, e.PluginData)
	}
	if e.Sentences == "own" {
		if len(arrays["sentences"]) == 0 {
			t.Error("no own sentence")
		}
		for _, s := range arrays["sentences"] {
			if s["userId"] != float64(alice) {
				t.Errorf("sentence %v is not alice's own", s)
			}
		}
	}
	if e.Cursor != "" {
		var got string
		json.Unmarshal(top["cursor"], &got)
		if got != e.Cursor {
			t.Errorf("cursor %s, want %s", got, e.Cursor)
		}
	}
}
