//go:build linux

package lexicon_test

import (
	"runtime"
	"syscall"
	"time"
)

// rusageThread is Linux's RUSAGE_THREAD: the calling thread's usage.
const rusageThread = 1

// threadCPU runs fn on a locked OS thread and returns the CPU time that
// thread spent, so a cost guard measures the work rather than the
// scheduling of a busy machine (the pure-Go SQLite driver runs on the
// calling goroutine). ok is false when the usage cannot be read.
func threadCPU(fn func()) (cpu time.Duration, ok bool) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	var before, after syscall.Rusage
	if syscall.Getrusage(rusageThread, &before) != nil {
		fn()
		return 0, false
	}
	fn()
	if syscall.Getrusage(rusageThread, &after) != nil {
		return 0, false
	}
	used := func(r syscall.Rusage) time.Duration {
		return time.Duration(r.Utime.Nano() + r.Stime.Nano())
	}
	return used(after) - used(before), true
}
