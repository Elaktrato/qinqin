package api

import "time"

// Test hooks: the clock the stage store reads, the channel a finished
// import job reports its token on, and the pack mutex (so a test can
// keep a job waiting).

func WithClock(c func() time.Time) Option { return func(s *server) { s.clock = c } }

func WithImportDone(ch chan string) Option { return func(s *server) { s.importDone = ch } }

func WithPackLock(lock, unlock *func()) Option {
	return func(s *server) {
		*lock = s.packMu.Lock
		*unlock = s.packMu.Unlock
	}
}
