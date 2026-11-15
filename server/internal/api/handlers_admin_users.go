package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"qinqin/internal/auth"
	"qinqin/internal/model"
)

// userTarget parses {id}; false means a 404 was written.
func userTarget(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeAuthError(w, http.StatusNotFound, "not_found", "No such user.")
		return 0, false
	}
	return id, true
}

// writeUserError maps the admin user errors to responses; false when err
// is none of them (the caller answers 500).
func writeUserError(w http.ResponseWriter, err error) bool {
	switch {
	case errors.Is(err, auth.ErrUserNotFound):
		writeAuthError(w, http.StatusNotFound, "not_found", "No such user.")
	case errors.Is(err, auth.ErrLastAdmin):
		writeAuthError(w, http.StatusConflict, "last_admin", "The last administrator cannot be removed. Make someone else an administrator first.")
	case errors.Is(err, auth.ErrEmailTaken):
		writeAuthError(w, http.StatusConflict, "email_taken", "That email address is already in use.")
	default:
		return false
	}
	return true
}

func (s *server) hideStoredEmail(r *http.Request) bool {
	set, err := auth.LoadSettings(r.Context(), s.db)
	return err == nil && set.EmailPolicy == "off"
}

// handleAdminListUsers serves GET /api/admin/users.
func (s *server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	list, err := s.users.ListUsers(r.Context(), s.hideStoredEmail(r))
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": list})
}

// handleAdminGetUser serves GET /api/admin/users/{id}.
func (s *server) handleAdminGetUser(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	id, ok := userTarget(w, r)
	if !ok {
		return
	}
	u, err := s.users.GetUser(r.Context(), id, s.hideStoredEmail(r))
	if err != nil {
		if !writeUserError(w, err) {
			writeInternal(w, r)
		}
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// handleAdminCreateUser serves POST /api/admin/users: the new account has a
// temporary password and must change it at the first sign-in; an email an
// administrator entered counts as verified.
func (s *server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	var req struct {
		Username string  `json:"username"`
		Password string  `json:"password"`
		Email    *string `json:"email"`
		Admin    bool    `json:"admin"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	req.Username = auth.NormalizeUsername(req.Username)
	if req.Username == "" || req.Password == "" {
		writeAuthError(w, http.StatusBadRequest, "bad_request", "Username and password are required.")
		return
	}
	if err := auth.CheckNewUsername(r.Context(), s.db, req.Username); err != nil {
		switch {
		case errors.Is(err, auth.ErrInvalidUsername):
			writeAuthError(w, http.StatusUnprocessableEntity, "invalid_username", auth.PolicyReason(err))
		case errors.Is(err, auth.ErrUsernameTaken):
			writeAuthError(w, http.StatusConflict, "username_taken", "That username is taken.")
		default:
			writeInternal(w, r)
		}
		return
	}
	if err := auth.CheckPassword(req.Username, req.Password); err != nil {
		writeAuthError(w, http.StatusUnprocessableEntity, "weak_password", auth.PolicyReason(err))
		return
	}
	set, err := auth.LoadSettings(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	nu := auth.NewUser{Username: req.Username, Admin: req.Admin, MustChange: true, EmailVerified: true}
	if !s.applyEmail(w, r, set.EmailPolicy, req.Email, &nu, 0) {
		return
	}
	err = s.withHashGate(r.Context(), func() error {
		nu.Hash = s.hash.hash(req.Password)
		return nil
	})
	var created model.User
	if err == nil {
		created, err = s.users.Create(r.Context(), admin.ID, nu)
	}
	switch {
	case err != nil && r.Context().Err() != nil:
		writeClientGone(w)
	case errors.Is(err, errHashBusy):
		writeBusy(w)
	case errors.Is(err, auth.ErrUsernameTaken):
		writeAuthError(w, http.StatusConflict, "username_taken", "That username is taken.")
	case err != nil && writeUserError(w, err):
	case err != nil:
		writeInternal(w, r)
	default:
		u, gerr := s.users.GetUser(r.Context(), created.ID, false)
		if gerr != nil {
			writeInternal(w, r)
			return
		}
		writeJSON(w, http.StatusCreated, u)
	}
}

// handleAdminPatchUser serves PATCH /api/admin/users/{id} with any of
// admin, disabled, email (string or null) and mustChangePassword (true only).
func (s *server) handleAdminPatchUser(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	id, ok := userTarget(w, r)
	if !ok {
		return
	}
	var req struct {
		Admin              *bool           `json:"admin"`
		Disabled           *bool           `json:"disabled"`
		Email              json.RawMessage `json:"email"`
		MustChangePassword *bool           `json:"mustChangePassword"`
	}
	if !readAccountBodyStrict(w, r, &req) {
		return
	}
	ctx := r.Context()
	if req.MustChangePassword != nil && !*req.MustChangePassword {
		writeAuthError(w, http.StatusUnprocessableEntity, "invalid_request", "A password change can be required, not cancelled.")
		return
	}
	if req.Disabled != nil && *req.Disabled && id == admin.ID {
		writeAuthError(w, http.StatusConflict, "self_target", "You cannot disable your own account.")
		return
	}
	if _, err := s.users.GetUser(ctx, id, false); err != nil {
		if !writeUserError(w, err) {
			writeInternal(w, r)
		}
		return
	}
	var email, emailNorm *string
	setEmail := req.Email != nil
	if setEmail {
		set, err := auth.LoadSettings(ctx, s.db)
		if err != nil {
			writeInternal(w, r)
			return
		}
		var given *string
		if string(req.Email) != "null" {
			given = new(string)
			if err := json.Unmarshal(req.Email, given); err != nil {
				writeAuthError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
				return
			}
		}
		var nu auth.NewUser
		if !s.applyEmail(w, r, set.EmailPolicy, given, &nu, id) {
			return
		}
		email, emailNorm = nu.Email, nu.EmailNorm
	}
	fail := func(err error) {
		if !writeUserError(w, err) {
			writeInternal(w, r)
		}
	}
	if setEmail {
		if err := s.users.SetEmail(ctx, admin.ID, id, email, emailNorm); err != nil {
			fail(err)
			return
		}
	}
	if req.Admin != nil {
		if err := s.users.SetAdmin(ctx, admin.ID, id, *req.Admin); err != nil {
			fail(err)
			return
		}
	}
	if req.Disabled != nil {
		if err := s.users.SetDisabled(ctx, admin.ID, id, *req.Disabled); err != nil {
			fail(err)
			return
		}
	}
	if req.MustChangePassword != nil {
		if err := s.users.ForcePasswordChange(ctx, admin.ID, id); err != nil {
			fail(err)
			return
		}
	}
	u, err := s.users.GetUser(ctx, id, s.hideStoredEmail(r))
	if err != nil {
		fail(err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// handleAdminRevokeSessions serves POST /api/admin/users/{id}/sessions/revoke.
func (s *server) handleAdminRevokeSessions(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	id, ok := userTarget(w, r)
	if !ok {
		return
	}
	n, err := s.users.RevokeAllSessions(r.Context(), admin.ID, id)
	if err != nil {
		if !writeUserError(w, err) {
			writeInternal(w, r)
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revoked": n})
}

// handleAdminDeletionPreview serves GET /api/admin/users/{id}/deletion-preview.
func (s *server) handleAdminDeletionPreview(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	id, ok := userTarget(w, r)
	if !ok {
		return
	}
	s.writePreview(w, r, id)
}

func (s *server) writePreview(w http.ResponseWriter, r *http.Request, id int64) {
	p, err := auth.DeletionPreview(r.Context(), s.db, id)
	if err != nil {
		if !writeUserError(w, err) {
			writeInternal(w, r)
		}
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// handleAdminDeleteUser serves DELETE /api/admin/users/{id} {confirm: the
// username}. An administrator cannot delete themselves here (409
// self_target: Settings -> Account does that, with re-authentication).
func (s *server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	id, ok := userTarget(w, r)
	if !ok {
		return
	}
	var req struct {
		Confirm string `json:"confirm"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	target, err := s.users.GetUser(r.Context(), id, false)
	if err != nil {
		if !writeUserError(w, err) {
			writeInternal(w, r)
		}
		return
	}
	if id == admin.ID {
		writeAuthError(w, http.StatusConflict, "self_target", "You cannot delete your own account here. Use Settings, Account.")
		return
	}
	if req.Confirm != target.Username {
		writeAuthError(w, http.StatusUnprocessableEntity, "confirm_mismatch", "Type the username exactly to confirm.")
		return
	}
	if err := s.users.DeleteUser(r.Context(), admin.ID, id, s.dataDir); err != nil {
		if !writeUserError(w, err) {
			writeInternal(w, r)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
