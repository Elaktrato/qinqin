package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/mail"
	"qinqin/internal/model"
)

// signInPlan is what follows a proven password (or a proven emailed code):
// nothing, a second step, or a restricted enrolment session.
type signInPlan struct {
	kind    string // "" none, "challenge", "enroll"
	methods []string
}

func (p signInPlan) challenge() bool { return p.kind == "challenge" }

func (p signInPlan) sessionPlan() auth.SessionPlan {
	switch p.kind {
	case "challenge":
		return auth.SessionPlan{Defer: true}
	case "enroll":
		return auth.SessionPlan{Level: auth.LevelEnroll}
	}
	return auth.SessionPlan{}
}

func (p signInPlan) has(method string) bool {
	for _, m := range p.methods {
		if m == method {
			return true
		}
	}
	return false
}

// errPasswordRequired: an emailed code alone is one factor, so under
// enforcement a user without an authenticator must use the password.
var errPasswordRequired = errors.New("password required")

// emailMethodUsable: the address is verified, the policy uses addresses and
// mail works.
func (s *server) emailMethodUsable(ctx context.Context, u model.User, set auth.Settings) bool {
	return u.Email != nil && u.EmailVerified && set.EmailPolicy != "off" && s.mailConfigured(ctx)
}

// planSignIn applies the rules of the smtp-mfa spec section 5 after the
// password (or, with viaEmailCode, the emailed code) was proven:
//  1. an authenticator -> second step (totp, recovery, + email when that
//     method is on and usable);
//  2. the email method on and usable -> email;
//  3. enforced (and mail works) with a verified address -> email;
//  4. enforced -> an enrolment session;
//  5. nothing.
//
// With viaEmailCode the emailed code already was one factor: only an
// authenticator may follow, and enforcement without one needs the password.
func (s *server) planSignIn(ctx context.Context, u model.User, viaEmailCode bool) (signInPlan, error) {
	st, err := auth.LoadMFAState(ctx, s.db, u.ID)
	if err != nil {
		return signInPlan{}, err
	}
	set, err := auth.LoadSettings(ctx, s.db)
	if err != nil {
		return signInPlan{}, err
	}
	enforced := s.mfaEnforcedEffective(ctx, set)
	usable := s.emailMethodUsable(ctx, u, set)
	switch {
	case st.TOTP:
		methods := []string{"totp", "recovery"}
		if !viaEmailCode && st.Email && usable {
			methods = append(methods, "email")
		}
		return signInPlan{"challenge", methods}, nil
	case viaEmailCode && enforced:
		return signInPlan{}, errPasswordRequired
	case viaEmailCode:
		return signInPlan{}, nil
	case st.Email && usable, enforced && usable:
		return signInPlan{"challenge", []string{"email"}}, nil
	case enforced:
		var methods []string
		if s.mfa.Available() {
			methods = append(methods, "totp")
		}
		if s.mailConfigured(ctx) && set.EmailPolicy != "off" {
			methods = append(methods, "email")
		}
		return signInPlan{"enroll", methods}, nil
	}
	return signInPlan{}, nil
}

// maskEmail shows enough of an address to recognise it: "a•••@e•••.org".
func maskEmail(addr string) string {
	local, domain, ok := strings.Cut(addr, "@")
	if !ok || local == "" || domain == "" {
		return ""
	}
	host, tld := domain, ""
	if i := strings.LastIndex(domain, "."); i > 0 {
		host, tld = domain[:i], domain[i:]
	}
	first := func(s string) string {
		for _, r := range s {
			return string(r)
		}
		return ""
	}
	return first(local) + "•••@" + first(host) + "•••" + tld
}

// respondSignIn writes the answer of a proven password: a session, the
// second-step challenge, or the enrolment session.
func (s *server) respondSignIn(w http.ResponseWriter, r *http.Request, u model.User, plan signInPlan, token, device string) {
	if plan.challenge() {
		ctok, ch, err := auth.NewChallenge(r.Context(), s.db, auth.ChallengeMFA, &u.ID, "", device)
		if err != nil {
			writeInternal(w, r)
			return
		}
		var hint any
		if plan.has("email") && u.Email != nil {
			hint = maskEmail(*u.Email)
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "mfa_required", "challenge": ctok, "methods": plan.methods,
			"emailHint": hint, "expiresAt": ch.ExpiresAt.UTC().Format(time.RFC3339)})
		return
	}
	status := "ok"
	switch {
	case u.MustChangePassword:
		status = "password_change_required"
	case plan.kind == "enroll":
		status = "mfa_enrollment_required"
	}
	s.hideEmailWhenOff(r, &u)
	body := map[string]any{"status": status, "token": token, "user": u}
	if plan.kind == "enroll" {
		body["methods"] = plan.methods
	}
	writeJSON(w, http.StatusOK, body)
}

// mfaChallenge loads the live challenge of a login second step and its
// user; false: a 401 challenge_expired was written.
func (s *server) mfaChallenge(w http.ResponseWriter, r *http.Request, token string) (auth.Challenge, model.User, bool) {
	ch, err := auth.LoadChallenge(r.Context(), s.db, token)
	if err == nil && (ch.Kind != auth.ChallengeMFA || ch.UserID == 0) {
		err = auth.ErrChallengeInvalid
	}
	var u model.User
	if err == nil {
		u, err = auth.LoadUser(r.Context(), s.db, ch.UserID)
		if err == nil {
			var disabled int
			s.db.QueryRowContext(r.Context(), `SELECT disabled_at IS NOT NULL FROM users WHERE id = ?`, ch.UserID).Scan(&disabled)
			if disabled != 0 {
				err = auth.ErrChallengeInvalid
			}
		}
	}
	switch {
	case errors.Is(err, auth.ErrChallengeInvalid), errors.Is(err, auth.ErrUserNotFound):
		writeCodeError(w, auth.ErrChallengeInvalid, false)
		return auth.Challenge{}, model.User{}, false
	case err != nil:
		writeInternal(w, r)
		return auth.Challenge{}, model.User{}, false
	}
	return ch, u, true
}

// handleLoginMFAEmail serves POST /api/auth/login/mfa/email {challenge}:
// mail a code for the second step (3 sends per challenge, 60 s apart).
func (s *server) handleLoginMFAEmail(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.clientTake(w, r, "attempts"); !ok {
		return
	}
	var req struct {
		Challenge string `json:"challenge"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	ch, u, ok := s.mfaChallenge(w, r, req.Challenge)
	if !ok {
		return
	}
	st, err := auth.LoadMFAState(r.Context(), s.db, u.ID)
	set, serr := auth.LoadSettings(r.Context(), s.db)
	if err != nil || serr != nil {
		writeInternal(w, r)
		return
	}
	// The email method is on offer exactly when the plan said so.
	eligible := s.emailMethodUsable(r.Context(), u, set) && (st.Email || (!st.TOTP && s.mfaEnforcedEffective(r.Context(), set)))
	if !eligible {
		writeAuthError(w, http.StatusConflict, "method_unavailable", "Email codes are not available for this account.")
		return
	}
	code, err := auth.SetCode(r.Context(), s.db, ch.ID)
	var ce *auth.CodeError
	switch {
	case errors.As(err, &ce):
		writeRateLimitedAs(w, ce.Retry, "code requests")
	case errors.Is(err, auth.ErrChallengeInvalid):
		writeCodeError(w, err, false)
	case err != nil:
		writeInternal(w, r)
	default:
		s.mailCode(u.ID, mail.KindMFACode, *u.Email, code)
		writeJSON(w, http.StatusAccepted, map[string]int{"resendAfter": int(auth.ResendEvery.Seconds())})
	}
}

// handleLoginMFA serves POST /api/auth/login/mfa {challenge, method, code}:
// the second step. Wrong codes are 401 code_invalid with attemptsLeft;
// five wrong codes (all methods together) or ten minutes end the challenge
// (401 challenge_expired); the per-user budget spans fresh challenges (429).
// Only now does a session come into being.
func (s *server) handleLoginMFA(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.clientTake(w, r, "attempts"); !ok {
		return
	}
	var req struct {
		Challenge string `json:"challenge"`
		Method    string `json:"method"`
		Code      string `json:"code"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	if req.Method != "totp" && req.Method != "recovery" && req.Method != "email" {
		writeAuthError(w, http.StatusBadRequest, "bad_request", "The method must be totp, recovery or email.")
		return
	}
	ch, u, ok := s.mfaChallenge(w, r, req.Challenge)
	if !ok {
		return
	}
	refund, ok := s.codeBudget(w, u.ID)
	if !ok {
		return
	}
	var checkErr error
	attemptsLeft := 0
	switch req.Method {
	case "email":
		if _, err := auth.VerifyCode(r.Context(), s.db, req.Challenge, req.Code); err != nil {
			checkErr = err
		}
	default:
		spent, err := auth.SpendAttempt(r.Context(), s.db, req.Challenge, auth.ChallengeMFA)
		if err != nil {
			checkErr = err
			break
		}
		attemptsLeft = spent.AttemptsLeft()
		if req.Method == "totp" {
			checkErr = s.mfa.VerifyTOTP(r.Context(), u.ID, req.Code, s.now())
		} else {
			checkErr = auth.UseRecoveryCode(r.Context(), s.db, u.ID, req.Code)
			if checkErr == nil {
				if aerr := auth.Audit(r.Context(), s.db, auth.AuditEvent{Action: "recovery_code_used", ActorID: u.ID, TargetID: &u.ID}); aerr != nil {
					writeInternal(w, r)
					return
				}
			}
		}
		if checkErr == nil {
			if derr := auth.DeleteChallenge(r.Context(), s.db, spent.ID); derr != nil {
				writeInternal(w, r)
				return
			}
		} else if errors.Is(checkErr, auth.ErrTOTPCodeInvalid) || errors.Is(checkErr, auth.ErrRecoveryInvalid) || errors.Is(checkErr, auth.ErrNoTOTP) || errors.Is(checkErr, auth.ErrMFAUnavailable) {
			if spent.Attempts >= auth.MaxAttempts {
				auth.ExhaustIfSpent(r.Context(), s.db, spent)
				checkErr = auth.ErrChallengeInvalid
			} else {
				checkErr = &auth.CodeError{Err: auth.ErrCodeWrong, AttemptsLeft: attemptsLeft}
			}
		}
	}
	if checkErr != nil {
		if !writeCodeError(w, checkErr, false) {
			writeInternal(w, r)
		}
		return
	}
	refund()
	token, err := auth.NewSession(r.Context(), s.db, u.ID, auth.LoginOptions{Device: ch.Device})
	if err != nil {
		writeInternal(w, r)
		return
	}
	s.respondSignIn(w, r, u, signInPlan{}, token, ch.Device)
}
