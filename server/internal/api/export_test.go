package api

import (
	"context"
	"database/sql"
	"time"

	"qinqin/internal/dict"
	"qinqin/internal/model"
)

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

// WithImporter replaces packs.Import in background import jobs.
func WithImporter(f func(context.Context, *sql.DB, dict.Pack) (string, error)) Option {
	return func(s *server) { s.importPack = f }
}

// AuthHooks replaces the password-hashing entry points of the auth
// handlers; a nil field keeps the real function.
type AuthHooks struct {
	Login           func(ctx context.Context, db *sql.DB, user, pass string) (string, error)
	CreateFirstUser func(ctx context.Context, db *sql.DB, user, pass string) (model.User, error)
	CreateUser      func(ctx context.Context, db *sql.DB, user, pass string, admin bool) (model.User, error)
}

func WithAuthHooks(h AuthHooks) Option {
	return func(s *server) {
		if h.Login != nil {
			s.hash.login = h.Login
		}
		if h.CreateFirstUser != nil {
			s.hash.createFirstUser = h.CreateFirstUser
		}
		if h.CreateUser != nil {
			s.hash.createUser = h.CreateUser
		}
	}
}

// WithLimiterProbe stores in *probe a function that spends a token of
// the server's named limiter (the seam later auth routes use).
func WithLimiterProbe(probe *func(name, key string) (bool, time.Duration)) Option {
	return func(s *server) {
		*probe = func(name, key string) (bool, time.Duration) { return s.authLimiter(name).Allow(key) }
	}
}
