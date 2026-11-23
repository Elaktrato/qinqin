package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"qinqin/internal/auth"
	"qinqin/internal/mail"
)

// readAccountBody reads a small JSON body (4 KiB cap) into v, answering 413/400 itself.
func readAccountBody(w http.ResponseWriter, r *http.Request, v any) bool {
	body, ok := readAuthBody(w, r)
	if !ok {
		return false
	}
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return false
	}
	return true
}

// readAccountBodyStrict is readAccountBody that refuses unknown keys, so a
// misspelled setting is a 400 instead of a silent no-op.
func readAccountBodyStrict(w http.ResponseWriter, r *http.Request, v any) bool {
	body, ok := readAuthBody(w, r)
	if !ok {
		return false
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
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
		writeError(w, http.StatusUnprocessableEntity, "weak_password", auth.PolicyReason(err))
		return
	}
	// Only the session born from the temporary-password login skips the
	// current password (a flag with no watermark never does).
	if !p.TemporarySession {
		// An empty one is refused before it spends a re-auth token or a hash.
		if req.CurrentPassword == "" {
			writeError(w, http.StatusForbidden, "current_password_required", "Enter your current password to continue.")
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
			writeError(w, http.StatusForbidden, "wrong_password", "The current password is wrong.")
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
		writeError(w, http.StatusNotFound, "not_found", "No such session.")
		return
	}
	ok, err := auth.RevokeSessionAudited(r.Context(), s.db, p.User.ID, id)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "No such session.")
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
		writeError(w, http.StatusBadRequest, "bad_request", `scope must be "others" or "all".`)
		return
	}
	n, err := auth.RevokeOthersAudited(r.Context(), s.db, p.User.ID, except, req.Scope)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"revoked": n})
}

// handleAccountDeletionPreview serves GET /api/account/deletion-preview.
func (s *server) handleAccountDeletionPreview(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	s.writePreview(w, r, u.ID)
}

// handleDeleteAccount serves DELETE /api/account {password, confirm}: the
// caller deletes themselves after typing their username and re-entering
// the password (403 wrong_password, counted by the reauth limiter). The
// last active administrator is refused (409 last_admin): zero users would
// reopen the first-user bootstrap to anyone who reaches the URL. A user with
// an authenticator must also send a current code (403 code_invalid).
func (s *server) handleDeleteAccount(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var req struct {
		Password string `json:"password"`
		Confirm  string `json:"confirm"`
		Code     string `json:"code"` // authenticator or recovery code, for users who have one
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	if req.Confirm != u.Username {
		writeError(w, http.StatusUnprocessableEntity, "confirm_mismatch", "Type your username exactly to confirm.")
		return
	}
	if req.Password == "" {
		writeError(w, http.StatusForbidden, "wrong_password", "The password is wrong.")
		return
	}
	refund, ok := s.reauth(w, u.ID)
	if !ok {
		return
	}
	var good bool
	err := s.withHashGate(r.Context(), func() error {
		var e error
		good, e = auth.VerifyUserPassword(r.Context(), s.db, u.ID, req.Password)
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
		writeError(w, http.StatusForbidden, "wrong_password", "The password is wrong.")
		return
	}
	refund()
	if has, herr := auth.HasTOTP(r.Context(), s.db, u.ID); herr != nil {
		writeInternal(w, r)
		return
	} else if has && !s.secondFactorOK(w, r, u.ID, req.Code) {
		return
	}
	if err := s.users.DeleteUser(r.Context(), u.ID, u.ID, s.dataDir); err != nil {
		if !writeUserError(w, err) {
			writeInternal(w, r)
		}
		return
	}
	s.restores.discardUser(u.ID) // a staged backup of a deleted account goes with it
	w.WriteHeader(http.StatusNoContent)
}

// handlePutEmail serves PUT /api/account/email {email: string|null,
// currentPassword}: the caller sets or clears their own address under the
// instance policy (off refuses an address, required refuses clearing). A
// full session re-asks the password (403 wrong_password, reauth limiter): an
// address is a recovery channel; an enrolment session (the user just proved
// the password at sign-in and needs an address for email codes) does not. A
// changed address is unverified; with mail configured a six-digit code goes
// to it ("verification": "sent"), otherwise "unavailable"; "none" when there
// is nothing to verify (cleared, or the same verified address).
func (s *server) handlePutEmail(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r, restrictionMFAEnrollment)
	if p == nil {
		return
	}
	var req struct {
		Email           *string `json:"email"`
		CurrentPassword string  `json:"currentPassword"`
		Code            string  `json:"code"` // authenticator or recovery code, for users who have one
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	set, err := auth.LoadSettings(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	var nu auth.NewUser
	// Format and policy only: whether an address is taken is told after the
	// password, so nobody can probe addresses without proving who they are.
	if !s.applyEmailFormat(w, r, set.EmailPolicy, req.Email, &nu) {
		return
	}
	if p.Restriction() == "" {
		if !s.verifyOwnPassword(w, r, p.User.ID, req.CurrentPassword) {
			return
		}
		// The address is the recovery channel: whoever holds a stolen session
		// and the password must not be able to move it without the second factor.
		if has, herr := auth.HasTOTP(r.Context(), s.db, p.User.ID); herr != nil {
			writeInternal(w, r)
			return
		} else if has && !s.secondFactorOK(w, r, p.User.ID, req.Code) {
			return
		}
	}
	oldEmail := p.User.Email
	if err := auth.SetOwnEmail(r.Context(), s.db, p.User.ID, nu.Email, nu.EmailNorm); err != nil {
		if !writeUserError(w, err) {
			writeInternal(w, r)
		}
		return
	}
	u, err := auth.LoadUser(r.Context(), s.db, p.User.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if changed := oldEmail != nil && (u.Email == nil || !strings.EqualFold(*oldEmail, *u.Email)); changed {
		// Recovery links issued before the change must not outlive it, and the
		// old address (whose owner may not be the one who changed it) is told.
		if err := auth.DropPendingResets(r.Context(), s.db, p.User.ID); err != nil {
			writeInternal(w, r)
			return
		}
		if s.mailConfigured(r.Context()) {
			s.mail.Enqueue(mail.Job{Kind: mail.KindEmailChanged, UserID: p.User.ID, To: *oldEmail, AcceptLanguage: r.Header.Get("Accept-Language")})
		}
	}
	verification := "none"
	if u.Email != nil && !u.EmailVerified {
		verification = "unavailable"
		if s.mailConfigured(r.Context()) {
			if err := s.startEmailVerification(r.Context(), u.ID, *u.Email, nu.EmailNorm, r.Header.Get("Accept-Language")); err != nil {
				writeInternal(w, r)
				return
			}
			verification = "sent"
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"email": u.Email, "emailVerified": u.EmailVerified, "verification": verification})
}

// verifyOwnPassword re-asks the caller's password for a sensitive change:
// an empty one is refused before anything is counted (403
// current_password_required), a wrong one is 403 wrong_password through the
// reauth limiter, which a right password refunds. False: a response was written.
func (s *server) verifyOwnPassword(w http.ResponseWriter, r *http.Request, userID int64, password string) bool {
	if password == "" {
		writeError(w, http.StatusForbidden, "current_password_required", "Enter your current password to continue.")
		return false
	}
	refund, ok := s.reauth(w, userID)
	if !ok {
		return false
	}
	var good bool
	err := s.withHashGate(r.Context(), func() error {
		var e error
		good, e = auth.VerifyUserPassword(r.Context(), s.db, userID, password)
		return e
	})
	switch {
	case err != nil && r.Context().Err() != nil:
		writeClientGone(w)
		return false
	case errors.Is(err, errHashBusy):
		refund()
		writeBusy(w)
		return false
	case err != nil:
		refund()
		writeInternal(w, r)
		return false
	case !good:
		writeError(w, http.StatusForbidden, "wrong_password", "The current password is wrong.")
		return false
	}
	refund()
	return true
}

// startEmailVerification replaces the user's verification challenge with a
// new one and mails its first code.
func (s *server) startEmailVerification(ctx context.Context, userID int64, email string, norm *string, acceptLanguage string) error {
	if err := auth.DropUserChallenges(ctx, s.db, userID, auth.ChallengeEmailVerify); err != nil {
		return err
	}
	n := ""
	if norm != nil {
		n = *norm
	}
	_, ch, err := auth.NewChallenge(ctx, s.db, auth.ChallengeEmailVerify, &userID, n, "")
	if err != nil {
		return err
	}
	code, err := auth.SetCode(ctx, s.db, ch.ID)
	if err != nil {
		return err
	}
	s.mailCode(userID, mail.KindVerifyEmail, email, code, acceptLanguage)
	return nil
}

// mailCode queues a code mail unless the user's hourly budget of code mails
// is spent (silently: the answer to the request must not depend on it).
func (s *server) mailCode(userID int64, kind mail.Kind, to, code, acceptLanguage string) {
	if ok, _ := s.authLimiter("mailcode").Allow(int64Key(userID)); !ok {
		s.logThrottled("mailcode")
		return
	}
	s.mail.Enqueue(mail.Job{Kind: kind, UserID: userID, To: to, AcceptLanguage: acceptLanguage, Data: mail.TemplateData{Code: code}})
}

// writeCodeError answers a refused one-time code. authenticated routes
// (a session exists) answer 403 and never 401, which the web client reads as
// "session gone"; the anonymous sign-in steps answer 401.
func writeCodeError(w http.ResponseWriter, err error, authenticated bool) bool {
	status := http.StatusUnauthorized
	if authenticated {
		status = http.StatusForbidden
	}
	var ce *auth.CodeError
	switch {
	case errors.As(err, &ce) && errors.Is(err, auth.ErrCodeWrong):
		writeError(w, status, "code_invalid", "That code is not right.", map[string]any{"attemptsLeft": ce.AttemptsLeft})
	case errors.Is(err, auth.ErrChallengeInvalid):
		writeError(w, status, "challenge_expired", "This code has expired or was tried too often. Ask for a new one.")
	default:
		return false
	}
	return true
}

// handleEmailVerify serves POST /api/account/email/verify {code}.
func (s *server) handleEmailVerify(w http.ResponseWriter, r *http.Request) {
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
	ch, err := auth.VerifyUserCode(r.Context(), s.db, p.User.ID, auth.ChallengeEmailVerify, req.Code)
	if err != nil {
		if !writeCodeError(w, err, true) {
			writeInternal(w, r)
		}
		return
	}
	if err := auth.MarkEmailVerified(r.Context(), s.db, p.User.ID, ch.EmailNorm); err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"emailVerified": true})
}

// handleEmailResend serves POST /api/account/email/resend: a new code for
// the pending verification (at most three per challenge, 60 s apart).
func (s *server) handleEmailResend(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r, restrictionMFAEnrollment)
	if p == nil {
		return
	}
	if !s.mailConfigured(r.Context()) {
		writeError(w, http.StatusConflict, "mail_unavailable", "Email is not set up on this server.")
		return
	}
	u, err := auth.LoadUser(r.Context(), s.db, p.User.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if u.Email == nil || u.EmailVerified {
		writeError(w, http.StatusConflict, "nothing_to_verify", "There is no unverified email address on this account.")
		return
	}
	_, norm, nerr := auth.NormalizeEmail(*u.Email)
	if nerr != nil {
		writeInternal(w, r)
		return
	}
	ch, err := auth.LoadUserChallenge(r.Context(), s.db, p.User.ID, auth.ChallengeEmailVerify)
	if errors.Is(err, auth.ErrChallengeInvalid) {
		if err := s.startEmailVerification(r.Context(), u.ID, *u.Email, &norm, r.Header.Get("Accept-Language")); err != nil {
			writeInternal(w, r)
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]int{"resendAfter": int(auth.ResendEvery.Seconds())})
		return
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
	case errors.Is(err, auth.ErrChallengeInvalid):
		if err := s.startEmailVerification(r.Context(), u.ID, *u.Email, &norm, r.Header.Get("Accept-Language")); err != nil {
			writeInternal(w, r)
			return
		}
		writeJSON(w, http.StatusAccepted, map[string]int{"resendAfter": int(auth.ResendEvery.Seconds())})
	case err != nil:
		writeInternal(w, r)
	default:
		s.mailCode(u.ID, mail.KindVerifyEmail, *u.Email, code, r.Header.Get("Accept-Language"))
		writeJSON(w, http.StatusAccepted, map[string]int{"resendAfter": int(auth.ResendEvery.Seconds())})
	}
}
