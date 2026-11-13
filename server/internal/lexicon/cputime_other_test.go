//go:build !linux

package lexicon_test

import "time"

// threadCPU runs fn; per-thread CPU time is only read on Linux, so ok is
// false and the cost guard falls back to wall time.
func threadCPU(fn func()) (cpu time.Duration, ok bool) {
	fn()
	return 0, false
}
