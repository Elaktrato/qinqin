package api

import (
	"context"
	"errors"
	"log"
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

// First factors: what proved the person before the second step.
const (
	factorPassword  = "password"
	factorEmailCode = "email_code" // an emailed sign-in code
	factorReset     = "reset"      // a reset link
)

var (
	// errPasswordRequired: an emailed code alone is one factor, so a user whose
	// only second step is email must use the password.
	errPasswordRequired = errors.New("password required")
	// errMailUnavailable: the account's second step is an emailed code and mail
	// does not work. Sign-in fails closed instead of skipping the step.
	errMailUnavailable = errors.New("mail unavailable")
)

// emailMethodUsable: the address is verified, the policy uses addresses and
// mail works.
func (s *server) emailMethodUsable(ctx context.Context, u model.User, set auth.Settings) bool {
	return u.Email != nil && u.EmailVerified && set.EmailPolicy != "off" && s.mailConfigured(ctx)
}

// planSignIn applies the rules of the smtp-mfa spec section 5 after a first
// factor was proven:
//  1. an authenticator -> second step (totp, recovery, + email when that
//     method is on and usable);
//  2. the email method on and usable -> email;
//  3. enforced (and mail works) with a verified address -> email;
//  4. enforced -> an enrolment session;
//  5. nothing.
//
// The email method is offered only after a PASSWORD: a reset link or an
// emailed sign-in code already proved the mailbox, and the mailbox must not
// also be the second factor. After those, an authenticator is asked for; a
// user without one whose second step is email gets no session (a reset answers
// "changed": sign in with the new password; an emailed code answers
// errPasswordRequired). A user whose only second step is email is
// mailbox-only by construction and fails closed (errMailUnavailable) while
// mail is down.
func (s *server) planSignIn(ctx context.Context, u model.User, factor string) (signInPlan, error) {
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
	addr := u.Email != nil && u.EmailVerified && set.EmailPolicy != "off"
	// Would this account have an email second step if mail worked?
	dependent := !st.TOTP && (st.Email || (set.MFAEnforced && addr))
	switch {
	case st.TOTP:
		methods := []string{"totp", "recovery"}
		if factor == factorPassword && st.Email && usable {
			methods = append(methods, "email")
		}
		return signInPlan{kind: "challenge", methods: methods}, nil
	case factor == factorEmailCode:
		if dependent || enforced {
			return signInPlan{}, errPasswordRequired
		}
		return signInPlan{}, nil
	case factor == factorReset:
		switch {
		case dependent:
			return signInPlan{kind: "changed"}, nil
		case enforced:
			return signInPlan{kind: "enroll", methods: s.enrolMethods(ctx, set)}, nil
		}
		return signInPlan{}, nil
	case dependent && !usable:
		return signInPlan{}, errMailUnavailable
	case st.Email && usable, enforced && usable:
		return signInPlan{kind: "challenge", methods: []string{"email"}}, nil
	case enforced:
		return signInPlan{kind: "enroll", methods: s.enrolMethods(ctx, set)}, nil
	}
	return signInPlan{}, nil
}

func (s *server) enrolMethods(ctx context.Context, set auth.Settings) []string {
	var methods []string
	if s.mfa.Available() {
		methods = append(methods, "totp")
	}
	if s.mailConfigured(ctx) && set.EmailPolicy != "off" {
		methods = append(methods, "email")
	}
	return methods
}

// writeMailOutage answers a sign-in that fails closed, and logs the condition
// once per start (no address, no user).
func (s *server) writeMailOutage(w http.ResponseWriter) {
	s.mailDownLog.Do(func() {
		log.Printf("auth: sign-in refused: accounts whose second step is an emailed code cannot sign in while email is not working (fix Admin, Email, or qinqin recover --reset-mfa)")
	})
	w.Header().Set("Retry-After", "60")
	writeError(w, http.StatusServiceUnavailable, "mail_outage", "Two-step sign-in by email is not working right now because the server cannot send mail. Ask an administrator.")
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
func (s *server) respondSignIn(w http.ResponseWriter, r *http.Request, u model.User, plan signInPlan, token, device, factor string) {
	if plan.kind == "changed" {
		writeJSON(w, http.StatusOK, map[string]any{"status": "password_changed"})
		return
	}
	if plan.challenge() {
		ctok, ch, err := auth.NewChallenge(r.Context(), s.db, auth.ChallengeMFA, &u.ID, "", device)
		if err != nil {
			writeInternal(w, r)
			return
		}
		if err := auth.SetChallengeFactor(r.Context(), s.db, ch.ID, factor, plan.methods); err != nil {
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
	// Only what the challenge was issued with may be answered: after a reset
	// link or an emailed sign-in code the mailbox is never the second step.
	if !ch.HasMethod("email") {
		writeError(w, http.StatusConflict, "method_unavailable", "Email codes are not available for this sign-in.")
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
		writeError(w, http.StatusConflict, "method_unavailable", "Email codes are not available for this account.")
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
		s.mailCode(u.ID, mail.KindMFACode, *u.Email, code, r.Header.Get("Accept-Language"))
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
		writeError(w, http.StatusBadRequest, "bad_request", "The method must be totp, recovery or email.")
		return
	}
	ch, u, ok := s.mfaChallenge(w, r, req.Challenge)
	if !ok {
		return
	}
	if !ch.HasMethod(req.Method) {
		writeError(w, http.StatusConflict, "method_unavailable", "That method is not available for this sign-in.")
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
	s.respondSignIn(w, r, u, signInPlan{}, token, ch.Device, factorPassword)
}

// emailLoginAvailable: mail works and the administrator turned the switch on.
func (s *server) emailLoginAvailable(w http.ResponseWriter, r *http.Request) bool {
	set, err := auth.LoadSettings(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return false
	}
	if !set.EmailCodeLogin || !s.mailConfigured(r.Context()) {
		writeError(w, http.StatusConflict, "email_login_unavailable", "Signing in with an emailed code is not turned on here.")
		return false
	}
	return true
}

// handleEmailLoginStart serves POST /api/auth/email-login/start {login,
// deviceName?}: always 202 {challenge, resendAfter, expiresAt}, whether or
// not the identifier is a known, enabled user with a verified address. An
// unknown (or ineligible) identifier gets a real challenge row without a user
// and a code nobody receives, after the same lookups, limiter work and
// storage as a known one; only the mail is not queued, and that is
// asynchronous. The 5-per-hour identifier limit applies to both alike.
func (s *server) handleEmailLoginStart(w http.ResponseWriter, r *http.Request) {
	if !s.emailLoginAvailable(w, r) {
		return
	}
	if _, ok := s.clientTake(w, r, "attempts"); !ok {
		return
	}
	if !s.mailRequestBudget(w, r) {
		return
	}
	var req struct {
		Login      string `json:"login"`
		DeviceName string `json:"deviceName"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	login := strings.TrimSpace(req.Login)
	if login == "" || len(login) > 320 {
		writeError(w, http.StatusBadRequest, "bad_request", "Enter your username or email address.")
		return
	}
	if ok, retry := s.authLimiter("ident").Allow(identKey(login)); !ok {
		s.logThrottled("ident")
		writeRateLimitedAs(w, retry, "requests")
		return
	}
	target, err := auth.FindMailTarget(r.Context(), s.db, login)
	set, serr := auth.LoadSettings(r.Context(), s.db)
	if err != nil || serr != nil {
		writeInternal(w, r)
		return
	}
	eligible := target.UserID != 0 && target.Eligible && set.EmailPolicy != "off"
	device := req.DeviceName
	if device == "" {
		device = auth.DeviceLabel(r.UserAgent())
	}
	var uid *int64
	ident := identKey(login) // unknown challenges remember it, so their wrong-code budget is per identifier
	if eligible {
		uid, ident = &target.UserID, ""
	}
	token, ch, err := auth.NewChallenge(r.Context(), s.db, auth.ChallengeEmailLogin, uid, ident, device)
	if err != nil {
		writeInternal(w, r)
		return
	}
	code, err := auth.SetCode(r.Context(), s.db, ch.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	// The same mail-budget work for every identifier (a dummy key when unknown).
	key := "none"
	if eligible {
		key = int64Key(target.UserID)
	}
	if allowed, _ := s.authLimiter("mailcode").Allow(key); eligible && allowed {
		s.mail.Enqueue(mail.Job{Kind: mail.KindLoginCode, UserID: target.UserID, To: target.Email, AcceptLanguage: r.Header.Get("Accept-Language"), Data: mail.TemplateData{Code: code}})
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"challenge": token, "resendAfter": int(auth.ResendEvery.Seconds()),
		"expiresAt": ch.ExpiresAt.UTC().Format(time.RFC3339)})
}

// handleEmailLoginVerify serves POST /api/auth/email-login/verify
// {challenge, code}. Success answers like a login: ok, password_change_required,
// or mfa_required (totp, recovery) for a user with an authenticator; under
// enforcement a user without one gets 403 password_required.
func (s *server) handleEmailLoginVerify(w http.ResponseWriter, r *http.Request) {
	if !s.emailLoginAvailable(w, r) {
		return
	}
	if _, ok := s.clientTake(w, r, "attempts"); !ok {
		return
	}
	var req struct {
		Challenge string `json:"challenge"`
		Code      string `json:"code"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	ch, err := auth.LoadChallenge(r.Context(), s.db, req.Challenge)
	if err == nil && ch.Kind != auth.ChallengeEmailLogin {
		err = auth.ErrChallengeInvalid
	}
	if err != nil {
		if errors.Is(err, auth.ErrChallengeInvalid) {
			writeCodeError(w, err, false)
		} else {
			writeInternal(w, r)
		}
		return
	}
	budgetKey := ch.UserID
	// Its own budget: guesses at a sign-in code must not drain the user's
	// second-step budget, or anyone could lock the real user out.
	refund, ok := s.codeBudgetKey(w, "el:"+int64Key(budgetKey), "el-u:"+ch.EmailNorm, ch.UserID == 0)
	if !ok {
		return
	}
	if _, err := auth.VerifyCode(r.Context(), s.db, req.Challenge, req.Code); err != nil {
		if !writeCodeError(w, err, false) {
			writeInternal(w, r)
		}
		return
	}
	if ch.UserID == 0 {
		// A challenge for an unknown identifier can never sign anyone in.
		writeError(w, http.StatusUnauthorized, "code_invalid", "That code is not right.", map[string]any{"attemptsLeft": 0})
		return
	}
	refund()
	u, err := auth.LoadUser(r.Context(), s.db, ch.UserID)
	var disabled int
	if err == nil {
		err = s.db.QueryRowContext(r.Context(), `SELECT disabled_at IS NOT NULL FROM users WHERE id = ?`, ch.UserID).Scan(&disabled)
	}
	if err != nil || disabled != 0 {
		writeCodeError(w, auth.ErrChallengeInvalid, false)
		return
	}
	plan, err := s.planSignIn(r.Context(), u, factorEmailCode)
	if errors.Is(err, errPasswordRequired) {
		writeError(w, http.StatusForbidden, "password_login_required", "Two-step sign-in is required here: sign in with your password.")
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	token := ""
	if !plan.challenge() {
		if token, err = auth.NewSession(r.Context(), s.db, u.ID, auth.LoginOptions{Device: ch.Device}); err != nil {
			writeInternal(w, r)
			return
		}
	}
	s.respondSignIn(w, r, u, plan, token, ch.Device, factorEmailCode)
}
