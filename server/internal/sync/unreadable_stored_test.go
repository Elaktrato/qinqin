package sync

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
)

// A stored typed row the server cannot read back (a deck source type or a
// new-card order this version does not know: written by a newer server, then
// downgraded, or damaged) is skipped by the pull, the push and the legacy
// view instead of failing them (#167 review; sync README "Reading rows").

func unreadableWorld(t *testing.T) (*world, int64, int64) {
	t.Helper()
	w := newWorld(t)
	w.addWorkspace("a", "alice", "zh", "2026-11-12T07:00:00Z")
	uid, ws := w.users["alice"], w.ws["a"]
	deck := func(id, source string, m int) {
		at := time.Date(2026, 11, 12, 8, m, 0, 0, time.UTC).Format(time.RFC3339)
		var src any
		if source != "" {
			src = source
		}
		w.exec(`INSERT INTO study_decks (user_id, workspace_id, id, name, created_at, source, extra, version, updated_at, modified_at)
			VALUES (?, ?, ?, ?, 't', ?, '{}', 1, ?, ?)`, uid, ws, id, id, src, at, at)
	}
	deck("d1", "", 0)
	deck("d2", `{"type":"course","courseId":"secret-course"}`, 1)
	deck("d3", "", 2)
	deck("d4", `{"type":"course","courseId":"secret-course"}`, 3)
	deck("d5", "", 4)
	w.exec(`INSERT INTO study_deck_settings (user_id, workspace_id, deck_id, card_types, new_order, extra, version, updated_at, modified_at)
		VALUES (?, ?, 'd1', '[]', '{"by":"difficulty"}', '{}', 1, '2026-11-12T08:05:00Z', '2026-11-12T08:05:00Z')`, uid, ws)
	return w, uid, ws
}

func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev, flags := log.Writer(), log.Flags()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(prev); log.SetFlags(flags) })
	return &buf
}

func TestPullSkipsUnreadableStoredRowsAndAdvances(t *testing.T) {
	for _, limit := range []int{1, 2, 500} {
		w, uid, _ := unreadableWorld(t)
		logs := captureLog(t)
		req := PageRequest{Only: map[string]bool{"decks": true, "deckSettings": true}, Limit: limit, Now: at("2026-11-12T10:00:00Z")}
		var decks []string
		settings := 0
		for n := 0; ; n++ {
			p, err := PullPage(context.Background(), w.db, uid, req, testCatalogue)
			if err != nil {
				t.Fatalf("limit %d page %d: %v", limit, n, err)
			}
			var items []struct {
				ID string `json:"id"`
			}
			json.Unmarshal(p.Collections["decks"], &items)
			for _, it := range items {
				decks = append(decks, it.ID)
			}
			var ss []json.RawMessage
			json.Unmarshal(p.Collections["deckSettings"], &ss)
			settings += len(ss)
			if !p.More {
				if p.Cursor == nil {
					t.Fatalf("limit %d: last page without cursor", limit)
				}
				break
			}
			if len(items)+len(ss) == 0 {
				t.Fatalf("limit %d page %d: an empty page with more", limit, n)
			}
			req = PageRequest{Page: *p.Next, Now: req.Now}
			if n > 20 {
				t.Fatal("no end")
			}
		}
		if !slices.Equal(decks, []string{"d1", "d3", "d5"}) || settings != 0 {
			t.Errorf("limit %d: decks %v settings %d, want [d1 d3 d5] and 0", limit, decks, settings)
		}
		out := logs.String()
		for _, want := range []string{"decks", `"d2"`, `"d4"`, "deckSettings", `"d1"`} {
			if !strings.Contains(out, want) {
				t.Errorf("limit %d: log %q lacks %s", limit, out, want)
			}
		}
		if strings.Contains(out, "secret-course") || strings.Contains(out, "difficulty") {
			t.Errorf("limit %d: the log carries row data: %q", limit, out)
		}
	}
}

func TestPushToAnUnreadableStoredRowIsRefusedWhole(t *testing.T) {
	w, uid, ws := unreadableWorld(t)
	at := time.Date(2026, 11, 12, 9, 0, 0, 0, time.UTC)
	item := func(id string) json.RawMessage {
		return json.RawMessage(`{"workspaceId":` + strconv.FormatInt(ws, 10) + `,"id":"` + id + `","name":"renamed","createdAt":"t","source":null,"extra":{},"updatedAt":"` + at.Format(time.RFC3339) + `"}`)
	}
	_, err := Push(context.Background(), w.db, uid, PushBody{Decks: []json.RawMessage{item("d1"), item("d2")}})
	if !errors.Is(err, ErrStoredUnreadable) {
		t.Fatalf("push err = %v, want ErrStoredUnreadable", err)
	}
	var name string
	w.db.QueryRow(`SELECT name FROM study_decks WHERE id = 'd1'`).Scan(&name)
	if name != "d1" {
		t.Errorf("d1 renamed to %q: nothing in a refused push may apply", name)
	}
	var source string
	w.db.QueryRow(`SELECT source FROM study_decks WHERE id = 'd2'`).Scan(&source)
	if !strings.Contains(source, "course") {
		t.Errorf("d2 source rewritten: %q", source)
	}
	// A push that does not touch it goes through.
	if _, err := Push(context.Background(), w.db, uid, PushBody{Decks: []json.RawMessage{item("d1")}}); err != nil {
		t.Fatalf("push of a readable row: %v", err)
	}
}
