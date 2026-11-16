package study

import "time"

// SetNowForTest swaps the store clock and returns a restore func.
func SetNowForTest(f func() time.Time) (restore func()) {
	old := now
	now = f
	return func() { now = old }
}
