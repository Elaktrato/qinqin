package ratelimit

import (
	"crypto/hmac"
	cryptorand "crypto/rand"
	"crypto/sha256"
	"math/rand/v2"
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

// add inserts a new slot, evicting the least recently touched of a
// small random sample when the table is full.
func (t *table[V]) add(k Key, v V, now time.Time) *slot[V] {
	if len(t.m) >= t.max {
		var victim Key
		var oldest time.Time
		first := true
		n := 0
		// Map iteration starts at a random bucket; skipping a random
		// number of entries first spreads the sample further.
		skip := rand.IntN(len(t.m))
		for key, s := range t.m {
			if skip > 0 {
				skip--
				continue
			}
			if first || s.touched.Before(oldest) {
				victim, oldest, first = key, s.touched, false
			}
			n++
			if n >= evictSample {
				break
			}
		}
		if first { // skipped past everything: take the first entry
			for key := range t.m {
				victim = key
				break
			}
		}
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
