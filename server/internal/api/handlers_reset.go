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

const tokenInvalidMessage = "This link is not valid any more. Ask for a new one."

// resetThrottle spends one token of the per-client "reset" budget; false
// means a 429 was written.
func (s *server) resetThrottle(w http.ResponseWriter, r *http.Request) bool {
	key := clientKeyString(s.clientIP(r))
	if ok, retry := s.authLimiter("reset").Allow(key); !ok {
		s.logThrottled("reset")
		writeRateLimitedAs(w, retry, "attempts")
		return false
	}
	return true
}

// handleAdminResetLink serves POST /api/admin/users/{id}/reset-link
// {expiresInHours: 1-168, default 24}: the link is shown once, nothing
// changes until it is used.
func (s *server) handleAdminResetLink(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	id, ok := userTarget(w, r)
	if !ok {
		return
	}
	var req struct {
		ExpiresInHours  *int   `json:"expiresInHours"`
		CurrentPassword string `json:"currentPassword"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	ttl := auth.DefaultResetTTL
	if req.ExpiresInHours != nil {
		ttl = time.Duration(*req.ExpiresInHours) * time.Hour
	}
	if ttl < time.Hour || ttl > auth.MaxResetTTL {
		writeAuthError(w, http.StatusUnprocessableEntity, "invalid_request", "The link may last 1 to 168 hours.")
		return
	}
	if !s.requireAdminPassword(w, r, admin.ID, req.CurrentPassword) {
		return
	}
	token, expires, err := s.users.IssueReset(r.Context(), admin.ID, id, ttl)
	switch {
	case errors.Is(err, auth.ErrResetInput):
		writeAuthError(w, http.StatusUnprocessableEntity, "invalid_request", err.Error())
	case err != nil && writeUserError(w, err):
	case err != nil:
		writeInternal(w, r)
	default:
		writeJSON(w, http.StatusCreated, map[string]any{"path": "/reset#t=" + token, "expiresAt": expires.Format(time.RFC3339)})
	}
}

// handleResetCheck serves POST /api/auth/reset/check {token}.
func (s *server) handleResetCheck(w http.ResponseWriter, r *http.Request) {
	if !s.resetThrottle(w, r) {
		return
	}
	var req struct {
		Token string `json:"token"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	username, expires, err := auth.CheckReset(r.Context(), s.db, req.Token)
	switch {
	case errors.Is(err, auth.ErrTokenInvalid):
		writeAuthError(w, http.StatusBadRequest, "token_invalid", tokenInvalidMessage)
	case err != nil:
		writeInternal(w, r)
	default:
		writeJSON(w, http.StatusOK, map[string]any{"username": username, "expiresAt": expires})
	}
}

// handleReset serves POST /api/auth/reset {token, password, deviceName?}:
// the password policy is checked first (a weak password leaves the token
// usable), the digest is computed behind the hash gate before the
// transaction, then the token is spent, the password set and every session
// of the user deleted. The answer is login-shaped.
func (s *server) handleReset(w http.ResponseWriter, r *http.Request) {
	if !s.resetThrottle(w, r) {
		return
	}
	var req struct {
		Token      string `json:"token"`
		Password   string `json:"password"`
		DeviceName string `json:"deviceName"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	username, _, err := auth.CheckReset(r.Context(), s.db, req.Token)
	if errors.Is(err, auth.ErrTokenInvalid) {
		writeAuthError(w, http.StatusBadRequest, "token_invalid", tokenInvalidMessage)
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	if err := auth.CheckPassword(username, req.Password); err != nil {
		writeAuthError(w, http.StatusUnprocessableEntity, "weak_password", auth.PolicyReason(err))
		return
	}
	var digest string
	err = s.withHashGate(r.Context(), func() error {
		digest = s.hash.hash(req.Password)
		return nil
	})
	var u model.User
	if err == nil {
		u, err = auth.UseReset(r.Context(), s.db, req.Token, digest)
	}
	switch {
	case err != nil && r.Context().Err() != nil:
		writeClientGone(w)
	case errors.Is(err, errHashBusy):
		writeBusy(w)
	case errors.Is(err, auth.ErrTokenInvalid):
		writeAuthError(w, http.StatusBadRequest, "token_invalid", tokenInvalidMessage)
	case err != nil:
		writeInternal(w, r)
	default:
		device := req.DeviceName
		if device == "" {
			device = auth.DeviceLabel(r.UserAgent())
		}
		// Plan 3 branches here: a user with two-factor authentication
		// answers mfa_required instead of getting a session (a reset must
		// not remove MFA).
		token, err := auth.NewSession(r.Context(), s.db, u.ID, auth.LoginOptions{Device: device})
		if err != nil {
			writeInternal(w, r)
			return
		}
		s.hideEmailWhenOff(r, &u)
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "token": token, "user": u})
	}
}

// handleAdminRevokeResetLink serves DELETE /api/admin/users/{id}/reset-link:
// take back the user's pending reset link (no password needed: it only
// removes a way in).
func (s *server) handleAdminRevokeResetLink(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	id, ok := userTarget(w, r)
	if !ok {
		return
	}
	if err := s.users.RevokePendingResets(r.Context(), admin.ID, id); err != nil {
		if !writeUserError(w, err) {
			writeInternal(w, r)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// identKey is the limiter key of a login identifier: trimmed and lower-cased,
// so "Bob" and "bob " share a budget (the keyer hashes it).
func identKey(login string) string { return strings.ToLower(strings.TrimSpace(login)) }

// handleResetRequest serves POST /api/auth/reset-request {login}: the
// "forgot password" mail. The answer is always 202 {} with the same headers
// for a known, unknown, disabled or unverified account, after the same
// database lookup and limiter work; the mail (and the reset link inside it)
// is made later by the mail worker, so a known account costs the request no
// extra write. Only an enabled user with a verified address gets mail.
// Without mail the route answers 409 mail_unavailable (an instance fact).
func (s *server) handleResetRequest(w http.ResponseWriter, r *http.Request) {
	if !s.mailConfigured(r.Context()) {
		writeAuthError(w, http.StatusConflict, "mail_unavailable", "Password reset by email is not set up. Ask an administrator for a reset link.")
		return
	}
	if _, ok := s.clientTake(w, r, "attempts"); !ok {
		return
	}
	var req struct {
		Login string `json:"login"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	login := strings.TrimSpace(req.Login)
	if login == "" || len(login) > 320 {
		writeAuthError(w, http.StatusBadRequest, "bad_request", "Enter your username or email address.")
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
	// With the email policy off the stored addresses are dormant.
	target.Eligible = target.Eligible && set.EmailPolicy != "off"
	// The same limiter work for every identifier (a dummy key when unknown).
	key := "none"
	if target.UserID != 0 {
		key = int64Key(target.UserID)
	}
	allowed, _ := s.authLimiter("reset-mail").Allow(key)
	if target.UserID != 0 && target.Eligible && allowed {
		to, uid := target.Email, target.UserID
		s.mail.Enqueue(mail.Job{Kind: mail.KindReset, UserID: uid, To: to,
			Build: func(ctx context.Context, cfg mail.Config) (mail.TemplateData, bool) {
				token, _, err := auth.IssueReset(ctx, s.db, 0, uid, time.Hour)
				if err != nil {
					return mail.TemplateData{}, false
				}
				return mail.TemplateData{Link: cfg.PublicURL + "/reset#t=" + token, Hours: 1}, true
			}})
	}
	writeJSON(w, http.StatusAccepted, struct{}{})
}
