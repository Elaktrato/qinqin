package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sort"
	"strconv"
	"testing"

	"qinqin/internal/api"
	"qinqin/internal/db"
	"qinqin/internal/study/rows"
)

// An old web shell keeps working on the new server (spec Q9, compatibility
// matrix): a database a v0.3.0 server left behind is migrated (038), then
// the exact request sequence of the v0.3.0 web (apps/web/src/lib/study/
// store.ts at tag v0.3.0: SYNC_PULL_PATH, putData, pushStudyRows,
// deleteData, setKnownMarks, the review outbox) runs against it. After
// every step the new client's typed pull and the old client's legacy pull
// show the same study rows.

const v030PullPath = "/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=pluginData,pluginStates"
const typedPullPath = "/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=pluginData,pluginStates,cards,decks,deckSettings,limits,fsrsSets,fsrsActive"

type oldShell struct {
	t     *testing.T
	url   string
	token string
	ws    int64
}

type legacyPullRow struct {
	PluginID    string          `json:"pluginId"`
	Key         string          `json:"key"`
	WorkspaceID *int64          `json:"workspaceId"`
	Data        json.RawMessage `json:"data"`
	Version     int             `json:"version"`
	UpdatedAt   string          `json:"updatedAt"`
	DeletedAt   *string         `json:"deletedAt"`
}

func (o oldShell) do(method, path string, body any) (int, []byte) {
	o.t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, o.url+path, rdr)
	req.Header.Set("Authorization", "Bearer "+o.token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		o.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	var buf bytes.Buffer
	buf.ReadFrom(resp.Body)
	return resp.StatusCode, buf.Bytes()
}

func (o oldShell) must(method, path string, body any, want int) []byte {
	o.t.Helper()
	code, out := o.do(method, path, body)
	if code != want {
		o.t.Fatalf("%s %s = %d %s, want %d", method, path, code, out, want)
	}
	return out
}

// legacy: the typed-family rows of the old client's pull, by key.
func (o oldShell) legacy() map[string]legacyPullRow {
	o.t.Helper()
	var pull struct {
		PluginData []legacyPullRow `json:"pluginData"`
	}
	json.Unmarshal(o.must("GET", v030PullPath, nil, 200), &pull)
	out := map[string]legacyPullRow{}
	for _, r := range pull.PluginData {
		if _, typed := rows.FamilyOf(r.Key); typed && r.PluginID == rows.Namespace && r.WorkspaceID != nil && *r.WorkspaceID == o.ws {
			out[r.Key] = r
		}
	}
	return out
}

// typed: the new client's typed rows of the workspace, as legacy key -> row.
func (o oldShell) typed() map[string]rows.Row {
	o.t.Helper()
	var pull map[string]json.RawMessage
	json.Unmarshal(o.must("GET", typedPullPath, nil, 200), &pull)
	out := map[string]rows.Row{}
	for _, f := range rows.Families {
		var list []json.RawMessage
		if err := json.Unmarshal(pull[string(f)], &list); err != nil {
			o.t.Fatalf("typed pull %s: %v", f, err)
		}
		for _, raw := range list {
			r, err := rows.Decode(f, raw)
			if err != nil {
				o.t.Fatalf("typed pull %s row %s: %v", f, raw, err)
			}
			if r.M().WorkspaceID == o.ws {
				out[rows.LegacyKey(r)] = r
			}
		}
	}
	return out
}

// agree: every typed row is in the legacy pull as its legacy row (same
// data, version, stamps, tombstone), and the legacy pull holds nothing
// else of the typed families but the leftovers.
func (o oldShell) agree(step string, leftovers ...string) map[string]rows.Row {
	o.t.Helper()
	typed, legacy := o.typed(), o.legacy()
	for _, k := range leftovers {
		if _, ok := legacy[k]; !ok {
			o.t.Errorf("%s: leftover %s missing from the legacy pull", step, k)
		}
		if _, ok := typed[k]; ok {
			o.t.Errorf("%s: leftover %s has a typed row", step, k)
		}
		delete(legacy, k)
	}
	keys := func(m map[string]legacyPullRow) []string {
		var out []string
		for k := range m {
			out = append(out, k)
		}
		sort.Strings(out)
		return out
	}
	var typedKeys []string
	for k := range typed {
		typedKeys = append(typedKeys, k)
	}
	sort.Strings(typedKeys)
	if got := keys(legacy); !equalStrings(got, typedKeys) {
		o.t.Fatalf("%s: legacy keys %v, typed keys %v", step, got, typedKeys)
	}
	for k, r := range typed {
		l := legacy[k]
		_, data := rows.ToLegacy(r)
		if !sameLegacyData(o.t, k, data, l.Data) {
			o.t.Errorf("%s: %s legacy data %s, typed row as legacy %s", step, k, l.Data, data)
		}
		m := r.M()
		if l.Version != m.Version || l.UpdatedAt != m.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z07:00") {
			o.t.Errorf("%s: %s legacy v%d %s, typed v%d %s", step, k, l.Version, l.UpdatedAt, m.Version, m.UpdatedAt)
		}
		if (l.DeletedAt == nil) != (m.DeletedAt == nil) {
			o.t.Errorf("%s: %s tombstone differs (legacy %v, typed %v)", step, k, l.DeletedAt, m.DeletedAt)
		}
	}
	return typed
}

// sameLegacyData compares as JSON values; a deck settings row's inner
// updatedAt is the stored edit time, which the typed wire does not carry.
func sameLegacyData(t *testing.T, key string, a, b []byte) bool {
	t.Helper()
	var x, y map[string]any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	if f, _ := rows.FamilyOf(key); f == rows.DeckSettings {
		delete(x, "updatedAt")
		delete(y, "updatedAt")
	}
	ja, _ := json.Marshal(x)
	jb, _ := json.Marshal(y)
	return bytes.Equal(ja, jb)
}

func TestOldWebShellKeepsWorkingOnTheNewServer(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v030.db")

	// 1. A v0.3.0 server: schema through 037, users and a workspace made
	// through the API, study rows as the v0.3.0 web wrote them.
	oldDB, err := db.OpenThrough(path, "037_access_tokens")
	if err != nil {
		t.Fatal(err)
	}
	oldTS := httptest.NewServer(api.New(oldDB, t.TempDir(), nil))
	alice := registerUser(t, oldTS.URL, "alice", "")
	ws := createWorkspace(t, oldTS.URL, alice, "zh", "")
	oldTS.Close()
	const t1, t2 = "2026-11-10T08:00:00Z", "2026-11-12T10:00:00Z"
	var aliceID int64
	if err := oldDB.QueryRow(`SELECT id FROM users WHERE username = 'alice'`).Scan(&aliceID); err != nil {
		t.Fatal(err)
	}
	wsS := strconv.FormatInt(ws, 10)
	for _, r := range [][4]string{
		{"card:c-vocab-1201", `{"id":"c-vocab-1201","kind":"vocab","entryId":1201,"written":"你好","deckIds":["general","01JDECK"],"createdAt":"` + t1 + `"}`, t2, ""},
		{"card:c-reverse-1201", `{"id":"c-reverse-1201","kind":"reverse","entryId":1201,"deckIds":["01JDECK"],"createdAt":"` + t1 + `"}`, t2, ""},
		{"card:c-sentence-77", `{"id":"c-sentence-77","kind":"sentence","entryId":77,"sentenceId":9,"deckIds":["general"],"createdAt":"` + t1 + `"}`, t2, ""},
		{"card:c-tone-5", `{"id":"c-tone-5","kind":"tone","entryId":5,"deckIds":["general"],"createdAt":"` + t1 + `"}`, t2, t2},
		{"deck:01JDECK", `{"id":"01JDECK","name":"Words","createdAt":"` + t1 + `"}`, t2, ""},
		{"deckcfg:01JDECK", `{"deckId":"01JDECK","cardTypes":["reverse"],"updatedAt":"` + t1 + `"}`, t1, ""},
		{"limits:workspace", `{"version":1,"new":15,"reviews":null}`, t2, ""},
		{"limits:deck:01JDECK", `{"version":1,"new":5}`, t1, ""},
		{"fsrs:set:01JSET1", `{"id":"01JSET1","w":[0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542],"createdAt":"` + t1 + `","source":"optimized"}`, t1, ""},
		{"fsrs:active", `{"setId":"01JSET1","changedAt":"` + t1 + `"}`, t1, ""},
		// a row no v0.3.0 parser could read: stays a leftover
		{"card:c-vocab-15", `{"id":"c-vocab-15","kind":"vocab","entryId":1.5,"deckIds":["general"],"createdAt":"` + t1 + `"}`, t1, ""},
		{"goals:workspace", `{"version":1,"history":[]}`, t1, ""},
	} {
		var deleted any
		if r[3] != "" {
			deleted = r[3]
		}
		if _, err := oldDB.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at, deleted_at)
			VALUES ('qinqin-flashcards', ?, ?, ?, ?, 2, ?, ?, ?)`, aliceID, ws, r[0], r[1], r[2], r[2], deleted); err != nil {
			t.Fatal(err)
		}
	}
	oldDB.Close()

	// 2. The new server on the same file: migration 038 moves the rows.
	newDB, err := db.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { newDB.Close() })
	seedBuiltin(t, newDB, validManifest("qinqin-flashcards", ""))
	ts := httptest.NewServer(api.New(newDB, t.TempDir(), nil))
	t.Cleanup(ts.Close)
	o := oldShell{t: t, url: ts.URL, token: alice, ws: ws}
	data := func(key string) string { return "/api/plugins/qinqin-flashcards/data/" + key + "?workspace=" + wsS }

	typed := o.agree("after the migration", "card:c-vocab-15")
	if len(typed) != 10 {
		t.Fatalf("typed rows after the migration = %d, want 10", len(typed))
	}
	if typed["card:c-tone-5"].M().DeletedAt == nil {
		t.Error("the tombstoned card lost its tombstone")
	}

	// 3. putData: the old shell adds a word.
	o.must("PUT", data("card:c-vocab-300"), map[string]any{"id": "c-vocab-300", "kind": "vocab", "entryId": 300, "written": "猫", "deckIds": []string{"general"}, "createdAt": "2026-11-16T09:00:00.000Z"}, 200)
	if typed := o.agree("after PUT card", "card:c-vocab-15"); typed["card:c-vocab-300"] == nil {
		t.Fatal("the added card is not a typed row")
	}

	// 4. deleteDeck: pushStudyRows of the card rewrites, then the tombstones.
	now := "2026-11-16T09:01:00.000Z"
	var res struct {
		DataAccepted int `json:"dataAccepted"`
		DataSkipped  int `json:"dataSkipped"`
		DataRefused  int `json:"dataRefused"`
	}
	push := func(items ...map[string]any) {
		t.Helper()
		json.Unmarshal(o.must("POST", "/api/sync/push", map[string]any{"pluginData": items}, 200), &res)
		if res.DataAccepted != len(items) || res.DataSkipped != 0 || res.DataRefused != 0 {
			t.Fatalf("push = %+v, want %d accepted", res, len(items))
		}
	}
	push(
		map[string]any{"pluginId": "qinqin-flashcards", "key": "card:c-vocab-1201", "workspaceId": ws, "updatedAt": now,
			"data": map[string]any{"id": "c-vocab-1201", "kind": "vocab", "entryId": 1201, "written": "你好", "deckIds": []string{"general"}, "createdAt": t1}},
		map[string]any{"pluginId": "qinqin-flashcards", "key": "card:c-reverse-1201", "workspaceId": ws, "updatedAt": now,
			"data": map[string]any{"id": "c-reverse-1201", "kind": "reverse", "entryId": 1201, "deckIds": []string{"general"}, "createdAt": t1}},
	)
	o.must("DELETE", data("deck:01JDECK"), nil, http.StatusNoContent)
	o.must("DELETE", data("deckcfg:01JDECK"), nil, http.StatusNoContent)
	o.must("DELETE", data("limits:deck:01JDECK"), nil, http.StatusNoContent)
	typed = o.agree("after deleteDeck", "card:c-vocab-15")
	if typed["deck:01JDECK"].M().DeletedAt == nil || typed["deckcfg:01JDECK"].M().DeletedAt == nil {
		t.Error("the deck and its settings are not tombstoned")
	}
	if c := typed["card:c-reverse-1201"].(*rows.Card); len(c.DeckIDs) != 1 || c.DeckIDs[0] != "general" {
		t.Errorf("reverse card decks = %v", c.DeckIDs)
	}

	// 5. saveDeckNewOrder, 6. saveDeckLimits, 7. setActiveSet(null) by DELETE.
	o.must("PUT", data("deckcfg:general"), map[string]any{"deckId": "general", "cardTypes": []string{"cloze"}, "newOrder": map[string]any{"by": "frequency"}, "updatedAt": now}, 200)
	o.must("PUT", data("limits:deck:general"), map[string]any{"version": 1, "new": 0, "reviews": nil}, 200)
	o.must("DELETE", data("fsrs:active"), nil, http.StatusNoContent)
	typed = o.agree("after deck settings, limits and the active set", "card:c-vocab-15")
	if s := typed["deckcfg:general"].(*rows.DeckSettingsRow); s.NewOrder == nil || s.NewOrder.By != "frequency" {
		t.Errorf("deck settings newOrder = %+v", s.NewOrder)
	}
	if l := typed["limits:deck:general"].(*rows.LimitsRow); l.New == nil || l.New.Limit == nil || *l.New.Limit != 0 || l.Reviews == nil || l.Reviews.Limit != nil {
		t.Errorf("deck limits = %+v", l)
	}
	if typed["fsrs:active"].M().DeletedAt == nil {
		t.Error("fsrs:active is not tombstoned")
	}

	// 8. setKnownMarks: a keyed row stays plugin data.
	push(map[string]any{"pluginId": "qinqin-flashcards", "key": "known:300", "workspaceId": ws, "updatedAt": now,
		"data": map[string]any{"version": 1, "entryId": 300, "createdAt": now}})
	if n := countRows(t, newDB, `SELECT COUNT(*) FROM plugin_data WHERE key = 'known:300' AND workspace_id = ?`, ws); n != 1 {
		t.Errorf("known:300 rows in plugin_data = %d", n)
	}
	o.agree("after a known mark", "card:c-vocab-15")

	// 9. The review outbox (v2) flushes unchanged; a retry is a duplicate.
	review := map[string]any{"events": []map[string]any{{
		"id": "01JZZ7BXQ0000000000000000Z", "workspaceId": ws, "device": "web", "ts": "2026-11-16T09:02:00.000Z",
		"type": "review", "payload": map[string]any{"cardId": "c-vocab-300", "mode": "vocab", "grade": 3},
	}}}
	var batch struct {
		Accepted   int `json:"accepted"`
		Duplicates int `json:"duplicates"`
	}
	json.Unmarshal(o.must("POST", "/api/events/batch", review, 200), &batch)
	if batch.Accepted != 1 || batch.Duplicates != 0 {
		t.Errorf("outbox flush = %+v", batch)
	}
	json.Unmarshal(o.must("POST", "/api/events/batch", review, 200), &batch)
	if batch.Accepted != 0 || batch.Duplicates != 1 {
		t.Errorf("outbox retry = %+v", batch)
	}
	o.agree("after the outbox", "card:c-vocab-15")
}
