package ratelimit

import (
	"context"
	"sync"
	"time"
)

// Gate admits at most n holders at once.
type Gate struct{ slots chan struct{} }

// NewGate returns a gate of n slots; n < 1 acts as 1.
func NewGate(n int) *Gate {
	if n < 1 {
		n = 1
	}
	return &Gate{slots: make(chan struct{}, n)}
}

// Acquire waits up to wait for a slot. ok is false on timeout or when
// ctx ends first; otherwise release gives the slot back (once).
func (g *Gate) Acquire(ctx context.Context, wait time.Duration) (release func(), ok bool) {
	if ctx.Err() != nil {
		return nil, false
	}
	select {
	case g.slots <- struct{}{}:
	default:
		timer := time.NewTimer(wait)
		defer timer.Stop()
		select {
		case g.slots <- struct{}{}:
		case <-timer.C:
			return nil, false
		case <-ctx.Done():
			return nil, false
		}
	}
	var once sync.Once
	return func() { once.Do(func() { <-g.slots }) }, true
}

// InUse is the number of slots held.
func (g *Gate) InUse() int { return len(g.slots) }
