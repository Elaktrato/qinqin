package ratelimit

import (
	"encoding/binary"
	"fmt"
	"testing"
	"time"
)

var t0 = time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)

func pol() BucketPolicy { return BucketPolicy{Burst: 10, Every: 6 * time.Second, MaxKeys: 100} }

func drain(b *Buckets, k Key, now time.Time) {
	for i := 0; i < 10; i++ {
		b.Take(k, now)
	}
}

func TestBucketBurstAndRetry(t *testing.T) {
	b, k := NewBuckets(pol()), NewKeyer().Key("a")
	for i := 0; i < 10; i++ {
		if ok, _ := b.Take(k, t0); !ok {
			t.Fatalf("take %d refused", i+1)
		}
	}
	ok, retry := b.Take(k, t0)
	if ok || retry != 6*time.Second {
		t.Fatalf("11th = %v %v, want refused, 6s", ok, retry)
	}
}

func TestBucketRefill(t *testing.T) {
	b, k := NewBuckets(pol()), NewKeyer().Key("a")
	drain(b, k, t0)
	if ok, retry := b.Take(k, t0.Add(3*time.Second)); ok || retry != 3*time.Second {
		t.Fatalf("after 3s = %v %v, want refused, 3s", ok, retry)
	}
	if ok, _ := b.Take(k, t0.Add(6*time.Second)); !ok {
		t.Fatal("after 6s refused")
	}
	if ok, _ := b.Take(k, t0.Add(6*time.Second)); ok {
		t.Fatal("second token after 6s granted")
	}
}

func TestBucketRefund(t *testing.T) {
	b, k := NewBuckets(pol()), NewKeyer().Key("a")
	drain(b, k, t0)
	b.Refund(k, t0)
	if ok, _ := b.Take(k, t0); !ok {
		t.Fatal("refunded token not usable")
	}
	if ok, _ := b.Take(k, t0); ok {
		t.Fatal("refund minted more than one")
	}
	// never above the burst
	k2 := NewKeyer().Key("b")
	b.Take(k2, t0)
	b.Refund(k2, t0)
	b.Refund(k2, t0)
	n := 0
	for ok, _ := b.Take(k2, t0); ok; ok, _ = b.Take(k2, t0) {
		n++
	}
	if n != 10 {
		t.Fatalf("takes after over-refund = %d, want 10", n)
	}
}

func TestBucketSweepDropsFullIdle(t *testing.T) {
	b, ky := NewBuckets(pol()), NewKeyer()
	b.Take(ky.Key("a"), t0)
	b.Take(ky.Key("b"), t0)
	if b.Len() != 2 {
		t.Fatalf("len = %d", b.Len())
	}
	b.Take(ky.Key("c"), t0.Add(61*time.Second)) // triggers the sweep
	// a and b refilled (one token = 6 s) and are dropped; c remains
	if b.Len() != 1 {
		t.Fatalf("len after sweep = %d, want 1", b.Len())
	}
}

func TestBucketEvictionKeepsCap(t *testing.T) {
	p := pol()
	p.MaxKeys = 50
	b, ky := NewBuckets(p), NewKeyer()
	for i := 0; i < 2*p.MaxKeys; i++ {
		if ok, _ := b.Take(ky.Key(fmt.Sprint("flood", i)), t0.Add(time.Duration(i)*time.Millisecond)); !ok {
			t.Fatalf("fresh key %d refused", i)
		}
		if b.Len() > p.MaxKeys {
			t.Fatalf("len %d above cap", b.Len())
		}
	}
	if b.Len() != p.MaxKeys {
		t.Fatalf("len = %d, want %d", b.Len(), p.MaxKeys)
	}
	// the new key started full
	fresh := ky.Key("fresh")
	for i := 0; i < 10; i++ {
		if ok, _ := b.Take(fresh, t0.Add(time.Second)); !ok {
			t.Fatalf("fresh take %d refused", i+1)
		}
	}
}

func TestBucketClockBackwards(t *testing.T) {
	b, k := NewBuckets(pol()), NewKeyer().Key("a")
	drain(b, k, t0)
	if ok, _ := b.Take(k, t0.Add(-time.Hour)); ok {
		t.Fatal("backwards clock minted a token")
	}
	if ok, _ := b.Take(k, t0); ok {
		t.Fatal("token after backwards step")
	}
}

func TestKeyer(t *testing.T) {
	a, b := NewKeyer(), NewKeyer()
	if a.Key("x", "y") != a.Key("x", "y") {
		t.Fatal("one Keyer unstable")
	}
	if a.Key("x") == b.Key("x") {
		t.Fatal("two Keyers agree")
	}
	if a.Key("x", "y") == a.Key("xy") || a.Key("x", "y") == a.Key("x", "z") {
		t.Fatal("parts not separated")
	}
}

// Inserting into a full table looks at a bounded sample, not at the map.
func TestEvictionWalkBounded(t *testing.T) {
	tb := newTable[int](65536)
	key := func(i int) Key {
		var k Key
		binary.BigEndian.PutUint64(k[:], uint64(i)+1)
		return k
	}
	for i := 0; i < 65536; i++ {
		tb.add(key(i), 0, t0)
	}
	before := tb.walked
	const inserts = 10000
	for i := 0; i < inserts; i++ {
		tb.add(key(70000+i), 0, t0)
	}
	if got := tb.walked - before; got > inserts*evictSample {
		t.Fatalf("eviction visited %d entries for %d inserts, want at most %d", got, inserts, inserts*evictSample)
	}
	if len(tb.m) != 65536 {
		t.Fatalf("len %d", len(tb.m))
	}
}
