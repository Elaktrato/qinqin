package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"

	"qinqin/internal/auth"
	"qinqin/internal/model"
)

// credentials is the request body of /api/auth/register and /api/auth/login.
type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// handleRegister creates a user. On a fresh database with zero users no
// authentication is required and the new user becomes the instance admin;
// afterwards a valid admin bearer token is mandatory. Every call spends a
// client-bucket token (anonymous callers reach the hash on some paths), an
// admin whose token checks out gets it back, and every hash runs behind
// the gate.
func (s *server) handleRegister(w http.ResponseWriter, r *http.Request) {
	body, ok := readAuthBody(w, r)
	if !ok {
		return
	}
	// An administrator's token is checked first (an equality lookup, no
	// hash): bulk creation is then never counted against the client
	// bucket, however many run in parallel. Everyone else pays one token.
	internal := func() {
		if r.Context().Err() != nil {
			writeClientGone(w)
			return
		}
		writeAuthError(w, http.StatusInternalServerError, "internal", "Internal error.")
	}
	caller, cerr := auth.UserFromRequest(r, s.db)
	if cerr != nil {
		internal()
		return
	}
	isAdmin := caller != nil && caller.Admin
	if !isAdmin {
		if _, ok := s.clientTake(w, r, "attempts"); !ok {
			return
		}
	}
	var req credentials
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&req); err != nil {
		writeAuthError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	if req.Username == "" || req.Password == "" {
		writeAuthError(w, http.StatusBadRequest, "bad_request", "Username and password are required.")
		return
	}
	var count int
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		internal()
		return
	}
	var (
		u   model.User
		err error
	)
	if count == 0 {
		// The bootstrap insert re-checks emptiness atomically; losing a
		// race to another first registration falls through to the
		// admin-required path.
		err = s.withHashGate(r.Context(), func() error {
			var e error
			u, e = s.hash.createFirstUser(r.Context(), s.db, req.Username, req.Password)
			return e
		})
		if errors.Is(err, auth.ErrNotFirst) {
			count = 1
		}
	}
	if count != 0 {
		if !isAdmin {
			writeAuthError(w, http.StatusForbidden, "admin_required", "Registration needs an administrator.")
			return
		}
		err = s.withHashGate(r.Context(), func() error {
			var e error
			u, e = s.hash.createUser(r.Context(), s.db, req.Username, req.Password, false)
			return e
		})
	}
	switch {
	case err != nil && r.Context().Err() != nil:
		writeClientGone(w)
	case errors.Is(err, auth.ErrUsernameTaken):
		writeAuthError(w, http.StatusConflict, "username_taken", "That username is taken.")
	case errors.Is(err, errHashBusy):
		writeBusy(w)
	case err != nil:
		internal()
	default:
		writeJSON(w, http.StatusCreated, u)
	}
}

// handleLogin verifies credentials and returns a fresh bearer session token.
// Order of checks (design spec "Policy"): body, client bucket (L1), decode,
// (client, username) backoff (L2), username bucket (L3) unless the pair is
// known-good, then the hash behind the gate (L4). A locked key is refused
// before the password is looked at; only auth.ErrBadCredentials counts as
// a failure. Unknown usernames take exactly the same path as known ones.
func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	body, ok := readAuthBody(w, r)
	if !ok {
		return
	}
	l := s.limits
	client := clientKeyString(s.clientIP(r))
	if _, ok := s.clientTake(w, r, "sign-in attempts"); !ok {
		return
	}
	var req credentials
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&req); err != nil {
		writeAuthError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	if req.Username == "" || req.Password == "" {
		writeAuthError(w, http.StatusBadRequest, "bad_request", "Username and password are required.")
		return
	}
	now := s.now()
	pair := l.keyer.Key("pair", client, req.Username)
	account := l.keyer.Key("account", req.Username)
	if ok, retry := l.pair.Begin(pair, now); !ok {
		s.logThrottled("pair")
		writeRateLimited(w, retry)
		return
	}
	tookAccount := false
	if !l.pair.KnownGood(pair, now) {
		if ok, retry := l.account.Take(account, now); !ok {
			l.pair.Abort(pair)
			s.logThrottled("account")
			writeRateLimited(w, retry)
			return
		}
		tookAccount = true
	}
	refund := func() {
		if tookAccount {
			l.account.Refund(account, s.now())
		}
	}
	var token string
	err := s.withHashGate(r.Context(), func() error {
		var err error
		token, err = s.hash.login(r.Context(), s.db, req.Username, req.Password)
		return err
	})
	switch {
	case errors.Is(err, auth.ErrBadCredentials):
		l.pair.Fail(pair, s.now()) // the account token stays spent
		writeAuthError(w, http.StatusUnauthorized, "bad_credentials", "Wrong username or password.")
	case err != nil && r.Context().Err() != nil:
		l.pair.Abort(pair) // the client went away: nothing to count, nothing to say
		refund()
		writeClientGone(w)
	case errors.Is(err, errHashBusy):
		l.pair.Abort(pair)
		refund()
		writeBusy(w)
	case err != nil:
		l.pair.Abort(pair)
		refund()
		writeAuthError(w, http.StatusInternalServerError, "internal", "Internal error.")
	default:
		l.pair.Succeed(pair, s.now())
		refund()
		writeJSON(w, http.StatusOK, map[string]string{"token": token})
	}
}

// handleMe returns the authenticated user.
func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// requireUser resolves the user behind the request's bearer token, writing
// 401 and returning nil when the request is unauthenticated.
func (s *server) requireUser(w http.ResponseWriter, r *http.Request) *model.User {
	u, err := auth.UserFromRequest(r, s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return nil
	}
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return nil
	}
	return u
}

// requireAdmin resolves the user behind the request's bearer token, writing
// 403 and returning nil for unauthenticated and non-admin callers alike:
// either way the caller may not act as admin.
func (s *server) requireAdmin(w http.ResponseWriter, r *http.Request) *model.User {
	u, err := auth.UserFromRequest(r, s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return nil
	}
	if u == nil || !u.Admin {
		http.Error(w, "admin token required", http.StatusForbidden)
		return nil
	}
	return u
}
