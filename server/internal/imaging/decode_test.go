package imaging

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestDecodeSlotsBoundTheDecodes(t *testing.T) {
	var releases []func()
	for range DecodeSlots {
		r, err := AcquireDecode(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		releases = append(releases, r)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := AcquireDecode(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("a decode beyond the slots: err = %v, want it to wait until its caller gives up", err)
	}
	got := make(chan error, 1)
	go func() {
		r, err := AcquireDecode(context.Background())
		if err == nil {
			r()
		}
		got <- err
	}()
	releases[0]()
	if err := <-got; err != nil {
		t.Fatal(err)
	}
	for _, r := range releases[1:] {
		r()
	}
	// A release is idempotent: a second call gives back nothing more.
	r, _ := AcquireDecode(context.Background())
	r()
	r()
	if n := len(slots); n != 0 {
		t.Fatalf("%d slots held after every release", n)
	}
}
