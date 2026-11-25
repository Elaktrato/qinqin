package reminders

import (
	"context"
	"encoding/json"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/keyed"
)

func TestEmailOffKeepsEveryOtherKey(t *testing.T) {
	db := dbtest.Open(t)
	u := dbtest.User(t, db, "ann")
	ctx := context.Background()
	row := `{"version":1,"enabled":true,"times":["07:00"],"channels":{"email":true,"push":true},"future":{"x":1}}`
	if _, err := keyed.Put(ctx, db, u, nil, Key, json.RawMessage(row), nil); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ { // idempotent
		if err := EmailOff(ctx, db, u); err != nil {
			t.Fatal(err)
		}
	}
	r, err := keyed.Get(ctx, db, u, nil, Key)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	json.Unmarshal(r.Data, &m)
	ch := m["channels"].(map[string]any)
	if ch["email"] != false || ch["push"] != true || m["enabled"] != true || m["future"] == nil || m["version"] != float64(1) {
		t.Fatalf("%s", r.Data)
	}
	if got := ParseSettings(r.Data); got.Channels.Email || !got.Channels.Push {
		t.Fatalf("%+v", got)
	}
}

func TestEmailOffWithoutARowCreatesADisabledRow(t *testing.T) {
	db := dbtest.Open(t)
	u := dbtest.User(t, db, "ann")
	if err := EmailOff(context.Background(), db, u); err != nil {
		t.Fatal(err)
	}
	r, err := keyed.Get(context.Background(), db, u, nil, Key)
	if err != nil {
		t.Fatal(err)
	}
	if got := ParseSettings(r.Data); got.Enabled || got.Channels.Email {
		t.Fatalf("%s", r.Data)
	}
}

func TestEmailOffKeepsANewerVersion(t *testing.T) {
	db := dbtest.Open(t)
	u := dbtest.User(t, db, "ann")
	ctx := context.Background()
	keyed.Put(ctx, db, u, nil, Key, json.RawMessage(`{"version":4,"enabled":true,"channels":{"email":true}}`), nil)
	if err := EmailOff(ctx, db, u); err != nil {
		t.Fatal(err)
	}
	r, _ := keyed.Get(ctx, db, u, nil, Key)
	var m map[string]any
	json.Unmarshal(r.Data, &m)
	if m["version"] != float64(4) || m["channels"].(map[string]any)["email"] != false {
		t.Fatalf("%s", r.Data)
	}
}
