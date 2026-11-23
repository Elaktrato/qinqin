package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// docs/contracts/events/envelope.json through POST /api/events/batch,
// GET /api/events and the pull v2 events collection: how the server stores
// and returns a study event, pinned as built.

type envelopeStep struct {
	Post   json.RawMessage `json:"post"`
	List   *string         `json:"list"`
	Pull   bool            `json:"pull"`
	Expect struct {
		Status int             `json:"status"`
		JSON   json.RawMessage `json:"json"`
		Error  string          `json:"error"`
		IDs    []string        `json:"ids"`
		Types  []string        `json:"types"`
	} `json:"expect"`
}

type envelopeCase struct {
	Name   string            `json:"name"`
	Note   string            `json:"note"`
	Steps  []envelopeStep    `json:"steps"`
	Stored []json.RawMessage `json:"stored"`
}

// storedEvent is the part of a GET /api/events item the fixture pins.
type storedEvent struct {
	ID          string          `json:"id"`
	WorkspaceID json.RawMessage `json:"workspaceId"`
	Device      string          `json:"device"`
	TS          string          `json:"ts"`
	Type        string          `json:"type"`
	Payload     json.RawMessage `json:"payload"`
}

func TestContractEventEnvelope(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/events/envelope.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Rule   string `json:"rule"`
		Limits struct {
			BodyBytes int `json:"bodyBytes"`
		} `json:"limits"`
		Cases []envelopeCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if file.Rule != "events/envelope" || len(file.Cases) == 0 {
		t.Fatalf("rule %q, %d cases", file.Rule, len(file.Cases))
	}
	if file.Limits.BodyBytes != 4<<20 {
		t.Errorf("bodyBytes %d, server 4 MiB", file.Limits.BodyBytes)
	}
	for _, c := range file.Cases {
		t.Run(c.Name, func(t *testing.T) {
			if c.Note == "" {
				t.Error("case without note")
			}
			ts, sqlDB := newServer(t)
			alice := registerUser(t, ts.URL, "alice", "")
			bob := registerUser(t, ts.URL, "bob", alice)
			ws := createWorkspace(t, ts.URL, alice, "zh", "Chinese")
			bobWS := createWorkspace(t, ts.URL, bob, "zh", "Chinese")
			aliceID := syncUserID(t, ts.URL, alice)
			expand := func(s string) string {
				s = expandPush(s, ws, bobWS)
				s = strings.ReplaceAll(s, "$bobWs", strconv.FormatInt(bobWS, 10))
				return strings.ReplaceAll(s, "$ws", strconv.FormatInt(ws, 10))
			}
			for i, st := range c.Steps {
				var (
					status int
					body   []byte
				)
				switch {
				case st.Post != nil:
					req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/events/batch", strings.NewReader(expand(string(st.Post))))
					req.Header.Set("Authorization", "Bearer "+alice)
					req.Header.Set("Content-Type", "application/json")
					resp, err := http.DefaultClient.Do(req)
					if err != nil {
						t.Fatal(err)
					}
					body, _ = io.ReadAll(resp.Body)
					resp.Body.Close()
					status = resp.StatusCode
				case st.List != nil:
					status, _, body = get(t, ts.URL, "/api/events"+expand(*st.List), alice)
				case st.Pull:
					// A round ships rows stamped before its first second.
					if _, err := sqlDB.Exec(`UPDATE study_events SET updated_at = '2026-01-01T00:00:00Z'`); err != nil {
						t.Fatal(err)
					}
					status, _, body = get(t, ts.URL, "/api/sync/pull?v=2&collections=events", alice)
				default:
					t.Fatalf("step %d: no post, list or pull", i)
				}
				if status != st.Expect.Status {
					t.Fatalf("step %d: status %d, want %d: %.300s", i, status, st.Expect.Status, body)
				}
				if st.Expect.JSON != nil && !jsonValueEqual(body, []byte(expand(string(st.Expect.JSON)))) {
					t.Errorf("step %d: body %s, want %s", i, body, st.Expect.JSON)
				}
				if st.Expect.Error != "" {
					if got := errorCode(t, body); got != st.Expect.Error {
						t.Errorf("step %d: body %s, want error %q", i, body, st.Expect.Error)
					}
				}
				if st.Expect.IDs != nil {
					var list []storedEvent
					if err := json.Unmarshal(body, &list); err != nil {
						t.Fatalf("step %d: %v", i, err)
					}
					ids := []string{}
					for _, e := range list {
						ids = append(ids, e.ID)
					}
					if !slices.Equal(ids, st.Expect.IDs) {
						t.Errorf("step %d: ids %v, want %v", i, ids, st.Expect.IDs)
					}
				}
				if st.Expect.Types != nil {
					var page v2Page
					if err := json.Unmarshal(body, &page); err != nil {
						t.Fatalf("step %d: %v", i, err)
					}
					types := []string{}
					for _, row := range page.Collections["events"] {
						var e storedEvent
						json.Unmarshal(row, &e)
						types = append(types, e.Type)
					}
					if !slices.Equal(types, st.Expect.Types) {
						t.Errorf("step %d: pulled types %v, want %v", i, types, st.Expect.Types)
					}
				}
			}

			// What the server holds afterwards, as GET /api/events returns it.
			_, _, body := get(t, ts.URL, "/api/events", alice)
			var got []json.RawMessage
			if err := json.Unmarshal(body, &got); err != nil {
				t.Fatal(err)
			}
			if len(got) != len(c.Stored) {
				t.Fatalf("stored %d events, want %d: %s", len(got), len(c.Stored), body)
			}
			for i := range got {
				var g struct {
					storedEvent
					UserID int64 `json:"userId"`
				}
				var w storedEvent
				json.Unmarshal(got[i], &g)
				if err := json.Unmarshal([]byte(expand(string(c.Stored[i]))), &w); err != nil {
					t.Fatal(err)
				}
				if g.UserID != aliceID {
					t.Errorf("event %d: userId %d, want the caller %d", i, g.UserID, aliceID)
				}
				if g.ID != w.ID || g.Device != w.Device || g.TS != w.TS || g.Type != w.Type ||
					string(g.WorkspaceID) != string(w.WorkspaceID) || !jsonValueEqual(g.Payload, w.Payload) {
					t.Errorf("event %d: got %s, want %s", i, got[i], c.Stored[i])
				}
				// The payload comes back compact, byte for byte.
				if string(g.Payload) != string(compactJSON(t, w.Payload)) {
					t.Errorf("event %d: payload bytes %s, want %s", i, g.Payload, compactJSON(t, w.Payload))
				}
			}
			// Bob sees none of it.
			_, _, body = get(t, ts.URL, "/api/events", bob)
			if strings.TrimSpace(string(body)) != "[]" {
				t.Errorf("bob sees %s", body)
			}
		})
	}
}

func compactJSON(t *testing.T, raw json.RawMessage) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := json.Compact(&b, raw); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
