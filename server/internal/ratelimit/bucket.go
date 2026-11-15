package ratelimit

import (
	"sync"
	"time"
)

// BucketPolicy: Burst tokens, one more every Every, at most MaxKeys keys.
type BucketPolicy struct {
	Burst   int
	Every   time.Duration
	MaxKeys int
}

type bucketState struct {
	tokens float64
	last   time.Time
}

// Buckets is a set of token buckets keyed by Key. A new key starts full.
type Buckets struct {
	mu sync.Mutex
	p  BucketPolicy
	t  *table[bucketState]
}

// NewBuckets returns an empty set; Burst < 1 acts as 1, Every <= 0 as 1 s.
func NewBuckets(p BucketPolicy) *Buckets {
	if p.Burst < 1 {
		p.Burst = 1
	}
	if p.Every <= 0 {
		p.Every = time.Second
	}
	return &Buckets{p: p, t: newTable[bucketState](p.MaxKeys)}
}

// refill brings st up to now. A clock that went backwards mints nothing.
func (b *Buckets) refill(st *bucketState, now time.Time) {
	if now.After(st.last) {
		st.tokens += float64(now.Sub(st.last)) / float64(b.p.Every)
		if st.tokens > float64(b.p.Burst) {
			st.tokens = float64(b.p.Burst)
		}
		st.last = now
	}
}

func (b *Buckets) sweep(now time.Time) {
	for k, s := range b.t.m {
		st := s.v
		b.refill(&st, now)
		if st.tokens >= float64(b.p.Burst) {
			delete(b.t.m, k)
		}
	}
}

// Take spends one token of k. When none is left it reports how long
// until one is.
func (b *Buckets) Take(k Key, now time.Time) (bool, time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.t.sweepDue(now) {
		b.sweep(now)
	}
	s := b.t.get(k, now)
	if s == nil {
		s = b.t.add(k, bucketState{tokens: float64(b.p.Burst), last: now}, now)
	}
	b.refill(&s.v, now)
	if s.v.tokens >= 1 {
		s.v.tokens--
		return true, 0
	}
	return false, time.Duration((1 - s.v.tokens) * float64(b.p.Every))
}

// Refund gives one token of k back, never above Burst.
func (b *Buckets) Refund(k Key, now time.Time) {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := b.t.get(k, now)
	if s == nil {
		return
	}
	b.refill(&s.v, now)
	s.v.tokens++
	if s.v.tokens > float64(b.p.Burst) {
		s.v.tokens = float64(b.p.Burst)
	}
}

// Len is the number of keys held.
func (b *Buckets) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.t.m)
}
