package api_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"qinqin/internal/auth"
)

// The legacy view on the plugin-data routes (spec Q9): a cached v0.3.x
// web shell reads and writes qinqin-flashcards rows of the typed study
// families through GET/PUT/DELETE /api/plugins/qinqin-flashcards/data;
// the server answers them from the typed tables.

type legacyEnv struct {
	url          string
	db           *sql.DB
	alice, bob   string
	aliceID      int64
	bobID        int64
	aliceWS, bWS int64
	aliceWS2     int64
}

func newLegacyEnv(t *testing.T) legacyEnv {
	t.Helper()
	ts, sqlDB := newServer(t)
	e := legacyEnv{url: ts.URL, db: sqlDB}
	e.alice = registerUser(t, ts.URL, "alice", "")
	e.bob = registerUser(t, ts.URL, "bob", e.alice)
	e.aliceID, e.bobID = userID(t, sqlDB, "alice"), userID(t, sqlDB, "bob")
	seedBuiltin(t, sqlDB, validManifest("qinqin-flashcards", ""))
	e.aliceWS = createWorkspace(t, ts.URL, e.alice, "zh", "")
	e.aliceWS2 = createWorkspace(t, ts.URL, e.alice, "zh", "second")
	e.bWS = createWorkspace(t, ts.URL, e.bob, "zh", "")
	return e
}

func dataURL(key string, ws int64) string {
	return "/api/plugins/qinqin-flashcards/data/" + key + "?workspace=" + strconv.FormatInt(ws, 10)
}

func listURL(prefix string, ws int64) string {
	return "/api/plugins/qinqin-flashcards/data?workspace=" + strconv.FormatInt(ws, 10) + "&prefix=" + prefix
}

// leftover stores a qinqin-flashcards plugin row the way a v0.3.0 server
// left it (the migration could not read it, or an old server wrote it).
func leftover(t *testing.T, sqlDB *sql.DB, user, ws int64, key, data string) {
	t.Helper()
	if _, err := sqlDB.Exec(`INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at)
		VALUES ('qinqin-flashcards', ?, ?, ?, ?, 4, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`, user, ws, key, data); err != nil {
		t.Fatal(err)
	}
}

func countRows(t *testing.T, sqlDB *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	if err := sqlDB.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func jsonValuesEqual(t *testing.T, a, b []byte) bool {
	t.Helper()
	var x, y any
	if err := json.Unmarshal(a, &x); err != nil {
		t.Fatalf("decode %s: %v", a, err)
	}
	if err := json.Unmarshal(b, &y); err != nil {
		t.Fatalf("decode %s: %v", b, err)
	}
	ja, _ := json.Marshal(x)
	jb, _ := json.Marshal(y)
	return string(ja) == string(jb)
}

const legacyCard = `{"id":"c-vocab-1201","kind":"vocab","entryId":1201,"deckIds":["general"],"createdAt":"2026-11-10T08:00:00Z"}`

func TestLegacyPutWritesTheTypedTable(t *testing.T) {
	e := newLegacyEnv(t)
	resp := doRaw(t, http.MethodPut, e.url, dataURL("card:c-vocab-1201", e.aliceWS), e.alice, legacyCard)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT card: %d %s", resp.StatusCode, readAll(t, resp))
	}
	var d pluginDataBody
	decodeJSON(t, resp, &d)
	if d.PluginID != "qinqin-flashcards" || d.Key != "card:c-vocab-1201" || d.WorkspaceID == nil || *d.WorkspaceID != e.aliceWS ||
		d.Version != 1 || d.UserID != e.aliceID || !jsonValuesEqual(t, d.Data, []byte(legacyCard)) {
		t.Errorf("PUT response %+v %s", d, d.Data)
	}
	// One storage: the typed table holds it, plugin_data does not.
	if n := countRows(t, e.db, `SELECT COUNT(*) FROM study_cards WHERE user_id = ? AND workspace_id = ? AND id = 'c-vocab-1201'`, e.aliceID, e.aliceWS); n != 1 {
		t.Errorf("study_cards rows %d, want 1", n)
	}
	if n := countRows(t, e.db, `SELECT COUNT(*) FROM plugin_data WHERE key = 'card:c-vocab-1201'`); n != 0 {
		t.Errorf("plugin_data rows %d, want 0", n)
	}
	// A changed card bumps the version; the response is the legacy row.
	moved := `{"id":"c-vocab-1201","kind":"vocab","entryId":1201,"deckIds":["general","d-1"],"createdAt":"2026-11-10T08:00:00Z"}`
	resp = doRaw(t, http.MethodPut, e.url, dataURL("card:c-vocab-1201", e.aliceWS), e.alice, moved)
	decodeJSON(t, resp, &d)
	if resp.StatusCode != http.StatusOK || d.Version != 2 || !jsonValuesEqual(t, d.Data, []byte(moved)) {
		t.Errorf("re-PUT: %d %+v", resp.StatusCode, d)
	}
	// The same content again changes nothing (version stays).
	resp = doRaw(t, http.MethodPut, e.url, dataURL("card:c-vocab-1201", e.aliceWS), e.alice, moved)
	decodeJSON(t, resp, &d)
	if resp.StatusCode != http.StatusOK || d.Version != 2 {
		t.Errorf("equal re-PUT: %d version %d, want 200 version 2", resp.StatusCode, d.Version)
	}
	// Every family goes to its table.
	for key, body := range map[string]string{
		"deck:d-1":         `{"id":"d-1","name":"Words","createdAt":"2026-11-10T08:00:00Z"}`,
		"deckcfg:d-1":      `{"deckId":"d-1","cardTypes":["reverse"],"newOrder":{"by":"frequency"},"updatedAt":"2026-11-10T08:00:00Z"}`,
		"limits:workspace": `{"version":1,"new":{"limit":10}}`,
		"limits:deck:d-1":  `{"version":1,"reviews":{"limit":null}}`,
		"fsrs:set:s-1":     `{"id":"s-1","w":[0.2,1.2,3.1,15.6,7.2,0.5,1.4,0.005,1.5,0.1,1,1.9,0.1,0.3,2.3,0.2,3,0.5,0.6,0.1,0.5],"createdAt":"2026-11-10T08:00:00Z","source":"imported"}`,
		"fsrs:active":      `{"setId":"s-1","changedAt":"2026-11-10T08:00:00Z"}`,
	} {
		if resp := doRaw(t, http.MethodPut, e.url, dataURL(key, e.aliceWS), e.alice, body); resp.StatusCode != http.StatusOK {
			t.Errorf("PUT %s: %d %s", key, resp.StatusCode, readAll(t, resp))
		}
	}
	for _, table := range []string{"study_decks", "study_deck_settings", "study_fsrs_sets", "study_fsrs_active"} {
		if n := countRows(t, e.db, `SELECT COUNT(*) FROM `+table+` WHERE user_id = ?`, e.aliceID); n != 1 {
			t.Errorf("%s rows %d, want 1", table, n)
		}
	}
	if n := countRows(t, e.db, `SELECT COUNT(*) FROM study_limits WHERE user_id = ?`, e.aliceID); n != 2 {
		t.Errorf("study_limits rows %d, want 2", n)
	}
	if n := countRows(t, e.db, `SELECT COUNT(*) FROM plugin_data WHERE pack_id = 'qinqin-flashcards'`); n != 0 {
		t.Errorf("plugin_data qinqin-flashcards rows %d, want 0", n)
	}
	// deckcfg's inner updatedAt is written back from the row's edit time.
	resp = doJSON(t, http.MethodGet, e.url, dataURL("deckcfg:d-1", e.aliceWS), e.alice, nil)
	decodeJSON(t, resp, &d)
	var cfg map[string]any
	json.Unmarshal(d.Data, &cfg)
	if resp.StatusCode != http.StatusOK || cfg["deckId"] != "d-1" || cfg["updatedAt"] == nil {
		t.Errorf("GET deckcfg: %d %s", resp.StatusCode, d.Data)
	}

	// Unreadable data is refused with study_row_invalid and nothing is stored.
	for key, body := range map[string]string{
		"card:c-x":         `{"id":"c-other","kind":"vocab","entryId":1,"deckIds":[],"createdAt":"t"}`, // key/id mismatch
		"card:c-y":         `{"id":"c-y","kind":"vocab","entryId":1.5,"deckIds":[],"createdAt":"t"}`,
		"limits:workspace": `{"version":2}`,
		"fsrs:active":      `[1]`,
	} {
		resp := doRaw(t, http.MethodPut, e.url, dataURL(key, e.aliceWS), e.alice, body)
		var eb struct {
			Error string `json:"error"`
		}
		decodeJSON(t, resp, &eb)
		if resp.StatusCode != http.StatusBadRequest || eb.Error != "study_row_invalid" {
			t.Errorf("PUT unreadable %s: %d %q, want 400 study_row_invalid", key, resp.StatusCode, eb.Error)
		}
	}
	if n := countRows(t, e.db, `SELECT COUNT(*) FROM plugin_data WHERE pack_id = 'qinqin-flashcards'`); n != 0 {
		t.Errorf("an unreadable PUT reached plugin_data (%d rows)", n)
	}
	// A typed key without a workspace has no typed home: refused alike.
	resp = doRaw(t, http.MethodPut, e.url, "/api/plugins/qinqin-flashcards/data/card:c-vocab-1201", e.alice, legacyCard)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("PUT a user-global card: %d, want 400", resp.StatusCode)
	}
	// Keyed rows of the study namespace stay plugin data.
	if resp := doRaw(t, http.MethodPut, e.url, dataURL("known:5", e.aliceWS), e.alice, `{"at":"2026-11-10T08:00:00Z"}`); resp.StatusCode != http.StatusOK {
		t.Errorf("PUT known: %d", resp.StatusCode)
	}
	if n := countRows(t, e.db, `SELECT COUNT(*) FROM plugin_data WHERE key = 'known:5'`); n != 1 {
		t.Errorf("known:5 plugin rows %d, want 1", n)
	}
}

func TestLegacyGetAndList(t *testing.T) {
	e := newLegacyEnv(t)
	put := func(key, body string) {
		t.Helper()
		if resp := doRaw(t, http.MethodPut, e.url, dataURL(key, e.aliceWS), e.alice, body); resp.StatusCode != http.StatusOK {
			t.Fatalf("PUT %s: %d %s", key, resp.StatusCode, readAll(t, resp))
		}
	}
	put("card:c-vocab-1201", legacyCard)
	put("card:c-vocab-1300", `{"id":"c-vocab-1300","kind":"vocab","entryId":1300,"deckIds":[],"createdAt":"2026-11-10T08:00:00Z"}`)
	put("known:5", `{"at":"t"}`)
	// Leftovers: one only plugin_data holds (unreadable: no createdAt), one
	// shadowed by the typed row of the same key.
	leftover(t, e.db, e.aliceID, e.aliceWS, "card:c-old", `{"id":"c-old","kind":"vocab","entryId":7,"deckIds":[]}`)
	leftover(t, e.db, e.aliceID, e.aliceWS, "card:c-vocab-1300", `{"id":"c-vocab-1300","kind":"vocab","entryId":1300,"deckIds":["SHADOWED"],"createdAt":"t"}`)

	var d pluginDataBody
	resp := doJSON(t, http.MethodGet, e.url, dataURL("card:c-vocab-1201", e.aliceWS), e.alice, nil)
	decodeJSON(t, resp, &d)
	if resp.StatusCode != http.StatusOK || d.Key != "card:c-vocab-1201" || d.Version != 1 || !jsonValuesEqual(t, d.Data, []byte(legacyCard)) {
		t.Errorf("GET typed card: %d %+v", resp.StatusCode, d)
	}
	resp = doJSON(t, http.MethodGet, e.url, dataURL("card:c-old", e.aliceWS), e.alice, nil)
	decodeJSON(t, resp, &d)
	if resp.StatusCode != http.StatusOK || d.Version != 4 || string(d.Data) != `{"id":"c-old","kind":"vocab","entryId":7,"deckIds":[]}` {
		t.Errorf("GET leftover: %d %+v", resp.StatusCode, d)
	}
	resp = doJSON(t, http.MethodGet, e.url, dataURL("card:c-vocab-1300", e.aliceWS), e.alice, nil)
	decodeJSON(t, resp, &d)
	if resp.StatusCode != http.StatusOK || d.Version != 1 || string(d.Data) == "" || jsonValuesEqual(t, d.Data, []byte(`{"id":"c-vocab-1300","kind":"vocab","entryId":1300,"deckIds":["SHADOWED"],"createdAt":"t"}`)) {
		t.Errorf("GET shadowed key: %d %+v, want the typed row", resp.StatusCode, d)
	}
	if resp := doJSON(t, http.MethodGet, e.url, dataURL("card:nothing", e.aliceWS), e.alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("GET absent card: %d, want 404", resp.StatusCode)
	}
	// Another workspace of the same user holds none of them.
	if resp := doJSON(t, http.MethodGet, e.url, dataURL("card:c-vocab-1201", e.aliceWS2), e.alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("GET card in the other workspace: %d, want 404", resp.StatusCode)
	}

	var list []pluginDataBody
	resp = doJSON(t, http.MethodGet, e.url, listURL("card:", e.aliceWS), e.alice, nil)
	decodeJSON(t, resp, &list)
	keys := []string{}
	for _, r := range list {
		keys = append(keys, r.Key)
		if r.Key == "card:c-vocab-1300" && r.Version != 1 {
			t.Errorf("listed shadowed key from plugin_data: %+v", r)
		}
	}
	if want := []string{"card:c-old", "card:c-vocab-1201", "card:c-vocab-1300"}; !equalStrings(keys, want) {
		t.Errorf("list card: keys %v, want %v", keys, want)
	}
	// No prefix lists every key of the workspace, typed and keyed, in key order.
	resp = doJSON(t, http.MethodGet, e.url, listURL("", e.aliceWS), e.alice, nil)
	decodeJSON(t, resp, &list)
	keys = keys[:0]
	for _, r := range list {
		keys = append(keys, r.Key)
	}
	if want := []string{"card:c-old", "card:c-vocab-1201", "card:c-vocab-1300", "known:5"}; !equalStrings(keys, want) {
		t.Errorf("list all: keys %v, want %v", keys, want)
	}
	// A prefix inside a family name, and one no typed key has.
	resp = doJSON(t, http.MethodGet, e.url, listURL("card:c-vocab-12", e.aliceWS), e.alice, nil)
	decodeJSON(t, resp, &list)
	if len(list) != 1 || list[0].Key != "card:c-vocab-1201" {
		t.Errorf("list card:c-vocab-12: %+v", list)
	}
	resp = doJSON(t, http.MethodGet, e.url, listURL("deck:", e.aliceWS), e.alice, nil)
	if body := readAll(t, resp); body != "[]\n" && body != "[]" {
		t.Errorf("list deck: %q, want []", body)
	}
	// A tombstoned typed row is not listed and still shadows its leftover.
	if resp := doJSON(t, http.MethodDelete, e.url, dataURL("card:c-vocab-1300", e.aliceWS), e.alice, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE: %d", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodGet, e.url, dataURL("card:c-vocab-1300", e.aliceWS), e.alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("GET tombstoned typed key: %d, want 404 (the leftover stays shadowed)", resp.StatusCode)
	}
	resp = doJSON(t, http.MethodGet, e.url, listURL("card:", e.aliceWS), e.alice, nil)
	decodeJSON(t, resp, &list)
	if len(list) != 2 {
		t.Errorf("list after delete: %+v", list)
	}
}

func TestLegacyDelete(t *testing.T) {
	e := newLegacyEnv(t)
	if resp := doRaw(t, http.MethodPut, e.url, dataURL("card:c-vocab-1201", e.aliceWS), e.alice, legacyCard); resp.StatusCode != http.StatusOK {
		t.Fatal(resp.StatusCode)
	}
	leftover(t, e.db, e.aliceID, e.aliceWS, "card:c-old", `{"id":"c-old"}`)
	// DELETE tombstones the typed row, keeping its data and bumping version.
	if resp := doJSON(t, http.MethodDelete, e.url, dataURL("card:c-vocab-1201", e.aliceWS), e.alice, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE typed: %d", resp.StatusCode)
	}
	var version int
	var deleted sql.NullString
	if err := e.db.QueryRow(`SELECT version, deleted_at FROM study_cards WHERE user_id = ? AND id = 'c-vocab-1201'`, e.aliceID).Scan(&version, &deleted); err != nil ||
		version != 2 || !deleted.Valid {
		t.Errorf("tombstone: version %d deleted %v err %v", version, deleted, err)
	}
	if resp := doJSON(t, http.MethodDelete, e.url, dataURL("card:c-vocab-1201", e.aliceWS), e.alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("re-DELETE typed: %d, want 404", resp.StatusCode)
	}
	// A key only a leftover holds: the plugin row is tombstoned, as before.
	if resp := doJSON(t, http.MethodDelete, e.url, dataURL("card:c-old", e.aliceWS), e.alice, nil); resp.StatusCode != http.StatusNoContent {
		t.Errorf("DELETE leftover: %d", resp.StatusCode)
	}
	if n := countRows(t, e.db, `SELECT COUNT(*) FROM plugin_data WHERE key = 'card:c-old' AND deleted_at IS NOT NULL`); n != 1 {
		t.Errorf("leftover not tombstoned")
	}
	if resp := doJSON(t, http.MethodDelete, e.url, dataURL("deck:none", e.aliceWS), e.alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("DELETE absent: %d, want 404", resp.StatusCode)
	}
	// A PUT revives the tombstone.
	resp := doRaw(t, http.MethodPut, e.url, dataURL("card:c-vocab-1201", e.aliceWS), e.alice, legacyCard)
	var d pluginDataBody
	decodeJSON(t, resp, &d)
	if resp.StatusCode != http.StatusOK || d.Version != 3 {
		t.Errorf("revive: %d %+v", resp.StatusCode, d)
	}
}

// Two users: bob never reads, lists, writes or deletes alice's typed rows;
// alice's workspace in bob's request is 404 with nothing changed.
func TestLegacyRoutesIsolation(t *testing.T) {
	e := newLegacyEnv(t)
	if resp := doRaw(t, http.MethodPut, e.url, dataURL("card:c-vocab-1201", e.aliceWS), e.alice, legacyCard); resp.StatusCode != http.StatusOK {
		t.Fatal(resp.StatusCode)
	}
	for _, m := range []string{http.MethodGet, http.MethodDelete} {
		if resp := doJSON(t, m, e.url, dataURL("card:c-vocab-1201", e.aliceWS), e.bob, nil); resp.StatusCode != http.StatusNotFound {
			t.Errorf("bob %s alice's workspace: %d, want 404", m, resp.StatusCode)
		}
		if resp := doJSON(t, m, e.url, dataURL("card:c-vocab-1201", e.bWS), e.bob, nil); resp.StatusCode != http.StatusNotFound {
			t.Errorf("bob %s in his workspace: %d, want 404", m, resp.StatusCode)
		}
	}
	if resp := doJSON(t, http.MethodGet, e.url, listURL("card:", e.aliceWS), e.bob, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("bob lists alice's workspace: %d, want 404", resp.StatusCode)
	}
	resp := doJSON(t, http.MethodGet, e.url, listURL("card:", e.bWS), e.bob, nil)
	if body := readAll(t, resp); body != "[]\n" && body != "[]" {
		t.Errorf("bob's own list: %q, want []", body)
	}
	other := `{"id":"c-vocab-1201","kind":"vocab","entryId":1201,"deckIds":["bob"],"createdAt":"2026-11-10T08:00:00Z"}`
	if resp := doRaw(t, http.MethodPut, e.url, dataURL("card:c-vocab-1201", e.aliceWS), e.bob, other); resp.StatusCode != http.StatusNotFound {
		t.Errorf("bob PUTs into alice's workspace: %d, want 404", resp.StatusCode)
	}
	// Bob's own card of the same id is his row; alice's is untouched.
	if resp := doRaw(t, http.MethodPut, e.url, dataURL("card:c-vocab-1201", e.bWS), e.bob, other); resp.StatusCode != http.StatusOK {
		t.Errorf("bob PUTs his card: %d", resp.StatusCode)
	}
	var d pluginDataBody
	resp = doJSON(t, http.MethodGet, e.url, dataURL("card:c-vocab-1201", e.aliceWS), e.alice, nil)
	decodeJSON(t, resp, &d)
	if d.Version != 1 || !jsonValuesEqual(t, d.Data, []byte(legacyCard)) || d.UserID != e.aliceID {
		t.Errorf("alice's card after bob's writes: %+v", d)
	}
	if n := countRows(t, e.db, `SELECT COUNT(*) FROM study_cards WHERE user_id = ?`, e.bobID); n != 1 {
		t.Errorf("bob's cards %d, want 1", n)
	}
	if resp := doJSON(t, http.MethodGet, e.url, dataURL("card:c-vocab-1201", e.aliceWS), "", nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no session: %d, want 401", resp.StatusCode)
	}
}

// Personal access tokens keep the plugin-data rules on the legacy view.
func TestLegacyRoutesTokens(t *testing.T) {
	e := newLegacyEnv(t)
	if resp := doRaw(t, http.MethodPut, e.url, dataURL("card:c-vocab-1201", e.aliceWS), e.alice, legacyCard); resp.StatusCode != http.StatusOK {
		t.Fatal(resp.StatusCode)
	}
	mint := func(scope string, ws *int64) string {
		t.Helper()
		secret, _, err := auth.CreateToken(context.Background(), e.db, e.aliceID, auth.TokenRequest{Name: "n", Scope: scope, ExpiresInDays: 30, WorkspaceID: ws})
		if err != nil {
			t.Fatal(err)
		}
		return secret
	}
	read, write, bound := mint("read", nil), mint("write", nil), mint("write", &e.aliceWS2)
	code := func(resp *http.Response) string {
		var eb struct {
			Error string `json:"error"`
		}
		json.NewDecoder(resp.Body).Decode(&eb)
		return eb.Error
	}
	resp := doJSON(t, http.MethodGet, e.url, dataURL("card:c-vocab-1201", e.aliceWS), read, nil)
	var d pluginDataBody
	decodeJSON(t, resp, &d)
	if resp.StatusCode != http.StatusOK || d.Key != "card:c-vocab-1201" {
		t.Errorf("read token GET: %d %+v", resp.StatusCode, d)
	}
	resp = doRaw(t, http.MethodPut, e.url, dataURL("card:c-vocab-1201", e.aliceWS), read, legacyCard)
	if c := code(resp); resp.StatusCode != http.StatusForbidden || c != "token_read_only" {
		t.Errorf("read token PUT: %d %q", resp.StatusCode, c)
	}
	resp = doJSON(t, http.MethodDelete, e.url, dataURL("card:c-vocab-1201", e.aliceWS), read, nil)
	if c := code(resp); resp.StatusCode != http.StatusForbidden || c != "token_read_only" {
		t.Errorf("read token DELETE: %d %q", resp.StatusCode, c)
	}
	resp = doJSON(t, http.MethodGet, e.url, dataURL("card:c-vocab-1201", e.aliceWS), bound, nil)
	if c := code(resp); resp.StatusCode != http.StatusForbidden || c != "token_workspace" {
		t.Errorf("bound token on another workspace: %d %q", resp.StatusCode, c)
	}
	resp = doRaw(t, http.MethodPut, e.url, dataURL("card:c-vocab-1201", e.aliceWS2), bound, legacyCard)
	if resp.StatusCode != http.StatusOK {
		t.Errorf("bound token PUT in its workspace: %d", resp.StatusCode)
	}
	moved := `{"id":"c-vocab-1201","kind":"vocab","entryId":1201,"deckIds":["x"],"createdAt":"2026-11-10T08:00:00Z"}`
	resp = doRaw(t, http.MethodPut, e.url, dataURL("card:c-vocab-1201", e.aliceWS), write, moved)
	decodeJSON(t, resp, &d)
	if resp.StatusCode != http.StatusOK || d.Version != 2 {
		t.Errorf("write token PUT: %d %+v", resp.StatusCode, d)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
