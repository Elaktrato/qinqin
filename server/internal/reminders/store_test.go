package reminders

import (
	"context"
	"errors"
	"testing"
	"time"

	"qinqin/internal/dbtest"
	"qinqin/internal/secretbox"
)

var t0 = time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC)

func TestFactsRoundTripAndOwnership(t *testing.T) {
	db := dbtest.Open(t)
	u := dbtest.User(t, db, "ann")
	other := dbtest.User(t, db, "bob")
	ws := dbtest.Workspace(t, db, u, "zh")
	otherWS := dbtest.Workspace(t, db, other, "zh")
	ctx := context.Background()
	f := Facts{Workspace: ws, AsOf: t0, DueNow: 4, DueBuckets: []Bucket{{At: t0.Add(time.Hour), Count: 2}}, Goal: GoalFacts{Set: true, Status: "open"}, Streak: StreakFacts{Current: 3}, Vacation: []string{"2026-11-27"}}
	if err := SaveFacts(ctx, db, u, f, t0); err != nil {
		t.Fatal(err)
	}
	f.DueNow = 9
	if err := SaveFacts(ctx, db, u, f, t0); err != nil {
		t.Fatal(err)
	}
	got, err := LoadFacts(ctx, db, u)
	if err != nil || len(got) != 1 || got[0].DueNow != 9 || got[0].DueBuckets[0].Count != 2 || got[0].Vacation[0] != "2026-11-27" {
		t.Fatalf("%+v %v", got, err)
	}
	if err := SaveFacts(ctx, db, u, Facts{Workspace: otherWS, AsOf: t0}, t0); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("foreign workspace: %v", err)
	}
	if got, _ := LoadFacts(ctx, db, other); len(got) != 0 {
		t.Fatalf("leak: %+v", got)
	}
}

func TestFactsValidation(t *testing.T) {
	bad := []Facts{
		{DueNow: -1},
		{DueNow: 2_000_000},
		{DueBuckets: make([]Bucket, MaxBuckets+1)},
		{DueBuckets: []Bucket{{At: t0.Add(30 * time.Minute), Count: 1}}},
		{DueBuckets: []Bucket{{At: t0, Count: -1}}},
		{Goal: GoalFacts{Status: "weird"}},
		{Streak: StreakFacts{Current: -1}},
		{Vacation: []string{"tomorrow"}},
		{Vacation: make([]string, MaxVacation+1)},
	}
	for i, f := range bad {
		if err := f.Validate(); err == nil {
			t.Errorf("case %d accepted: %+v", i, f)
		}
	}
	ok := Facts{DueNow: 1, Goal: GoalFacts{Status: "none"}, DueBuckets: []Bucket{{At: t0, Count: 1}}}
	if err := ok.Validate(); err != nil {
		t.Error(err)
	}
}

func TestSubscriptions(t *testing.T) {
	db := dbtest.Open(t)
	u := dbtest.User(t, db, "ann")
	v := dbtest.User(t, db, "bob")
	ctx := context.Background()
	s := NewSubscription{Endpoint: "https://push.example/a", P256dh: make([]byte, 65), Auth: make([]byte, 16), Label: "Firefox"}
	id, created, err := AddSubscription(ctx, db, u, s, t0)
	if err != nil || !created || id == 0 {
		t.Fatal(id, created, err)
	}
	id2, created, err := AddSubscription(ctx, db, u, s, t0)
	if err != nil || created || id2 != id {
		t.Fatalf("again: %d %v %v", id2, created, err)
	}
	list, err := ListSubscriptions(ctx, db, u)
	if err != nil || len(list) != 1 || list[0].Label != "Firefox" {
		t.Fatalf("%+v %v", list, err)
	}
	if err := DeleteSubscription(ctx, db, v, id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign delete: %v", err)
	}
	// The same device signs in as someone else: the endpoint moves.
	if _, _, err := AddSubscription(ctx, db, v, s, t0); err != nil {
		t.Fatal(err)
	}
	if l, _ := ListSubscriptions(ctx, db, u); len(l) != 0 {
		t.Fatalf("the old owner still has it: %+v", l)
	}
	if err := DeleteSubscription(ctx, db, v, id); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < MaxSubscriptions; i++ {
		s.Endpoint = "https://push.example/" + string(rune('a'+i)) + "x"
		if _, _, err := AddSubscription(ctx, db, u, s, t0); err != nil {
			t.Fatalf("%d: %v", i, err)
		}
	}
	s.Endpoint = "https://push.example/one-too-many"
	if _, _, err := AddSubscription(ctx, db, u, s, t0); !errors.Is(err, ErrTooMany) {
		t.Fatalf("cap: %v", err)
	}
}

func TestClaimIsOncePerKindDay(t *testing.T) {
	db := dbtest.Open(t)
	u := dbtest.User(t, db, "ann")
	ctx := context.Background()
	ok, err := Claim(ctx, db, u, "email", KindDue, "2026-11-25", t0)
	if err != nil || !ok {
		t.Fatal(ok, err)
	}
	if ok, _ := Claim(ctx, db, u, "email", KindDue, "2026-11-25", t0); ok {
		t.Fatal("claimed twice")
	}
	if ok, _ := Claim(ctx, db, u, "push", KindDue, "2026-11-25", t0); !ok {
		t.Fatal("another channel is its own claim")
	}
	if ok, _ := Claim(ctx, db, u, "email", KindDue, "2026-11-26", t0); !ok {
		t.Fatal("another day is its own claim")
	}
	if err := Finish(ctx, db, u, "email", KindDue, "2026-11-25", "sent"); err != nil {
		t.Fatal(err)
	}
	if n, err := PruneDeliveries(ctx, db, t0.AddDate(0, 0, 92)); err != nil || n != 3 {
		t.Fatalf("prune %d %v", n, err)
	}
}

func TestVAPIDIsCreatedOnceAndSealed(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	cur := secretbox.NewSealer(make([]byte, 32))
	if _, err := LoadVAPID(ctx, db, nil, nil, t0); !errors.Is(err, ErrNoSecret) {
		t.Fatalf("no secret: %v", err)
	}
	a, err := LoadVAPID(ctx, db, cur, nil, t0)
	if err != nil {
		t.Fatal(err)
	}
	b, err := LoadVAPID(ctx, db, cur, nil, t0)
	if err != nil || a.PublicKey() != b.PublicKey() {
		t.Fatalf("second load differs: %v", err)
	}
	var ct []byte
	if err := db.QueryRow(`SELECT private_ct FROM push_vapid`).Scan(&ct); err != nil {
		t.Fatal(err)
	}
	if string(ct) == string(a.PrivateBytes()) {
		t.Fatal("the private key is stored in clear")
	}
	other := secretbox.NewSealer(append(make([]byte, 31), 9))
	if _, err := LoadVAPID(ctx, db, other, cur, t0); err != nil {
		t.Fatalf("previous secret must open it: %v", err)
	}
	// Opened with the previous secret, it is sealed again under the new one.
	if _, err := LoadVAPID(ctx, db, other, nil, t0); err != nil {
		t.Fatalf("after the rotation the new secret alone must open it: %v", err)
	}
	if _, err := LoadVAPID(ctx, db, secretbox.NewSealer(append(make([]byte, 31), 5)), nil, t0); err == nil {
		t.Fatal("an unrelated secret must not open it")
	}
}
