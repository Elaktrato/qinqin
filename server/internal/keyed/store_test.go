package keyed

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"qinqin/internal/dbtest"
	"qinqin/internal/model"
)

func TestPutGetVersioningAndTombstones(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice := dbtest.User(t, sqlDB, "alice")

	r, err := Put(ctx, sqlDB, alice, nil, "home-layout", json.RawMessage(`{"version":1,"widgets":[]}`), nil)
	if err != nil || r.Version != 1 || r.Key != "home-layout" || r.UserID != alice || r.WorkspaceID != nil || r.DeletedAt != nil {
		t.Fatalf("first put = %+v (%v)", r, err)
	}
	if r, err = Put(ctx, sqlDB, alice, nil, "home-layout", json.RawMessage(`{"version":1,"widgets":["daily-goal"]}`), nil); err != nil || r.Version != 2 {
		t.Fatalf("second put = %+v (%v)", r, err)
	}
	got, err := Get(ctx, sqlDB, alice, nil, "home-layout")
	if err != nil || string(got.Data) != `{"version":1,"widgets":["daily-goal"]}` || got.Version != 2 {
		t.Errorf("get = %+v (%v)", got, err)
	}
	if _, err := Get(ctx, sqlDB, alice, nil, "nav-layout"); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing row: %v", err)
	}
	if err := Delete(ctx, sqlDB, alice, nil, "home-layout", time.Time{}); err != nil {
		t.Fatal(err)
	}
	if _, err := Get(ctx, sqlDB, alice, nil, "home-layout"); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleted row: %v", err)
	}
	if err := Delete(ctx, sqlDB, alice, nil, "home-layout", time.Time{}); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete: %v", err)
	}
	// a put revives the tombstone, the version continues
	if r, err = Put(ctx, sqlDB, alice, nil, "home-layout", json.RawMessage(`{}`), nil); err != nil || r.Version != 3 || r.DeletedAt != nil {
		t.Errorf("revive = %+v (%v)", r, err)
	}
}

func TestStoreRefusesWhatTheFamiliesDoNot(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice := dbtest.User(t, sqlDB, "alice")
	ws := dbtest.Workspace(t, sqlDB, alice, "zh")
	if _, err := Put(ctx, sqlDB, alice, &ws, "card:x", json.RawMessage(`{}`), nil); !errors.Is(err, ErrUnknownKey) {
		t.Errorf("typed key: %v", err)
	}
	if _, err := Put(ctx, sqlDB, alice, nil, "note:1", json.RawMessage(`{}`), nil); !errors.Is(err, ErrWrongScope) {
		t.Errorf("note without a workspace: %v", err)
	}
	if _, err := Put(ctx, sqlDB, alice, &ws, "home-layout", json.RawMessage(`{}`), nil); !errors.Is(err, ErrWrongScope) {
		t.Errorf("home layout in a workspace: %v", err)
	}
	zero := int64(0)
	if _, err := Put(ctx, sqlDB, alice, &zero, "note:1", json.RawMessage(`{}`), nil); err == nil {
		t.Error("workspace id 0 accepted")
	}
}

func TestRowsIsolatedAndScoped(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice, bob := dbtest.User(t, sqlDB, "alice"), dbtest.User(t, sqlDB, "bob")
	w, v := dbtest.Workspace(t, sqlDB, alice, "zh"), dbtest.Workspace(t, sqlDB, alice, "ja")
	put := func(user int64, ws *int64, key string) {
		t.Helper()
		if _, err := Put(ctx, sqlDB, user, ws, key, json.RawMessage(`{"k":"`+key+`"}`), nil); err != nil {
			t.Fatalf("put %s: %v", key, err)
		}
	}
	for _, k := range []string{"note:2", "note:1", "notecfg", "note:3"} {
		put(alice, &w, k)
	}
	put(alice, &v, "note:9")
	put(bob, &w, "note:1") // another user's row under the same workspace id
	put(alice, nil, "vacation:V1")
	if err := Delete(ctx, sqlDB, alice, &w, "note:3", time.Time{}); err != nil {
		t.Fatal(err)
	}
	keys := func(rows []model.KeyedRow, err error) []string {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
		out := []string{}
		for _, r := range rows {
			out = append(out, r.Key)
		}
		return out
	}
	eq := func(got []string, want ...string) {
		t.Helper()
		if len(got) != len(want) {
			t.Fatalf("keys = %v, want %v", got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("keys = %v, want %v", got, want)
			}
		}
	}
	eq(keys(List(ctx, sqlDB, alice, &w, "note:")), "note:1", "note:2")
	eq(keys(List(ctx, sqlDB, alice, &w, "")), "note:1", "note:2", "notecfg")
	eq(keys(List(ctx, sqlDB, alice, &v, "note:")), "note:9")
	eq(keys(List(ctx, sqlDB, alice, nil, "")), "vacation:V1")
	eq(keys(List(ctx, sqlDB, alice, &w, "no%")))
	eq(keys(List(ctx, sqlDB, alice, &w, "not_:")))
	eq(keys(List(ctx, sqlDB, bob, &w, "")), "note:1")
	if r, err := Get(ctx, sqlDB, bob, &w, "note:1"); err != nil || r.UserID != bob {
		t.Errorf("bob's note = %+v (%v)", r, err)
	}

	// the pull of each user carries only that user's rows, tombstones included
	var n int
	if err := Each(ctx, sqlDB, alice, time.Time{}, false, func(r *model.KeyedRow) error {
		if r.UserID != alice {
			t.Errorf("alice's pull carries %+v", r)
		}
		n++
		return nil
	}); err != nil || n != 6 {
		t.Errorf("alice's pull: %d rows (%v), want 6 (5 live and the tombstone)", n, err)
	}
}

func TestApplyIsLastWriteWins(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice := dbtest.User(t, sqlDB, "alice")
	ws := dbtest.Workspace(t, sqlDB, alice, "zh")
	at := func(s string) time.Time { x, _ := time.Parse(time.RFC3339, s); return x }
	row := func(data, updated string, deleted bool) model.KeyedRow {
		r := model.KeyedRow{Key: "note:1", WorkspaceID: &ws, Data: json.RawMessage(data), UpdatedAt: at(updated)}
		if deleted {
			d := at(updated)
			r.DeletedAt = &d
		}
		return r
	}
	for i, c := range []struct {
		row  model.KeyedRow
		want bool
	}{
		{row(`{"a":1}`, "2026-11-20T10:00:00Z", false), true},
		{row(`{"a":0}`, "2026-11-20T09:00:00Z", false), false}, // an older edit loses
		{row(`{"a":2}`, "2026-11-20T10:00:00Z", false), true},  // the same second wins
		{row(`{"a":2}`, "2026-11-20T11:00:00Z", true), true},   // a later delete
		{row(`{"a":2}`, "2026-11-20T12:00:00Z", true), false},  // deleting a tombstone
	} {
		got, err := Apply(ctx, sqlDB, alice, c.row)
		if err != nil || got != c.want {
			t.Errorf("%d: applied %v (%v), want %v", i, got, err, c.want)
		}
	}
	if _, err := Get(ctx, sqlDB, alice, &ws, "note:1"); !errors.Is(err, ErrNotFound) {
		t.Errorf("after the delete: %v", err)
	}
}
