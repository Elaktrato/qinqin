package api

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"time"

	"qinqin/internal/auth"
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
	key := int64Key(userID)
	m, d := s.authLimiter("mfa"), s.authLimiter("mfa-day")
	if ok, retry := m.Allow(key); !ok {
		s.logThrottled("mfa")
		writeRateLimitedAs(w, retry, "code attempts")
		return nil, false
	}
	if ok, retry := d.Allow(key); !ok {
		m.(refunder).Refund(key)
		s.logThrottled("mfa-day")
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
// email method needs a verified address and a configured mail server. An
// enrolment session skips the password and becomes a full one when the method
// is turned on.
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
		if !p.User.EmailVerified {
			writeAuthError(w, http.StatusConflict, "email_unverified", "Confirm your email address first.")
			return
		}
	} else if s.mfaEnforcedEffective(r.Context(), set) && !s.otherMethodLeft(r.Context(), p.User, st, "email") {
		writeAuthError(w, http.StatusConflict, "mfa_required", "Two-step sign-in is required here: set up an authenticator before you turn off email codes.")
		return
	}
	if p.Restriction() == "" && !s.verifyOwnPassword(w, r, p.User.ID, req.Password) {
		return
	}
	if err := auth.SetMFAEmail(r.Context(), s.db, p.User.ID, req.Enabled); err != nil {
		writeInternal(w, r)
		return
	}
	action := "mfa_disabled"
	if req.Enabled {
		action = "mfa_enabled"
	}
	if err := auth.Audit(r.Context(), s.db, auth.AuditEvent{Action: action, ActorID: p.User.ID, TargetID: &p.User.ID, Detail: map[string]any{"scope": "email"}}); err != nil {
		writeInternal(w, r)
		return
	}
	if req.Enabled && p.Level == auth.LevelEnroll {
		if err := auth.PromoteSession(r.Context(), s.db, p.User.ID, p.SessionID); err != nil {
			writeInternal(w, r)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"email": req.Enabled})
}
