package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"runtime"
	"strconv"
	"sync"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/model"
	"qinqin/internal/ratelimit"
)

// limiter is the seam later auth routes (reauth, reset mail, SMTP test,
// code entry) plug into: Allow spends one token of the named table for
// key and says how long to wait when none is left.
type limiter interface {
	Allow(key string) (ok bool, retry time.Duration)
}

// noLimit lets everything through; it is the placeholder a route can use
// before it has a policy.
type noLimit struct{}

func (noLimit) Allow(string) (bool, time.Duration) { return true, 0 }

// AuthPolicy holds every number of sign-in throttling. cmd/qinqin uses
// DefaultAuthPolicy; only tests pass another through WithAuthPolicy.
type AuthPolicy struct {
	Client   ratelimit.BucketPolicy
	Pair     ratelimit.BackoffPolicy
	Account  ratelimit.BucketPolicy
	Hashes   int           // argon2 runs at once
	HashWait time.Duration // how long a request waits for a slot
	Named    map[string]ratelimit.BucketPolicy
}

const authTableCap = 65536

// DefaultAuthPolicy is the policy of the design spec.
func DefaultAuthPolicy() AuthPolicy {
	return AuthPolicy{
		Client: ratelimit.BucketPolicy{Burst: 10, Every: 6 * time.Second, MaxKeys: authTableCap},
		Pair: ratelimit.BackoffPolicy{Free: 5, First: time.Minute, Max: 15 * time.Minute,
			Forget: time.Hour, GoodFor: 30 * 24 * time.Hour, MaxKeys: authTableCap},
		Account:  ratelimit.BucketPolicy{Burst: 20, Every: time.Minute, MaxKeys: authTableCap},
		Hashes:   min(4, max(1, runtime.GOMAXPROCS(0))),
		HashWait: 3 * time.Second,
		Named: map[string]ratelimit.BucketPolicy{
			// Wrong passwords on routes that re-ask for the password
			// (change password, email change, MFA changes, delete): 5 per
			// 15 minutes per user. A right password refunds its token.
			"reauth": {Burst: 5, Every: 3 * time.Minute, MaxKeys: authTableCap},
			// Reset-link check and use, per client: 10 burst, one more per
			// 30 s. The tokens are 256-bit; the budget only bounds noise.
			"reset": {Burst: 10, Every: 30 * time.Second, MaxKeys: authTableCap},
			// Test mails an administrator may send: 10 per hour.
			// Code mails per user (verification, sign-in, second step): 5 per
			// hour; beyond that the mail is silently not sent.
			"mailcode": {Burst: 5, Every: 12 * time.Minute, MaxKeys: authTableCap},
			// Reset requests and sign-in code requests per identifier (the
			// same for known and unknown identifiers): 5 per hour.
			"ident": {Burst: 5, Every: 12 * time.Minute, MaxKeys: authTableCap},
			// Reset mails per user: 3 per hour, beyond that silently skipped.
			"reset-mail": {Burst: 3, Every: 20 * time.Minute, MaxKeys: authTableCap},
			"smtp-test":  {Burst: 10, Every: 6 * time.Minute, MaxKeys: authTableCap},
		},
	}
}

// WithAuthPolicy replaces the sign-in throttling numbers (tests only).
func WithAuthPolicy(p AuthPolicy) Option { return func(s *server) { s.authPolicy = &p } }

// errHashBusy reports that no hash slot freed up within HashWait.
var errHashBusy = errors.New("hash gate busy")

// authLimits is the live state built by New from an AuthPolicy.
type authLimits struct {
	policy  AuthPolicy
	keyer   *ratelimit.Keyer
	client  *ratelimit.Buckets
	pair    *ratelimit.Backoff
	account *ratelimit.Buckets
	gate    *ratelimit.Gate

	mu    sync.Mutex
	named map[string]*ratelimit.Buckets

	logMu      sync.Mutex
	lastLog    time.Time
	suppressed int
}

func newAuthLimits(p AuthPolicy) *authLimits {
	return &authLimits{
		policy:  p,
		keyer:   ratelimit.NewKeyer(),
		client:  ratelimit.NewBuckets(p.Client),
		pair:    ratelimit.NewBackoff(p.Pair),
		account: ratelimit.NewBuckets(p.Account),
		gate:    ratelimit.NewGate(p.Hashes),
		named:   make(map[string]*ratelimit.Buckets),
	}
}

// hashers are the password-hashing entry points a handler calls; tests
// swap them through WithAuthHooks to block or count hashes.
type hashers struct {
	hash            func(password string) string // a new password's digest (change password)
	login           func(ctx context.Context, db *sql.DB, user, pass string, o auth.LoginOptions) (auth.LoginResult, error)
	createFirstUser func(ctx context.Context, db *sql.DB, user, pass string) (model.User, error)
	createUser      func(ctx context.Context, db *sql.DB, user, pass string, admin bool) (model.User, error)
}

func defaultHashers() hashers {
	return hashers{hash: auth.Hash, login: auth.LoginWith, createFirstUser: auth.CreateFirstUser, createUser: auth.CreateUser}
}

// namedLimiter adapts a Buckets table to the limiter seam.
type namedLimiter struct {
	s    *server
	name string
	b    *ratelimit.Buckets
}

func (l namedLimiter) Allow(key string) (bool, time.Duration) {
	return l.b.Take(l.s.limits.keyer.Key(l.name, key), l.s.now())
}

// Refund gives one spent token of key back; a route spends a token before
// it checks a password and refunds it when the password was right, so only
// wrong guesses use the budget.
func (l namedLimiter) Refund(key string) {
	l.b.Refund(l.s.limits.keyer.Key(l.name, key), l.s.now())
}

// refunder is implemented by limiters that can give a token back.
type refunder interface{ Refund(key string) }

// authLimiter returns the token-bucket limiter of the given name; an
// unknown name gets the client (login) policy.
func (s *server) authLimiter(name string) limiter {
	l := s.limits
	l.mu.Lock()
	defer l.mu.Unlock()
	b := l.named[name]
	if b == nil {
		p, ok := l.policy.Named[name]
		if !ok {
			p = l.policy.Client
		}
		b = ratelimit.NewBuckets(p)
		l.named[name] = b
	}
	return namedLimiter{s: s, name: name, b: b}
}

// withHashGate runs fn (a password hash) once a slot is free, waiting at
// most HashWait; errHashBusy when none frees up.
func (s *server) withHashGate(ctx context.Context, fn func() error) error {
	release, ok := s.limits.gate.Acquire(ctx, s.limits.policy.HashWait)
	if !ok {
		if err := ctx.Err(); err != nil {
			return err
		}
		return errHashBusy
	}
	defer release()
	return fn()
}

// retrySeconds rounds a wait up to whole seconds, at least 1.
func retrySeconds(d time.Duration) int {
	n := int((d + time.Second - 1) / time.Second)
	return max(n, 1)
}

// waitText words a wait the way the web client does: seconds up to a
// minute, then whole minutes (rounded up).
func waitText(sec int) string {
	unit := func(n int, one string) string {
		if n == 1 {
			return "1 " + one
		}
		return strconv.Itoa(n) + " " + one + "s"
	}
	if sec < 60 {
		return unit(sec, "second")
	}
	return unit((sec+59)/60, "minute")
}

// writeAuthError answers a login/register error as {"error","message"}.
func writeAuthError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": code, "message": message})
}

// writeRateLimited answers 429 rate_limited with Retry-After, worded for
// sign-in attempts.
func writeRateLimited(w http.ResponseWriter, retry time.Duration) {
	writeRateLimitedAs(w, retry, "sign-in attempts")
}

// writeRateLimitedAs words the 429 for another kind of attempt
// ("attempts" for registration).
func writeRateLimitedAs(w http.ResponseWriter, retry time.Duration, subject string) {
	sec := retrySeconds(retry)
	w.Header().Set("Retry-After", strconv.Itoa(sec))
	writeAuthError(w, http.StatusTooManyRequests, "rate_limited",
		fmt.Sprintf("Too many %s. Try again in %s.", subject, waitText(sec)))
}

// writeClientGone ends a request whose client has already gone (its
// context is done): nginx's 499, no body, nothing logged.
func writeClientGone(w http.ResponseWriter) { w.WriteHeader(499) }

// writeBusy answers 503 busy with Retry-After: 2.
func writeBusy(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "2")
	writeAuthError(w, http.StatusServiceUnavailable, "busy", "The server is busy. Try again in a moment.")
}

// logThrottled notes that a layer refused a request. It never names an
// address, username or token, and at most one line is written per 10 s
// (the rest are counted into the next line).
func (s *server) logThrottled(layer string) {
	l := s.limits
	l.logMu.Lock()
	defer l.logMu.Unlock()
	now := s.now()
	if !l.lastLog.IsZero() && now.Sub(l.lastLog) < 10*time.Second {
		l.suppressed++
		return
	}
	l.lastLog = now
	if l.suppressed > 0 {
		log.Printf("auth: sign-in throttled (layer %s); %d more since the last line", layer, l.suppressed)
		l.suppressed = 0
		return
	}
	log.Printf("auth: sign-in throttled (layer %s)", layer)
}

// readAuthBody reads a login/register body (4 KiB cap) and answers 413
// too_large itself.
func readAuthBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	body, err := readBodyErr(w, r, maxAuthBody)
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeAuthError(w, http.StatusRequestEntityTooLarge, "too_large", "Request body too large.")
		} else {
			writeAuthError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		}
		return nil, false
	}
	return body, true
}

// clientTake spends one L1 token of the request's client; false means a
// 429 was written. The returned key lets a caller refund it.
func (s *server) clientTake(w http.ResponseWriter, r *http.Request, subject string) (ratelimit.Key, bool) {
	l := s.limits
	k := l.keyer.Key("client", clientKeyString(s.clientIP(r)))
	if ok, retry := l.client.Take(k, s.now()); !ok {
		s.logThrottled("client")
		writeRateLimitedAs(w, retry, subject)
		return k, false
	}
	return k, true
}

// int64Key is the limiter key of a user id.
func int64Key(id int64) string { return strconv.FormatInt(id, 10) }
