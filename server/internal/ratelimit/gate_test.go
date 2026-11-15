package ratelimit

import (
	"context"
	"testing"
	"time"
)

func TestGateAdmitsAndQueues(t *testing.T) {
	g := NewGate(2)
	r1, ok1 := g.Acquire(context.Background(), time.Second)
	_, ok2 := g.Acquire(context.Background(), time.Second)
	if !ok1 || !ok2 || g.InUse() != 2 {
		t.Fatalf("first two: %v %v inuse %d", ok1, ok2, g.InUse())
	}
	got := make(chan bool)
	go func() {
		_, ok := g.Acquire(context.Background(), 5*time.Second)
		got <- ok
	}()
	time.Sleep(20 * time.Millisecond)
	r1()
	if !<-got {
		t.Fatal("waiter did not get the released slot")
	}
}

func TestGateTimeout(t *testing.T) {
	g := NewGate(1)
	g.Acquire(context.Background(), time.Second)
	start := time.Now()
	if _, ok := g.Acquire(context.Background(), 30*time.Millisecond); ok {
		t.Fatal("acquired a full gate")
	}
	if d := time.Since(start); d < 25*time.Millisecond || d > time.Second {
		t.Fatalf("waited %v", d)
	}
}

func TestGateCancelledContext(t *testing.T) {
	g := NewGate(1)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, ok := g.Acquire(ctx, time.Second); ok {
		t.Fatal("cancelled context acquired")
	}
	g.Acquire(context.Background(), time.Second)
	ctx2, cancel2 := context.WithCancel(context.Background())
	go func() { time.Sleep(20 * time.Millisecond); cancel2() }()
	start := time.Now()
	if _, ok := g.Acquire(ctx2, 5*time.Second); ok || time.Since(start) > time.Second {
		t.Fatal("cancel while waiting did not return at once")
	}
}

func TestGateDoubleRelease(t *testing.T) {
	g := NewGate(1)
	r, _ := g.Acquire(context.Background(), time.Second)
	r()
	r()
	if g.InUse() != 0 {
		t.Fatalf("in use %d", g.InUse())
	}
	g.Acquire(context.Background(), time.Second)
	if _, ok := g.Acquire(context.Background(), 10*time.Millisecond); ok {
		t.Fatal("double release freed a second slot")
	}
}

func TestGateMinimumOne(t *testing.T) {
	g := NewGate(0)
	if _, ok := g.Acquire(context.Background(), time.Second); !ok {
		t.Fatal("n=0 admits nobody")
	}
	if _, ok := g.Acquire(context.Background(), 10*time.Millisecond); ok {
		t.Fatal("n=0 admitted two")
	}
}
