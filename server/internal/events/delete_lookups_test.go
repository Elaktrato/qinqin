package events_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"qinqin/internal/events"
	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// TestDeleteLookups: the one deletion of events (#72) removes only the
// caller's lookup events of one workspace.
func TestDeleteLookups(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	aliceID, alice := registerFirstUser(t, sqlDB, ts.URL, "alice")
	bobID, bob := registerUser(t, ts.URL, "bob", alice)
	ws1 := createWorkspace(t, ts.URL, alice, "zh")
	ws2 := createWorkspace(t, ts.URL, alice, "es")
	bobWS := createWorkspace(t, ts.URL, bob, "zh")

	at := time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)
	ev := func(user, ws int64, typ string) model.StudyEvent {
		at = at.Add(time.Minute)
		return model.StudyEvent{ID: newEventID(t), UserID: user, WorkspaceID: ws, Device: "web", TS: at, Type: typ,
			Payload: json.RawMessage(`{"query":"马"}`)}
	}
	batch := []model.StudyEvent{
		ev(aliceID, ws1, "lookup"), ev(aliceID, ws1, "review"), ev(aliceID, ws1, "view"), ev(aliceID, ws1, "lookup"),
		ev(aliceID, ws2, "lookup"), ev(bobID, bobWS, "lookup"),
	}
	if _, _, err := events.Append(context.Background(), sqlDB, batch); err != nil {
		t.Fatal(err)
	}

	// bob naming alice's workspace deletes nothing.
	n, err := events.DeleteLookups(context.Background(), sqlDB, bobID, ws1)
	if err != nil || n != 0 {
		t.Fatalf("DeleteLookups(bob, alice ws) = %d, %v; want 0", n, err)
	}
	n, err = events.DeleteLookups(context.Background(), sqlDB, aliceID, ws1)
	if err != nil || n != 2 {
		t.Fatalf("DeleteLookups(alice, ws1) = %d, %v; want 2", n, err)
	}
	types := func(user int64, ws int64) []string {
		got, err := events.Since(context.Background(), sqlDB, user, time.Time{}, &ws)
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, e := range got {
			out = append(out, e.Type)
		}
		return out
	}
	if got := types(aliceID, ws1); len(got) != 2 || got[0] != "review" || got[1] != "view" {
		t.Errorf("alice ws1 after delete = %v, want [review view]", got)
	}
	if got := types(aliceID, ws2); len(got) != 1 || got[0] != "lookup" {
		t.Errorf("alice ws2 = %v, want her other workspace's lookup kept", got)
	}
	if got := types(bobID, bobWS); len(got) != 1 || got[0] != "lookup" {
		t.Errorf("bob = %v, want his lookup kept", got)
	}
	n, err = events.DeleteLookups(context.Background(), sqlDB, aliceID, ws1)
	if err != nil || n != 0 {
		t.Errorf("repeat DeleteLookups = %d, %v; want 0", n, err)
	}
}
