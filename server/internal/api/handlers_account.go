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
// skip it only when it is the session born from the login with the temporary
// password (its id is above the watermark set when the change was forced); a
// session that predates the flag must still prove it knows the current one. Other sessions are
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
	// Only the session born from the temporary-password login skips the
	// current password (a flag with no watermark never does).
	if !p.TemporarySession {
		// An empty one is refused before it spends a re-auth token or a hash.
		if req.CurrentPassword == "" {
			writeAuthError(w, http.StatusForbidden, "current_password_required", "Enter your current password to continue.")
			return
		}
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

// handleListSessions lists the caller's sessions, newest use first. It never
// carries a token or its hash.
func (s *server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r)
	if p == nil {
		return
	}
	list, err := auth.ListSessions(r.Context(), s.db, p.User.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	for i := range list {
		list[i].Current = list[i].ID == p.SessionID
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": list})
}

// handleRevokeSession ends one of the caller's sessions (204); another
// user's id is a 404. Revoking the current session is a logout.
func (s *server) handleRevokeSession(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r)
	if p == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeAuthError(w, http.StatusNotFound, "not_found", "No such session.")
		return
	}
	ok, err := auth.RevokeSession(r.Context(), s.db, p.User.ID, id)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if !ok {
		writeAuthError(w, http.StatusNotFound, "not_found", "No such session.")
		return
	}
	if err := auth.Audit(r.Context(), s.db, auth.AuditEvent{Action: "sessions_revoked", ActorID: p.User.ID,
		TargetID: &p.User.ID, Detail: map[string]any{"scope": "one", "revoked": 1}}); err != nil {
		writeInternal(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleRevokeSessions ends the caller's other sessions ("others") or all of
// them including this one ("all").
func (s *server) handleRevokeSessions(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r)
	if p == nil {
		return
	}
	var req struct {
		Scope string `json:"scope"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	var except int64
	switch req.Scope {
	case "others":
		except = p.SessionID
	case "all":
	default:
		writeAuthError(w, http.StatusBadRequest, "bad_request", `scope must be "others" or "all".`)
		return
	}
	n, err := auth.RevokeSessions(r.Context(), s.db, p.User.ID, except)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if err := auth.Audit(r.Context(), s.db, auth.AuditEvent{Action: "sessions_revoked", ActorID: p.User.ID,
		TargetID: &p.User.ID, Detail: map[string]any{"scope": req.Scope, "revoked": n}}); err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"revoked": n})
}
