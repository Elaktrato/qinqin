package ratelimit

import (
	"sync"
	"time"
)

// BackoffPolicy: the first Free consecutive failures cost nothing, the
// next one starts a lock of First, every failure after an expired lock
// doubles it up to Max. A key quiet for Forget loses its failures; a
// success marks it known-good for GoodFor.
type BackoffPolicy struct {
	Free                        int
	First, Max, Forget, GoodFor time.Duration
	MaxKeys                     int
}

type backoffState struct {
	failures int
	inflight int
	lockedTo time.Time
	lockDur  time.Duration
	lastFail time.Time
}

// Backoff tracks consecutive failures per key.
type Backoff struct {
	mu sync.Mutex
	p  BackoffPolicy
	t  *table[backoffState]
	// good holds the known-good marks (value: expiry) in a table of their
	// own with their own cap, so a flood of new failing keys cannot evict
	// them. Marks need a valid password to create.
	good *table[time.Time]
}

// NewBackoff returns an empty tracker.
func NewBackoff(p BackoffPolicy) *Backoff {
	if p.Free < 0 {
		p.Free = 0
	}
	return &Backoff{p: p, t: newTable[backoffState](p.MaxKeys), good: newTable[time.Time](p.MaxKeys)}
}

// forget drops failures after a quiet period; a live lock or an
// attempt in flight keeps them.
func (b *Backoff) forget(st *backoffState, now time.Time) {
	if st.inflight == 0 && !now.Before(st.lockedTo) && st.failures > 0 && now.Sub(st.lastFail) >= b.p.Forget {
		st.failures, st.lockDur, st.lockedTo = 0, 0, time.Time{}
	}
}

func (b *Backoff) sweep(now time.Time) {
	for k, s := range b.t.m {
		st := &s.v
		b.forget(st, now)
		if st.inflight == 0 && st.failures == 0 && !now.Before(st.lockedTo) {
			delete(b.t.m, k)
		}
	}
	for k, s := range b.good.m {
		if !now.Before(s.v) {
			delete(b.good.m, k)
		}
	}
}

// Begin starts an attempt on k. It refuses while k is locked, and while
// the attempts already in flight could by themselves reach the lock
// (they count as failures until they end). After a lock expired one
// attempt at a time is allowed. Refusing never extends a lock.
func (b *Backoff) Begin(k Key, now time.Time) (bool, time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.t.sweepDue(now) {
		b.sweep(now)
	}
	s := b.t.get(k, now)
	if s == nil {
		s = b.t.add(k, backoffState{}, now)
	}
	st := &s.v
	b.forget(st, now)
	if now.Before(st.lockedTo) {
		return false, st.lockedTo.Sub(now)
	}
	if st.inflight > 0 && st.failures+st.inflight >= b.p.Free+1 {
		return false, time.Second
	}
	st.inflight++
	return true, 0
}

// Fail ends an in-flight attempt as a failure.
func (b *Backoff) Fail(k Key, now time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := b.t.get(k, now)
	if s == nil {
		return
	}
	st := &s.v
	if st.inflight > 0 {
		st.inflight--
	}
	st.failures++
	st.lastFail = now
	if st.failures < b.p.Free+1 || now.Before(st.lockedTo) {
		return // free, or a straggler of an attempt that began before the lock
	}
	switch {
	case st.lockDur == 0:
		st.lockDur = b.p.First
	default:
		st.lockDur *= 2
	}
	if b.p.Max > 0 && st.lockDur > b.p.Max {
		st.lockDur = b.p.Max
	}
	st.lockedTo = now.Add(st.lockDur)
}

// Succeed ends an in-flight attempt, clears the failures and marks k
// known-good.
func (b *Backoff) Succeed(k Key, now time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if s := b.t.get(k, now); s != nil {
		st := &s.v
		if st.inflight > 0 {
			st.inflight--
		}
		st.failures, st.lockDur, st.lockedTo = 0, 0, time.Time{}
	}
	if s := b.good.get(k, now); s != nil {
		s.v = now.Add(b.p.GoodFor)
	} else {
		b.good.add(k, now.Add(b.p.GoodFor), now)
	}
}

// Abort ends an in-flight attempt without counting it.
func (b *Backoff) Abort(k Key) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if s := b.t.m[k]; s != nil && s.v.inflight > 0 {
		s.v.inflight--
	}
}

// KnownGood reports whether k succeeded within GoodFor.
func (b *Backoff) KnownGood(k Key, now time.Time) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := b.good.m[k]
	return s != nil && now.Before(s.v)
}

// Len is the number of keys held.
func (b *Backoff) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.t.m)
}
