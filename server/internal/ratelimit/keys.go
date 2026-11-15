package ratelimit

import (
	"crypto/hmac"
	cryptorand "crypto/rand"
	"crypto/sha256"
	"time"
)

// Key identifies one limited subject (a client, a username, a pair). It
// is a truncated HMAC, never the subject itself.
type Key [16]byte

// Keyer derives Keys with a per-process random secret.
type Keyer struct{ secret [32]byte }

// NewKeyer returns a Keyer with a fresh random secret.
func NewKeyer() *Keyer {
	k := &Keyer{}
	if _, err := cryptorand.Read(k.secret[:]); err != nil {
		panic("ratelimit: no randomness: " + err.Error())
	}
	return k
}

// Key returns the key of the NUL-joined parts.
func (k *Keyer) Key(parts ...string) Key {
	m := hmac.New(sha256.New, k.secret[:])
	for i, p := range parts {
		if i > 0 {
			m.Write([]byte{0})
		}
		m.Write([]byte(p))
	}
	var out Key
	copy(out[:], m.Sum(nil))
	return out
}

const (
	sweepEvery  = 60 * time.Second
	evictSample = 8
)

// table is a size-capped map with a periodic sweep and sampled
// eviction. The caller holds its own mutex around every method.
type table[V any] struct {
	m         map[Key]*slot[V]
	max       int
	lastSweep time.Time
	walked    int // entries visited by evictions (a test asserts it stays small)
}

type slot[V any] struct {
	v       V
	touched time.Time
}

func newTable[V any](max int) *table[V] {
	if max < 1 {
		max = 65536
	}
	return &table[V]{m: make(map[Key]*slot[V]), max: max}
}

// get returns the slot of k, or nil.
func (t *table[V]) get(k Key, now time.Time) *slot[V] {
	s := t.m[k]
	if s != nil && now.After(s.touched) {
		s.touched = now
	}
	return s
}

// add inserts a new slot. When the table is full it evicts the least
// recently touched of the first evictSample entries of Go's map
// iteration. That order starts at a random bucket and offset on every
// range, so the sample is random enough, and costs at most evictSample
// steps however large the table is (no walk over the map).
func (t *table[V]) add(k Key, v V, now time.Time) *slot[V] {
	if len(t.m) >= t.max {
		var victim Key
		var oldest time.Time
		n := 0
		for key, s := range t.m {
			if n == 0 || s.touched.Before(oldest) {
				victim, oldest = key, s.touched
			}
			n++
			if n >= evictSample {
				break
			}
		}
		t.walked += n
		delete(t.m, victim)
	}
	s := &slot[V]{v: v, touched: now}
	t.m[k] = s
	return s
}

// sweepDue reports whether a sweep should run now and records it.
func (t *table[V]) sweepDue(now time.Time) bool {
	if t.lastSweep.IsZero() {
		t.lastSweep = now
		return false
	}
	if now.Sub(t.lastSweep) < sweepEvery {
		return false
	}
	t.lastSweep = now
	return true
}
