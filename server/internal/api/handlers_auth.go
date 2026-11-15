package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"slices"

	"qinqin/internal/auth"
	"qinqin/internal/model"
)

// credentials is the request body of /api/auth/register and /api/auth/login.
type credentials struct {
	Username   string  `json:"username"`
	Password   string  `json:"password"`
	DeviceName string  `json:"deviceName"` // login only; a client's own label for the session
	Email      *string `json:"email"`      // register only
	Invite     string  `json:"invite"`     // register only: the token from an invite link
}

// handleRegister creates a user (registration spec section 2). Order: the
// admin bearer check (an equality lookup, no hash), the client bucket for
// everyone else, the zero-users bootstrap (always allowed, becomes admin),
// the legacy admin path (a valid unrestricted admin creates a non-admin
// with the given password), then the instance mode: closed refuses,
// invite needs a valid invite, open takes anyone (an invite supplied in
// either mode is spent and must be valid). Every password hash runs behind
// the gate and before any transaction opens.
func (s *server) handleRegister(w http.ResponseWriter, r *http.Request) {
	body, ok := readAuthBody(w, r)
	if !ok {
		return
	}
	// An administrator's token is checked first (an equality lookup, no
	// hash): bulk creation is then never counted against the client
	// bucket, however many run in parallel. Everyone else pays one token.
	internal := func() { writeInternal(w, r) }
	caller, cerr := s.authenticate(r)
	if cerr != nil {
		internal()
		return
	}
	// A restricted admin session (forced password change) is no admin here;
	// a non-admin bearer is ignored and registers by the mode like anyone.
	isAdmin := caller != nil && caller.User.Admin && caller.Restriction() == ""
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
	req.Username = auth.NormalizeUsername(req.Username)
	if req.Username == "" || req.Password == "" {
		writeAuthError(w, http.StatusBadRequest, "bad_request", "Username and password are required.")
		return
	}
	var count int
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		internal()
		return
	}
	set, err := auth.LoadSettings(r.Context(), s.db)
	if err != nil {
		internal()
		return
	}
	// Who may register decides before any policy or taken check, so an
	// outsider learns nothing about usernames or emails.
	useInvite := false
	switch {
	case count == 0 || isAdmin:
	case req.Invite != "":
		if set.Registration == "closed" {
			writeAuthError(w, http.StatusForbidden, "registration_closed", registrationClosedMessage)
			return
		}
		useInvite = true
	case set.Registration == "closed":
		writeAuthError(w, http.StatusForbidden, "registration_closed", registrationClosedMessage)
		return
	case set.Registration == "invite":
		writeAuthError(w, http.StatusForbidden, "invite_invalid", inviteInvalidMessage)
		return
	}
	if useInvite {
		if _, err := auth.CheckInvite(r.Context(), s.db, req.Invite); errors.Is(err, auth.ErrInviteInvalid) {
			writeAuthError(w, http.StatusForbidden, "invite_invalid", inviteInvalidMessage)
			return
		} else if err != nil {
			internal()
			return
		}
	}
	if err := auth.CheckNewUsername(r.Context(), s.db, req.Username); err != nil {
		switch {
		case errors.Is(err, auth.ErrInvalidUsername):
			writeAuthError(w, http.StatusUnprocessableEntity, "invalid_username", auth.PolicyReason(err))
		case errors.Is(err, auth.ErrUsernameTaken):
			writeAuthError(w, http.StatusConflict, "username_taken", "That username is taken.")
		default:
			internal()
		}
		return
	}
	if err := auth.CheckPassword(req.Username, req.Password); err != nil {
		writeAuthError(w, http.StatusUnprocessableEntity, "weak_password", auth.PolicyReason(err))
		return
	}
	nu := auth.NewUser{Username: req.Username, EmailVerified: isAdmin}
	if !s.applyEmail(w, r, set.EmailPolicy, req.Email, &nu, 0) {
		return
	}
	var u model.User
	switch {
	case count == 0:
		// The bootstrap insert re-checks emptiness atomically; losing a
		// race to another first registration is a closed instance now.
		err = s.withHashGate(r.Context(), func() error {
			var e error
			u, e = s.hash.createFirstUser(r.Context(), s.db, req.Username, req.Password)
			return e
		})
		if errors.Is(err, auth.ErrNotFirst) {
			writeAuthError(w, http.StatusForbidden, "registration_closed", registrationClosedMessage)
			return
		}
		if err == nil && nu.Email != nil {
			// The validated address of the first account (policy required or
			// optional): stored unverified like any self-entered one.
			if err = auth.SetOwnEmail(r.Context(), s.db, u.ID, nu.Email, nu.EmailNorm); err == nil {
				u.Email = nu.Email
			}
		}
	case isAdmin && req.Email == nil:
		err = s.withHashGate(r.Context(), func() error {
			var e error
			u, e = s.hash.createUser(r.Context(), s.db, req.Username, req.Password, false)
			return e
		})
	default:
		err = s.withHashGate(r.Context(), func() error {
			nu.Hash = s.hash.hash(req.Password)
			return nil
		})
		if err == nil {
			if useInvite {
				u, err = auth.RegisterWithInvite(r.Context(), s.db, req.Invite, nu)
			} else {
				u, err = auth.CreateUserWith(r.Context(), s.db, nu)
			}
		}
	}
	switch {
	case err != nil && r.Context().Err() != nil:
		writeClientGone(w)
	case errors.Is(err, auth.ErrUsernameTaken):
		writeAuthError(w, http.StatusConflict, "username_taken", "That username is taken.")
	case errors.Is(err, auth.ErrEmailTaken):
		writeAuthError(w, http.StatusConflict, "email_taken", "That email address is already in use.")
	case errors.Is(err, auth.ErrInviteInvalid):
		writeAuthError(w, http.StatusForbidden, "invite_invalid", inviteInvalidMessage)
	case errors.Is(err, errHashBusy):
		writeBusy(w)
	case err != nil:
		internal()
	default:
		if isAdmin && count != 0 {
			// The legacy administrator path creates users too: it is audited
			// like the admin route (the row follows the insert).
			if aerr := auth.Audit(r.Context(), s.db, auth.AuditEvent{Action: "user_created", ActorID: caller.User.ID,
				TargetID: &u.ID, Detail: map[string]any{"forced": false}}); aerr != nil {
				log.Printf("auth: audit of a created user failed: %v", aerr)
			}
		}
		writeJSON(w, http.StatusCreated, u)
	}
}

const (
	registrationClosedMessage = "Registration is closed. Ask an administrator for an invite link or an account."
	inviteInvalidMessage      = "This invite link is no longer valid."
)

// applyEmailFormat validates the request's email against the policy and
// fills nu (no database lookup); false means an error response was written.
func (s *server) applyEmailFormat(w http.ResponseWriter, r *http.Request, policy string, email *string, nu *auth.NewUser) bool {
	disp, norm, err := auth.ApplyEmailPolicy(policy, email)
	switch {
	case errors.Is(err, auth.ErrEmailRequired):
		writeAuthError(w, http.StatusUnprocessableEntity, "email_required", "An email address is required.")
		return false
	case errors.Is(err, auth.ErrEmailDisabled):
		writeAuthError(w, http.StatusUnprocessableEntity, "email_disabled", "This instance does not use email addresses.")
		return false
	case errors.Is(err, auth.ErrEmailLocalNotASCII):
		writeAuthError(w, http.StatusUnprocessableEntity, "invalid_email", "Use an address whose part before the @ has only ASCII letters, digits and symbols (internationalised mailbox names are not supported yet).")
		return false
	case errors.Is(err, auth.ErrInvalidEmail):
		writeAuthError(w, http.StatusUnprocessableEntity, "invalid_email", "Enter a valid email address.")
		return false
	case err != nil:
		writeInternal(w, r)
		return false
	}
	nu.Email, nu.EmailNorm = disp, norm
	return true
}

// applyEmail is applyEmailFormat plus the "taken" lookup (registration and
// admin routes, where the caller is allowed to learn it).
func (s *server) applyEmail(w http.ResponseWriter, r *http.Request, policy string, email *string, nu *auth.NewUser, exceptID int64) bool {
	if !s.applyEmailFormat(w, r, policy, email, nu) {
		return false
	}
	if nu.EmailNorm != nil {
		taken, err := auth.EmailTaken(r.Context(), s.db, *nu.EmailNorm, exceptID)
		if err != nil {
			writeInternal(w, r)
			return false
		}
		if taken {
			writeAuthError(w, http.StatusConflict, "email_taken", "That email address is already in use.")
			return false
		}
	}
	return true
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
	device := req.DeviceName
	if device == "" {
		device = auth.DeviceLabel(r.UserAgent())
	}
	var res auth.LoginResult
	err := s.withHashGate(r.Context(), func() error {
		var err error
		res, err = s.hash.login(r.Context(), s.db, req.Username, req.Password, auth.LoginOptions{Device: device})
		return err
	})
	switch {
	case errors.Is(err, auth.ErrAccountDisabled):
		// The password was right, so this is not a failure to count.
		l.pair.Succeed(pair, s.now())
		refund()
		writeAuthError(w, http.StatusForbidden, "account_disabled", "This account has been disabled. Ask an administrator.")
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
		status := "ok"
		if res.User.MustChangePassword {
			status = "password_change_required"
		}
		s.hideEmailWhenOff(r, &res.User)
		writeJSON(w, http.StatusOK, map[string]any{"status": status, "token": res.Token, "user": res.User})
	}
}

// hideEmailWhenOff blanks a stored email in the user object while the
// instance email policy is off: nothing personal is shown for a feature
// that is switched off (the address is kept and returns with the policy).
func (s *server) hideEmailWhenOff(r *http.Request, u *model.User) {
	if u.Email == nil {
		return
	}
	if set, err := auth.LoadSettings(r.Context(), s.db); err == nil && set.EmailPolicy == "off" {
		u.Email, u.EmailVerified = nil, false
	}
}

// handleAuthOptions serves GET /api/auth/options: the instance-level
// switches the sign-in and register pages (and the Kotlin client) need
// before anyone is signed in. Public, never cached.
func (s *server) handleAuthOptions(w http.ResponseWriter, r *http.Request) {
	set, err := auth.LoadSettings(r.Context(), s.db)
	var count int
	if err == nil {
		err = s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM users`).Scan(&count)
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	mail := s.mailConfigured()
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"bootstrap":         count == 0,
		"registration":      set.Registration,
		"emailPolicy":       set.EmailPolicy,
		"passwordReset":     mail,
		"emailCodeLogin":    mail && set.EmailCodeLogin,
		"passwordMinLength": auth.MinPasswordRunes,
	})
}

// handleLogout deletes the session the request came in on (204). A
// restricted session may log out: it is the way out of a forced change.
func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r, restrictionPasswordChange, restrictionMFAEnrollment)
	if p == nil {
		return
	}
	if _, err := auth.RevokeSession(r.Context(), s.db, p.User.ID, p.SessionID); err != nil {
		writeInternal(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleMe returns the authenticated user.
func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r, restrictionPasswordChange, restrictionMFAEnrollment)
	if p == nil {
		return
	}
	s.hideEmailWhenOff(r, &p.User)
	// me is the user object plus what the session may do: "restriction" is
	// "", "password_change" or "mfa_enrollment".
	writeJSON(w, http.StatusOK, struct {
		model.User
		Restriction string `json:"restriction"`
		// NeedsCurrentPassword tells the change-password form whether to ask
		// for the current password up front (everything but the session born
		// from the temporary-password login).
		NeedsCurrentPassword bool `json:"needsCurrentPassword"`
	}{p.User, p.Restriction(), !p.TemporarySession})
}

// The access gate. Every handler reaches a session through one of the
// helpers below; handlers_auth.go is the only file allowed to call
// auth.Authenticate (gate_static_test.go enforces it). A session restricted
// by a forced password change or an MFA enrolment is refused by default:
// only routes that list the restriction in requirePrincipal accept it.

const (
	restrictionPasswordChange = "password_change"
	restrictionMFAEnrollment  = "mfa_enrollment"
)

// restrictionError maps a restriction to its 403 code and sentence.
func restrictionError(restriction string) (code, message string) {
	if restriction == restrictionPasswordChange {
		return "password_change_required", "You must choose a new password before you continue."
	}
	return "mfa_enrollment_required", "You must set up two-factor authentication before you continue."
}

func writeInternal(w http.ResponseWriter, r *http.Request) {
	if r.Context().Err() != nil {
		writeClientGone(w)
		return
	}
	writeAuthError(w, http.StatusInternalServerError, "internal", "Internal error.")
}

// authenticate resolves the session of r: nil with no error is anonymous.
func (s *server) authenticate(r *http.Request) (*auth.Principal, error) {
	return auth.Authenticate(r, s.db)
}

// requirePrincipal resolves the session behind r, writing 401 for an
// anonymous caller and 403 password_change_required / mfa_enrollment_required
// for a restricted session whose restriction is not in allow. It returns nil
// after writing.
func (s *server) requirePrincipal(w http.ResponseWriter, r *http.Request, allow ...string) *auth.Principal {
	p, err := s.authenticate(r)
	if err != nil {
		writeInternal(w, r)
		return nil
	}
	if p == nil {
		writeAuthError(w, http.StatusUnauthorized, "unauthorized", "Sign in to continue.")
		return nil
	}
	if res := p.Restriction(); res != "" && !slices.Contains(allow, res) {
		code, msg := restrictionError(res)
		writeAuthError(w, http.StatusForbidden, code, msg)
		return nil
	}
	return p
}

// requireUser resolves the user behind the request's bearer token for a
// full session, writing 401 for an anonymous caller and 403 for a restricted
// one. It returns nil after writing.
func (s *server) requireUser(w http.ResponseWriter, r *http.Request) *model.User {
	p := s.requirePrincipal(w, r)
	if p == nil {
		return nil
	}
	return &p.User
}

// requireAdmin resolves an administrator's full session. Anonymous and
// non-admin callers get 403 forbidden (either way the caller may not act as
// admin); a restricted session gets its restriction code, checked before the
// admin bit.
func (s *server) requireAdmin(w http.ResponseWriter, r *http.Request) *model.User {
	p, err := s.authenticate(r)
	if err != nil {
		writeInternal(w, r)
		return nil
	}
	if p != nil {
		if res := p.Restriction(); res != "" {
			code, msg := restrictionError(res)
			writeAuthError(w, http.StatusForbidden, code, msg)
			return nil
		}
	}
	if p == nil || !p.User.Admin {
		writeAuthError(w, http.StatusForbidden, "forbidden", "Administrator access is required.")
		return nil
	}
	return &p.User
}

// optionalUser is the signed-in user of a full session, nil for anonymous
// callers and for restricted sessions (they see what anyone sees).
func (s *server) optionalUser(r *http.Request) *model.User {
	p, err := s.authenticate(r)
	if err != nil || p == nil || p.Restriction() != "" {
		return nil
	}
	return &p.User
}
