package api_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"qinqin/internal/api"
)

// The API's background goroutines (the stage sweeper here; staged pack
// imports and restores the same way) are counted in the group handed to
// WithBackgroundGroup, so serve can wait for them before closing the
// database (#170).
func TestBackgroundGroupCountsTheSweeper(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var wg sync.WaitGroup
	newPackEnv(t, api.WithStageSweeper(ctx, 10*time.Millisecond), api.WithBackgroundGroup(&wg))
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
		t.Fatal("the group was empty while the sweeper runs")
	case <-time.After(100 * time.Millisecond):
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the sweeper did not leave the group after its context ended")
	}
}
