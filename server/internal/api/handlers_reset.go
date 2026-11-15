package api

import (
	"errors"
	"net/http"
	"time"

	"qinqin/internal/auth"
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
