package ratelimit

import (
	"fmt"
	"testing"
	"time"
)

func bpol() BackoffPolicy {
	return BackoffPolicy{Free: 5, First: 60 * time.Second, Max: 15 * time.Minute,
		Forget: time.Hour, GoodFor: 30 * 24 * time.Hour, MaxKeys: 100}
}

// attempt runs Begin then Fail.
func failOnce(t *testing.T, b *Backoff, k Key, now time.Time) {
	t.Helper()
	if ok, retry := b.Begin(k, now); !ok {
		t.Fatalf("Begin refused (retry %v)", retry)
	}
	b.Fail(k, now)
}

func TestBackoffFreeThenLock(t *testing.T) {
	b, k := NewBackoff(bpol()), NewKeyer().Key("p")
	for i := 0; i < 6; i++ { // failures 1-5 free; the 6th is allowed and locks
		failOnce(t, b, k, t0)
	}
	ok, retry := b.Begin(k, t0)
	if ok || retry != 60*time.Second {
		t.Fatalf("7th = %v %v, want refused 60s", ok, retry)
	}
}

func TestBackoffDoublesAndCaps(t *testing.T) {
	b, k := NewBackoff(bpol()), NewKeyer().Key("p")
	now := t0
	for i := 0; i < 6; i++ {
		failOnce(t, b, k, now)
	}
	want := []time.Duration{120, 240, 480, 900, 900}
	for i, w := range want {
		_, retry := b.Begin(k, now)
		now = now.Add(retry)
		failOnce(t, b, k, now) // lock expired exactly: one attempt, fails
		_, retry = b.Begin(k, now)
		if retry != w*time.Second {
			t.Fatalf("lock %d = %v, want %v", i+2, retry, w*time.Second)
		}
	}
}

func TestBackoffRefusedBeginDoesNotExtend(t *testing.T) {
	b, k := NewBackoff(bpol()), NewKeyer().Key("p")
	for i := 0; i < 6; i++ {
		failOnce(t, b, k, t0)
	}
	for i := 0; i < 5; i++ {
		b.Begin(k, t0.Add(time.Duration(i)*time.Second))
	}
	if ok, retry := b.Begin(k, t0.Add(30*time.Second)); ok || retry != 30*time.Second {
		t.Fatalf("lock moved: %v %v", ok, retry)
	}
}

func TestBackoffInflightCounts(t *testing.T) {
	b, k := NewBackoff(bpol()), NewKeyer().Key("p")
	for i := 0; i < 5; i++ {
		failOnce(t, b, k, t0)
	}
	passed := 0
	for i := 0; i < 6; i++ {
		if ok, _ := b.Begin(k, t0); ok {
			passed++
		}
	}
	if passed != 1 {
		t.Fatalf("passed %d after 5 failures, want 1", passed)
	}
	// from zero failures, six can be in flight
	k2 := NewKeyer().Key("q")
	passed = 0
	for i := 0; i < 20; i++ {
		if ok, _ := b.Begin(k2, t0); ok {
			passed++
		}
	}
	if passed != 6 {
		t.Fatalf("passed %d from zero, want 6", passed)
	}
	// six simultaneous failures: one lock, not doubled
	for i := 0; i < 6; i++ {
		b.Fail(k2, t0)
	}
	if _, retry := b.Begin(k2, t0); retry != 60*time.Second {
		t.Fatalf("retry %v, want 60s", retry)
	}
}

func TestBackoffSucceedKnownGood(t *testing.T) {
	b, k := NewBackoff(bpol()), NewKeyer().Key("p")
	for i := 0; i < 3; i++ {
		failOnce(t, b, k, t0)
	}
	if b.KnownGood(k, t0) {
		t.Fatal("known-good before success")
	}
	b.Begin(k, t0)
	b.Succeed(k, t0)
	if !b.KnownGood(k, t0.Add(29*24*time.Hour)) || b.KnownGood(k, t0.Add(31*24*time.Hour)) {
		t.Fatal("known-good window wrong")
	}
	for i := 0; i < 6; i++ { // failures were cleared: six more allowed
		failOnce(t, b, k, t0.Add(time.Second))
	}
}

func TestBackoffAbort(t *testing.T) {
	b, k := NewBackoff(bpol()), NewKeyer().Key("p")
	for i := 0; i < 5; i++ {
		failOnce(t, b, k, t0)
	}
	b.Begin(k, t0)
	b.Abort(k)
	if ok, _ := b.Begin(k, t0); !ok {
		t.Fatal("Abort counted as a failure or stayed in flight")
	}
}

func TestBackoffForget(t *testing.T) {
	b, k := NewBackoff(bpol()), NewKeyer().Key("p")
	for i := 0; i < 5; i++ {
		failOnce(t, b, k, t0)
	}
	b.Begin(k, t0)
	b.Succeed(k, t0) // known-good
	for i := 0; i < 5; i++ {
		failOnce(t, b, k, t0)
	}
	later := t0.Add(2 * time.Hour)
	for i := 0; i < 6; i++ { // failures forgotten after 1 h quiet
		failOnce(t, b, k, later)
	}
	if !b.KnownGood(k, later) {
		t.Fatal("known-good mark forgotten with the failures")
	}
}

func TestBackoffSweepAndEviction(t *testing.T) {
	p := bpol()
	p.MaxKeys = 50
	b, ky := NewBackoff(p), NewKeyer()
	failOnce(t, b, ky.Key("a"), t0)
	if b.Len() != 1 {
		t.Fatal("len")
	}
	failOnce(t, b, ky.Key("b"), t0.Add(2*time.Hour)) // sweep drops a
	if b.Len() != 1 {
		t.Fatalf("len after sweep = %d, want 1", b.Len())
	}
	for i := 0; i < 2*p.MaxKeys; i++ {
		if ok, _ := b.Begin(ky.Key(fmt.Sprint("f", i)), t0.Add(3*time.Hour)); !ok {
			t.Fatalf("fresh key %d refused", i)
		}
		if b.Len() > p.MaxKeys {
			t.Fatalf("len %d above cap", b.Len())
		}
	}
}
