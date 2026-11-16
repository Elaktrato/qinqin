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
	"slices"
	"strings"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/model"
	"qinqin/internal/plugins"
	chinsync "qinqin/internal/sync"
)

var studyCollections = []string{"cards", "decks", "deckSettings", "limits", "fsrsSets", "fsrsActive"}

const weights = `[0.212,1.2931,2.3065,8.2956,6.4133,0.8334,3.0194,0.001,1.8722,0.1666,0.796,1.4835,0.0614,0.2629,1.6483,0.6014,1.8729,0.5425,0.0912,0.0658,0.1542]`

// typedItem is one wire row of collection c for workspace ws, edited at at.
func typedItem(c string, ws int64, id string, at time.Time) json.RawMessage {
	meta := fmt.Sprintf(`"workspaceId":%d,"updatedAt":%q,"extra":{}`, ws, at.UTC().Format(time.RFC3339))
	body := map[string]string{
		"cards":        `"id":"` + id + `","kind":"vocab","entryId":1201,"written":null,"entryKind":null,"sentenceId":null,"skipKinds":[],"deckIds":["general"],"createdAt":"t"`,
		"decks":        `"id":"` + id + `","name":"Words","createdAt":"t","source":{"type":"level","packId":"hsk","level":"1"}`,
		"deckSettings": `"deckId":"` + id + `","cardTypes":["reverse"],"newOrder":{"by":"frequency"}`,
		"limits":       `"deckId":"` + id + `","new":{"limit":5},"reviews":null`,
		"fsrsSets":     `"id":"` + id + `","w":` + weights + `,"createdAt":"t","source":"imported","labelled":null,"logLoss":null,"baselineLogLoss":null`,
		"fsrsActive":   `"setId":"` + id + `","changedAt":"t"`,
	}[c]
	return json.RawMessage("{" + body + "," + meta + "}")
}

func typedBody(c string, items ...json.RawMessage) chinsync.PushBody {
	var b chinsync.PushBody
	switch c {
	case "cards":
		b.Cards = items
	case "decks":
		b.Decks = items
	case "deckSettings":
		b.DeckSettings = items
	case "limits":
		b.Limits = items
	case "fsrsSets":
		b.FsrsSets = items
	case "fsrsActive":
		b.FsrsActive = items
	}
	return b
}

func typedCount(d chinsync.Delta, c string) int {
	return map[string]int{"cards": len(d.Cards), "decks": len(d.Decks), "deckSettings": len(d.DeckSettings),
		"limits": len(d.Limits), "fsrsSets": len(d.FsrsSets), "fsrsActive": len(d.FsrsActive)}[c]
}

func TestTypedCollectionNames(t *testing.T) {
	for _, c := range studyCollections {
		if !slices.Contains(chinsync.Collections, c) {
			t.Errorf("Collections lacks %s", c)
		}
		if only, err := chinsync.ParseCollections(c); err != nil || !only[c] {
			t.Errorf("ParseCollections(%s) = %v, %v", c, only, err)
		}
	}
	for _, bad := range []string{"card", "Cards", "pluginData,deck"} {
		if _, err := chinsync.ParseCollections(bad); !errors.Is(err, chinsync.ErrInvalid) {
			t.Errorf("ParseCollections(%q) err = %v, want ErrInvalid", bad, err)
		}
	}
}

// Every typed collection: push applies with last-write-wins and counts,
// a retry is skipped, a pull of that collection returns only it, and the
// other user never sees the rows.
func TestPushAndPullEachTypedCollection(t *testing.T) {
	ctx := context.Background()
	for _, c := range studyCollections {
		t.Run(c, func(t *testing.T) {
			sqlDB := newDB(t)
			alice, bob := newUser(t, sqlDB, "alice"), newUser(t, sqlDB, "bob")
			ws, bobWS := newWorkspace(t, sqlDB, alice), newWorkspace(t, sqlDB, bob)
			at := time.Now().UTC().Add(-time.Minute)
			res, err := chinsync.Push(ctx, sqlDB, alice, typedBody(c, typedItem(c, ws, "x1", at)))
			if err != nil || res.DataAccepted != 1 || res.DataSkipped != 0 {
				t.Fatalf("push = %+v, %v; want 1 accepted", res, err)
			}
			res, err = chinsync.Push(ctx, sqlDB, alice, typedBody(c, typedItem(c, ws, "x1", at.Add(time.Second))))
			if err != nil || res.DataAccepted != 0 || res.DataSkipped != 1 {
				t.Fatalf("equal retry = %+v, %v; want 1 skipped", res, err)
			}
			res, err = chinsync.Push(ctx, sqlDB, alice, typedBody(c, typedItem(c, ws, "x1", at.Add(-time.Hour))))
			if err != nil || res.DataSkipped != 1 {
				t.Fatalf("older push = %+v, %v; want skipped", res, err)
			}
			if _, err := chinsync.Push(ctx, sqlDB, bob, typedBody(c, typedItem(c, bobWS, "b1", at))); err != nil {
				t.Fatal(err)
			}
			only, _ := chinsync.ParseCollections(c)
			d, err := chinsync.Pull(ctx, sqlDB, alice, time.Time{}, only)
			if err != nil {
				t.Fatal(err)
			}
			for _, other := range studyCollections {
				want := 0
				if other == c {
					want = 1
				}
				if n := typedCount(d, other); n != want {
					t.Errorf("pull %s: %s has %d rows, want %d", c, other, n, want)
				}
			}
			if len(d.PluginData) != 0 {
				t.Errorf("pull %s shipped pluginData %+v", c, d.PluginData)
			}
			// Bob's full pull holds only his row.
			d, _ = chinsync.Pull(ctx, sqlDB, bob, time.Time{}, nil)
			raw, _ := json.Marshal(d)
			if typedCount(d, c) != 1 || bytes.Contains(raw, []byte(`"x1"`)) || bytes.Contains(raw, []byte(fmt.Sprintf(`"workspaceId":%d`, ws))) {
				t.Errorf("bob's pull: %s", raw)
			}
			// A tombstone ships from a non-zero cursor only.
			del := at.Add(time.Second)
			item := strings.Replace(string(typedItem(c, ws, "x1", at.Add(time.Second))), `"extra":{}`, `"extra":{},"deletedAt":"`+del.Format(time.RFC3339)+`"`, 1)
			if res, err := chinsync.Push(ctx, sqlDB, alice, typedBody(c, json.RawMessage(item))); err != nil || res.DataAccepted != 1 {
				t.Fatalf("tombstone push = %+v, %v", res, err)
			}
			if d, _ := chinsync.Pull(ctx, sqlDB, alice, time.Time{}, only); typedCount(d, c) != 0 {
				t.Errorf("zero-cursor pull shipped a tombstone")
			}
			if d, _ := chinsync.Pull(ctx, sqlDB, alice, time.Unix(0, 0), only); typedCount(d, c) != 1 {
				t.Errorf("1970 pull lacks the tombstone")
			}
		})
	}
}

func eventItem(id string, ws int64) model.StudyEvent {
	return model.StudyEvent{ID: id, WorkspaceID: ws, Device: "d", TS: time.Now().UTC(), Type: "review", Payload: json.RawMessage(`{}`)}
}

// registerReserved registers the built-in registry rows, as the server does
// at startup.
func registerReserved(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	for _, raw := range plugins.Builtin() {
		if _, err := plugins.RegisterBuiltin(context.Background(), sqlDB, raw); err != nil {
			t.Fatal(err)
		}
	}
}

// A malformed typed item or a foreign workspace refuses the whole push.
func TestTypedPushIsAllOrNothing(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	alice, bob := newUser(t, sqlDB, "alice"), newUser(t, sqlDB, "bob")
	ws, bobWS := newWorkspace(t, sqlDB, alice), newWorkspace(t, sqlDB, bob)
	now := time.Now().UTC()
	count := func() (n int) {
		for _, tb := range []string{"study_events", "study_cards", "study_decks", "study_deck_settings", "study_limits", "study_fsrs_sets", "study_fsrs_active"} {
			var c int
			sqlDB.QueryRow(`SELECT COUNT(*) FROM ` + tb).Scan(&c)
			n += c
		}
		return n
	}
	for _, c := range studyCollections {
		bad := strings.Replace(string(typedItem(c, ws, "x", now)), `"extra":{}`, `"extra":[]`, 1)
		body := typedBody(c, typedItem(c, ws, "ok", now), json.RawMessage(bad))
		body.Events = []model.StudyEvent{eventItem("01J00000000000000000000001", ws)}
		if _, err := chinsync.Push(ctx, sqlDB, alice, body); !errors.Is(err, chinsync.ErrInvalid) {
			t.Errorf("%s: malformed item err = %v, want ErrInvalid", c, err)
		}
		body = typedBody(c, typedItem(c, ws, "ok", now), typedItem(c, bobWS, "x", now))
		body.Events = []model.StudyEvent{eventItem("01J00000000000000000000001", ws)}
		if _, err := chinsync.Push(ctx, sqlDB, alice, body); !errors.Is(err, chinsync.ErrNotFound) {
			t.Errorf("%s: foreign workspace err = %v, want ErrNotFound", c, err)
		}
		if _, err := chinsync.Push(ctx, sqlDB, alice, typedBody(c, typedItem(c, 999999, "x", now))); !errors.Is(err, chinsync.ErrNotFound) {
			t.Errorf("%s: unknown workspace err = %v, want ErrNotFound", c, err)
		}
	}
	if n := count(); n != 0 {
		t.Errorf("refused pushes stored %d rows", n)
	}
}

// One push carries events, keyed plugin rows and typed rows.
func TestMixedPush(t *testing.T) {
	ctx := context.Background()
	sqlDB := newDB(t)
	alice := newUser(t, sqlDB, "alice")
	ws := newWorkspace(t, sqlDB, alice)
	registerReserved(t, sqlDB)
	now := time.Now().UTC()
	body := chinsync.PushBody{
		Events:     []model.StudyEvent{eventItem("01J00000000000000000000002", ws)},
		PluginData: []model.PluginData{{PluginID: "qinqin-flashcards", WorkspaceID: &ws, Key: "known:5", Data: json.RawMessage(`{"at":"t"}`), UpdatedAt: now}},
		Cards:      []json.RawMessage{typedItem("cards", ws, "c-vocab-1201", now)},
		Decks:      []json.RawMessage{typedItem("decks", ws, "d1", now)},
	}
	res, err := chinsync.Push(ctx, sqlDB, alice, body)
	if err != nil || res.EventsAccepted != 1 || res.DataAccepted != 3 {
		t.Fatalf("mixed push = %+v, %v; want 1 event and 3 data rows", res, err)
	}
	d, _ := chinsync.Pull(ctx, sqlDB, alice, time.Time{}, nil)
	if len(d.Cards) != 1 || len(d.Decks) != 1 || len(d.PluginData) != 1 || d.PluginData[0].Key != "known:5" {
		t.Errorf("pull after mixed push: cards %d decks %d pluginData %+v", len(d.Cards), len(d.Decks), d.PluginData)
	}
}

// The pull over HTTP carries every typed collection key, as [] when empty.
func TestTypedCollectionsOverHTTP(t *testing.T) {
	sqlDB := newDB(t)
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil))
	t.Cleanup(ts.Close)
	token := registerAndLogin(t, ts.URL)
	call := func(method, path, body string) *http.Response {
		req, _ := http.NewRequest(method, ts.URL+path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}
	var owner int64
	sqlDB.QueryRow(`SELECT id FROM users WHERE username = 'owner'`).Scan(&owner)
	ws := newWorkspace(t, sqlDB, owner)
	push, _ := json.Marshal(map[string]any{"cards": []json.RawMessage{typedItem("cards", ws, "c1", time.Now())}})
	resp := call(http.MethodPost, "/api/sync/push", string(push))
	var res chinsync.PushResult
	json.NewDecoder(resp.Body).Decode(&res)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || res.DataAccepted != 1 {
		t.Fatalf("push status %d %+v", resp.StatusCode, res)
	}
	resp = call(http.MethodPost, "/api/sync/push", `{"cards":[{"workspaceId":1}]}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("malformed typed push status %d, want 400", resp.StatusCode)
	}
	resp = call(http.MethodGet, "/api/sync/pull?collections=cards", "")
	var generic map[string]json.RawMessage
	json.NewDecoder(resp.Body).Decode(&generic)
	resp.Body.Close()
	for _, c := range studyCollections {
		v, ok := generic[c]
		if !ok {
			t.Errorf("pull lacks %s", c)
			continue
		}
		if c != "cards" && string(v) != "[]" {
			t.Errorf("%s = %s, want []", c, v)
		}
	}
	var cards []map[string]json.RawMessage
	json.Unmarshal(generic["cards"], &cards)
	if len(cards) != 1 {
		t.Fatalf("cards = %s", generic["cards"])
	}
	for _, k := range []string{"workspaceId", "id", "kind", "entryId", "written", "entryKind", "sentenceId", "skipKinds", "deckIds", "createdAt", "extra", "version", "updatedAt", "deletedAt"} {
		if _, ok := cards[0][k]; !ok {
			t.Errorf("card lacks %s: %s", k, generic["cards"])
		}
	}
}
