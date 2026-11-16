package api

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/mail"
	"qinqin/internal/model"
)

// mfaEnforcedEffective is the instance switch counted only while mail is
// configured: without mail enforcement and email codes are inactive.
func (s *server) mfaEnforcedEffective(ctx context.Context, set auth.Settings) bool {
	return set.MFAEnforced && s.mailConfigured(ctx)
}

// codeBudget spends one token of the per-user wrong-code budgets (10 per 15
// minutes, 30 per day) before a code is checked; false means a 429 was
// written. The returned func gives both tokens back after a right code, so
// only wrong guesses use the budget.
func (s *server) codeBudget(w http.ResponseWriter, userID int64) (refund func(), ok bool) {
	return s.codeBudgetKey(w, int64Key(userID), "", false)
}

// codeBudgetKey is codeBudget with the key chosen by the caller: the sign-in
// by emailed code keys an unknown identifier's challenge by the identifier
// (unknown = true), so a known and an unknown identifier hit the limit alike.
func (s *server) codeBudgetKey(w http.ResponseWriter, userKey, otherKey string, unknown bool) (refund func(), ok bool) {
	key := userKey
	if unknown {
		key = otherKey
	}
	return s.codeBudgetNamed(w, key, "mfa", "mfa-day")
}

// codeBudgetNamed spends one token of the named per-key code budgets (a
// short and a daily bucket).
func (s *server) codeBudgetNamed(w http.ResponseWriter, key, short, day string) (refund func(), ok bool) {
	m, d := s.authLimiter(short), s.authLimiter(day)
	if ok, retry := m.Allow(key); !ok {
		s.logThrottled(short)
		writeRateLimitedAs(w, retry, "code attempts")
		return nil, false
	}
	if ok, retry := d.Allow(key); !ok {
		m.(refunder).Refund(key)
		s.logThrottled(day)
		writeRateLimitedAs(w, retry, "code attempts")
		return nil, false
	}
	return func() { m.(refunder).Refund(key); d.(refunder).Refund(key) }, true
}

// totpIssuer is the label authenticator apps show: "qinqin", plus the site
// host when a public URL is known.
func (s *server) totpIssuer(ctx context.Context) string {
	if s.mail != nil && s.mail.Store != nil {
		if c, err := s.mail.Store.Load(ctx); err == nil && c != nil && c.Site() != "" {
			return "qinqin (" + c.Site() + ")"
		}
	}
	return "qinqin"
}

func otpauthURI(issuer, username, secret string) string {
	q := url.Values{}
	q.Set("secret", secret)
	q.Set("issuer", issuer)
	q.Set("algorithm", "SHA1")
	q.Set("digits", "6")
	q.Set("period", "30")
	return "otpauth://totp/" + url.PathEscape(issuer) + ":" + url.PathEscape(username) + "?" + q.Encode()
}

func (s *server) writeMFAError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, auth.ErrMFAUnavailable):
		writeAuthError(w, http.StatusConflict, "secret_unavailable", "Two-factor authentication needs QINQIN_SECRET to be set on the server.")
	default:
		writeInternal(w, r)
	}
}

// secondFactorOK checks a TOTP or recovery code of a user who has an
// authenticator (disable, regenerate, replace). A wrong code is 403
// code_invalid and counts against the per-user budget. False: a response was
// written.
func (s *server) secondFactorOK(w http.ResponseWriter, r *http.Request, userID int64, code string) bool {
	refund, ok := s.codeBudget(w, userID)
	if !ok {
		return false
	}
	return s.checkSecondFactor(w, r, userID, code, refund)
}

// adminReauthCodeOK is secondFactorOK on the administrator re-authentication
// budget ("reauth-code"), so wrong codes there cannot lock the administrator
// out of signing in.
func (s *server) adminReauthCodeOK(w http.ResponseWriter, r *http.Request, userID int64, code string) bool {
	refund, ok := s.codeBudgetNamed(w, int64Key(userID), "reauth-code", "reauth-code-day")
	if !ok {
		return false
	}
	return s.checkSecondFactor(w, r, userID, code, refund)
}

func (s *server) checkSecondFactor(w http.ResponseWriter, r *http.Request, userID int64, code string, refund func()) bool {
	err := s.mfa.VerifyTOTP(r.Context(), userID, code, s.now())
	if errors.Is(err, auth.ErrTOTPCodeInvalid) {
		err = auth.UseRecoveryCode(r.Context(), s.db, userID, code)
		if errors.Is(err, auth.ErrRecoveryInvalid) {
			err = auth.ErrTOTPCodeInvalid
		}
	}
	switch {
	case err == nil:
		refund()
		return true
	case errors.Is(err, auth.ErrTOTPCodeInvalid):
		writeAuthError(w, http.StatusForbidden, "code_invalid", "That code is not right.")
	case errors.Is(err, auth.ErrMFAUnavailable):
		// The secret cannot be read: only a recovery code can prove it.
		if rerr := auth.UseRecoveryCode(r.Context(), s.db, userID, code); rerr == nil {
			refund()
			return true
		}
		writeAuthError(w, http.StatusForbidden, "code_invalid", "That code is not right.")
	default:
		writeInternal(w, r)
	}
	return false
}

// handleTOTPSetup serves POST /api/account/mfa/totp/setup {password, code?}:
// a full session re-asks the password (an enrolment session does not), and a
// user who already has an authenticator must also give a current code before
// a replacement may start. The secret is returned once.
func (s *server) handleTOTPSetup(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r, restrictionMFAEnrollment)
	if p == nil {
		return
	}
	var req struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	if !s.mfa.Available() {
		s.writeMFAError(w, r, auth.ErrMFAUnavailable)
		return
	}
	if p.Restriction() == "" && !s.verifyOwnPassword(w, r, p.User.ID, req.Password) {
		return
	}
	has, err := auth.HasTOTP(r.Context(), s.db, p.User.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if has && !s.secondFactorOK(w, r, p.User.ID, req.Code) {
		return
	}
	secret, expires, err := s.mfa.BeginTOTP(r.Context(), p.User.ID, s.now())
	if err != nil {
		s.writeMFAError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{
		"secret":     secret,
		"otpauthUri": otpauthURI(s.totpIssuer(r.Context()), p.User.Username, secret),
		"expiresAt":  expires.UTC().Format(time.RFC3339),
	})
}

// handleTOTPConfirm serves POST /api/account/mfa/totp/confirm {code}: the
// first code from the new authenticator turns TOTP on, returns the recovery
// codes once, and promotes an enrolment session to a full one.
func (s *server) handleTOTPConfirm(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r, restrictionMFAEnrollment)
	if p == nil {
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	refund, ok := s.codeBudget(w, p.User.ID)
	if !ok {
		return
	}
	codes, err := s.mfa.ConfirmTOTP(r.Context(), p.User.ID, req.Code, s.now())
	switch {
	case errors.Is(err, auth.ErrTOTPCodeInvalid):
		writeAuthError(w, http.StatusForbidden, "code_invalid", "That code is not right. Check the clock of your phone and try the next code.")
		return
	case errors.Is(err, auth.ErrNoPending):
		writeAuthError(w, http.StatusConflict, "setup_expired", "The setup has expired. Start again.")
		return
	case err != nil:
		s.writeMFAError(w, r, err)
		return
	}
	refund()
	if p.Level == auth.LevelEnroll {
		if err := auth.PromoteSession(r.Context(), s.db, p.User.ID, p.SessionID); err != nil {
			writeInternal(w, r)
			return
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"recoveryCodes": codes})
}

// otherMethodLeft reports whether the user would still have a second step
// if the given method went away, with enforcement counted as it is now.
func (s *server) otherMethodLeft(ctx context.Context, u model.User, st auth.MFAState, without string) bool {
	if without != "totp" && st.TOTP {
		return true
	}
	return without != "email" && st.Email && u.EmailVerified && s.mailConfigured(ctx)
}

// handleTOTPDisable serves DELETE /api/account/mfa/totp {password, code}.
func (s *server) handleTOTPDisable(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var req struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	st, err := auth.LoadMFAState(r.Context(), s.db, u.ID)
	set, serr := auth.LoadSettings(r.Context(), s.db)
	if err != nil || serr != nil {
		writeInternal(w, r)
		return
	}
	if !st.TOTP {
		writeAuthError(w, http.StatusConflict, "not_enabled", "Two-factor authentication with an authenticator is not on.")
		return
	}
	if s.mfaEnforcedEffective(r.Context(), set) && !s.otherMethodLeft(r.Context(), *u, st, "totp") {
		writeAuthError(w, http.StatusConflict, "mfa_required", "Two-step sign-in is required here: turn on email codes before you remove the authenticator.")
		return
	}
	if !s.verifyOwnPassword(w, r, u.ID, req.Password) || !s.secondFactorOK(w, r, u.ID, req.Code) {
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeInternal(w, r)
		return
	}
	defer tx.Rollback()
	if err := auth.RemoveTOTP(r.Context(), tx, u.ID); err != nil {
		writeInternal(w, r)
		return
	}
	if err := auth.Audit(r.Context(), tx, auth.AuditEvent{Action: "mfa_disabled", ActorID: u.ID, TargetID: &u.ID, Detail: map[string]any{"scope": "totp"}}); err != nil {
		writeInternal(w, r)
		return
	}
	if err := tx.Commit(); err != nil {
		writeInternal(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleRecoveryCodes serves POST /api/account/mfa/recovery-codes
// {password, code}: a new set replaces the old one (shown once).
func (s *server) handleRecoveryCodes(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var req struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	has, err := auth.HasTOTP(r.Context(), s.db, u.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if !has {
		writeAuthError(w, http.StatusConflict, "not_enabled", "Recovery codes belong to an authenticator: set one up first.")
		return
	}
	if !s.verifyOwnPassword(w, r, u.ID, req.Password) || !s.secondFactorOK(w, r, u.ID, req.Code) {
		return
	}
	codes, err := auth.NewRecoveryCodes(r.Context(), s.db, u.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"recoveryCodes": codes})
}

// handleMFAEmail serves POST /api/account/mfa/email {enabled, password}: the
// email method needs a verified address that the instance policy still uses
// and a working mail server. A full session proves the password and the
// method turns on at once. An ENROLMENT session proves nothing yet: it gets a
// code mailed to the address and stays restricted until
// POST /api/account/mfa/email/confirm has verified that code (202), so a stale
// or unreachable address can never end the restriction.
func (s *server) handleMFAEmail(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r, restrictionMFAEnrollment)
	if p == nil {
		return
	}
	var req struct {
		Enabled  bool   `json:"enabled"`
		Password string `json:"password"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	st, err := auth.LoadMFAState(r.Context(), s.db, p.User.ID)
	set, serr := auth.LoadSettings(r.Context(), s.db)
	if err != nil || serr != nil {
		writeInternal(w, r)
		return
	}
	if req.Enabled {
		if !s.mailConfigured(r.Context()) {
			writeAuthError(w, http.StatusConflict, "mail_unavailable", "Email codes need email to be set up on this server.")
			return
		}
		if !s.emailMethodUsable(r.Context(), p.User, set) {
			writeAuthError(w, http.StatusConflict, "email_unverified", "Confirm your email address first. Addresses must also be in use on this server.")
			return
		}
	} else if s.mfaEnforcedEffective(r.Context(), set) && !s.otherMethodLeft(r.Context(), p.User, st, "email") {
		writeAuthError(w, http.StatusConflict, "mfa_required", "Two-step sign-in is required here: set up an authenticator before you turn off email codes.")
		return
	}
	if p.Restriction() == "" && !s.verifyOwnPassword(w, r, p.User.ID, req.Password) {
		return
	}
	if req.Enabled && p.Level == auth.LevelEnroll {
		s.startEmailMethodConfirm(w, r, p.User)
		return
	}
	if err := s.setEmailMethod(r.Context(), p.User.ID, req.Enabled); err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"email": req.Enabled})
}

func (s *server) setEmailMethod(ctx context.Context, userID int64, on bool) error {
	if err := auth.SetMFAEmail(ctx, s.db, userID, on); err != nil {
		return err
	}
	action := "mfa_disabled"
	if on {
		action = "mfa_enabled"
	}
	return auth.Audit(ctx, s.db, auth.AuditEvent{Action: action, ActorID: userID, TargetID: &userID, Detail: map[string]any{"scope": "email"}})
}

// startEmailMethodConfirm mails a code to the (verified) address of an
// enrolment session; a repeated call resends within the send limits.
func (s *server) startEmailMethodConfirm(w http.ResponseWriter, r *http.Request, u model.User) {
	ch, err := auth.LoadUserChallenge(r.Context(), s.db, u.ID, auth.ChallengeMFAEnable)
	if errors.Is(err, auth.ErrChallengeInvalid) {
		_, ch, err = auth.NewChallenge(r.Context(), s.db, auth.ChallengeMFAEnable, &u.ID, "", "")
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	code, err := auth.SetCode(r.Context(), s.db, ch.ID)
	var ce *auth.CodeError
	switch {
	case errors.As(err, &ce):
		writeRateLimitedAs(w, ce.Retry, "code requests")
	case err != nil:
		writeInternal(w, r)
	default:
		s.mailCode(u.ID, mail.KindVerifyEmail, *u.Email, code)
		writeJSON(w, http.StatusAccepted, map[string]any{"confirm": true, "resendAfter": int(auth.ResendEvery.Seconds())})
	}
}

// handleMFAEmailConfirm serves POST /api/account/mfa/email/confirm {code}:
// the mailed code turns the email method on and only then lifts an
// enrolment session's restriction.
func (s *server) handleMFAEmailConfirm(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r, restrictionMFAEnrollment)
	if p == nil {
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	set, serr := auth.LoadSettings(r.Context(), s.db)
	if serr != nil {
		writeInternal(w, r)
		return
	}
	if !s.emailMethodUsable(r.Context(), p.User, set) {
		writeAuthError(w, http.StatusConflict, "email_unverified", "Confirm your email address first. Addresses must also be in use on this server.")
		return
	}
	refund, ok := s.codeBudget(w, p.User.ID)
	if !ok {
		return
	}
	if _, err := auth.VerifyUserCode(r.Context(), s.db, p.User.ID, auth.ChallengeMFAEnable, req.Code); err != nil {
		if !writeCodeError(w, err, true) {
			writeInternal(w, r)
		}
		return
	}
	refund()
	if err := s.setEmailMethod(r.Context(), p.User.ID, true); err != nil {
		writeInternal(w, r)
		return
	}
	if p.Level == auth.LevelEnroll {
		if err := auth.PromoteSession(r.Context(), s.db, p.User.ID, p.SessionID); err != nil {
			writeInternal(w, r)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"email": true})
}
