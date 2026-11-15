package api

import (
	"testing"
	"time"
)

func TestHourlyUseLimitRefundAndPrune(t *testing.T) {
	var u hourlyUse
	now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 3; i++ {
		if ok, _ := u.take(1, now, 3); !ok {
			t.Fatalf("take %d refused", i)
		}
	}
	if ok, wait := u.take(1, now.Add(time.Minute), 3); ok || wait != 59*time.Minute {
		t.Fatalf("4th take: ok=%v wait=%v", ok, wait)
	}
	if ok, _ := u.take(2, now, 3); !ok {
		t.Fatal("another user is limited too")
	}
	// A refund frees the slot.
	u.refund(2, now)
	u.refund(1, now)
	if ok, _ := u.take(1, now, 3); !ok {
		t.Fatal("take after refund refused")
	}
	// Entries of users who have been quiet for an hour are pruned.
	later := now.Add(3 * time.Hour)
	u.take(3, later, 3)
	u.mu.Lock()
	n := len(u.at)
	u.mu.Unlock()
	if n != 1 {
		t.Fatalf("map holds %d users after an hour of quiet, want 1", n)
	}
}
