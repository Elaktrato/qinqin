package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"qinqin/internal/auth"
)

// handleCreateInvite serves POST /api/admin/invites. expiresInDays absent
// means 7 days, an explicit null means no expiry.
func (s *server) handleCreateInvite(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	var req struct {
		MaxUses       *int            `json:"maxUses"`
		ExpiresInDays json.RawMessage `json:"expiresInDays"`
		Note          string          `json:"note"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	maxUses := 1
	if req.MaxUses != nil {
		maxUses = *req.MaxUses
	}
	days := new(int)
	*days = 7
	if req.ExpiresInDays != nil {
		if string(req.ExpiresInDays) == "null" {
			days = nil
		} else if err := json.Unmarshal(req.ExpiresInDays, days); err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
			return
		}
	}
	inv, token, err := auth.CreateInvite(r.Context(), s.db, admin.ID, maxUses, days, req.Note)
	if errors.Is(err, auth.ErrInviteInput) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_invite", err.Error())
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	if set, err := auth.LoadSettings(r.Context(), s.db); err == nil && set.Registration == "closed" {
		inv.State = "inactive"
	}
	writeJSON(w, http.StatusCreated, map[string]any{"invite": inv, "token": token, "path": "/register#invite=" + token})
}

// handleListInvites serves GET /api/admin/invites (never a token).
func (s *server) handleListInvites(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	set, err := auth.LoadSettings(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	list, err := auth.ListInvites(r.Context(), s.db, set.Registration)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"invites": list})
}

// handleRevokeInvite serves DELETE /api/admin/invites/{id}.
func (s *server) handleRevokeInvite(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "No such invite.")
		return
	}
	ok, err := auth.RevokeInvite(r.Context(), s.db, admin.ID, id)
	switch {
	case err != nil:
		writeInternal(w, r)
	case !ok:
		writeError(w, http.StatusNotFound, "not_found", "No such invite.")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleCheckInvite serves POST /api/auth/invite/check: the register page
// asks whether a link is still usable. One 403 invite_invalid for every
// kind of bad token (and for any token while registration is closed).
func (s *server) handleCheckInvite(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.clientTake(w, r, "attempts"); !ok {
		return
	}
	var req struct {
		Invite string `json:"invite"`
	}
	if !readAccountBody(w, r, &req) {
		return
	}
	set, err := auth.LoadSettings(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	var expires *string
	if set.Registration != "closed" && req.Invite != "" {
		expires, err = auth.CheckInvite(r.Context(), s.db, req.Invite)
	} else {
		err = auth.ErrInviteInvalid
	}
	switch {
	case errors.Is(err, auth.ErrInviteInvalid):
		writeError(w, http.StatusForbidden, "invite_invalid", inviteInvalidMessage)
	case err != nil:
		writeInternal(w, r)
	default:
		writeJSON(w, http.StatusOK, map[string]any{"expiresAt": expires, "emailPolicy": set.EmailPolicy})
	}
}
