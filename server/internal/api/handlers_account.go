package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"qinqin/internal/auth"
)

// readAccountBody reads a small JSON body (4 KiB cap) into v, answering 413/400 itself.
func readAccountBody(w http.ResponseWriter, r *http.Request, v any) bool {
	body, ok := readAuthBody(w, r)
	if !ok {
		return false
	}
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(v); err != nil {
		writeAuthError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return false
	}
	return true
}

// reauth spends one token of the user's re-authentication budget; false
// means a 429 was written. The returned func gives the token back (call it
// when the password turned out right).
func (s *server) reauth(w http.ResponseWriter, userID int64) (refund func(), ok bool) {
	l := s.authLimiter("reauth")
	key := strconv.FormatInt(userID, 10)
	if allowed, retry := l.Allow(key); !allowed {
		s.logThrottled("reauth")
		writeRateLimitedAs(w, retry, "password attempts")
		return nil, false
	}
	return func() {
		if rf, ok := l.(refunder); ok {
			rf.Refund(key)
		}
	}, true
}

// passwordChangeBody is the body of POST /api/account/password.
type passwordChangeBody struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
	SignOutOthers   *bool  `json:"signOutOthers"` // default true
}

// handleChangePassword changes the caller's password. A full session must
// give the current password (wrong: 403 wrong_password, never 401, which
// the web client treats as "session gone"). A password_change session may
// skip it only when the session was created after the flag was set, i.e. it
// came from the login with the temporary password; a session that predates
// the flag must still prove it knows the current one. Other sessions are
// signed out by default and always after a forced change.
func (s *server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r, restrictionPasswordChange)
	if p == nil {
		return
	}
	var req passwordChangeBody
	if !readAccountBody(w, r, &req) {
		return
	}
	if err := auth.CheckPassword(p.User.Username, req.NewPassword); err != nil {
		writeAuthError(w, http.StatusUnprocessableEntity, "weak_password", auth.PolicyReason(err))
		return
	}
	forced := p.User.MustChangePassword
	// Unknown set time (flag set by hand) counts as "older": ask for it.
	bornFromTemporary := forced && p.MustChangeSetAt != "" && p.SessionCreated >= p.MustChangeSetAt
	if !bornFromTemporary {
		refund, ok := s.reauth(w, p.User.ID)
		if !ok {
			return
		}
		var good bool
		err := s.withHashGate(r.Context(), func() error {
			var e error
			good, e = auth.VerifyUserPassword(r.Context(), s.db, p.User.ID, req.CurrentPassword)
			return e
		})
		switch {
		case err != nil && r.Context().Err() != nil:
			writeClientGone(w)
			return
		case errors.Is(err, errHashBusy):
			refund()
			writeBusy(w)
			return
		case err != nil:
			refund()
			writeInternal(w, r)
			return
		case !good:
			writeAuthError(w, http.StatusForbidden, "wrong_password", "The current password is wrong.")
			return
		}
		refund()
	}
	// The digest is computed before any transaction opens.
	var newHash string
	err := s.withHashGate(r.Context(), func() error {
		newHash = s.hash.hash(req.NewPassword)
		return nil
	})
	switch {
	case err != nil && r.Context().Err() != nil:
		writeClientGone(w)
		return
	case errors.Is(err, errHashBusy):
		writeBusy(w)
		return
	case err != nil:
		writeInternal(w, r)
		return
	}
	revokeOthers := req.SignOutOthers == nil || *req.SignOutOthers
	if err := auth.ChangePassword(r.Context(), s.db, p.User.ID, newHash, p.SessionID, revokeOthers); err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
