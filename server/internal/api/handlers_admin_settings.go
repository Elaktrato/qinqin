package api

import (
	"context"
	"errors"
	"net/http"

	"qinqin/internal/auth"
)

// mailConfigured reports whether the instance can send mail: the single seam
// every "needs email" decision reads (mail.Store.Configured).
func (s *server) mailConfigured(ctx context.Context) bool { return s.mail.Configured(ctx) }

type authSettingsView struct {
	Registration string `json:"registration"`
	EmailPolicy  string `json:"emailPolicy"`
	MFAEnforced  bool   `json:"mfaEnforced"`
	// MFAEnforcedEffective is false while mail is not configured: enforcement
	// and email codes are inactive then (personal authenticators keep working).
	MFAEnforcedEffective bool     `json:"mfaEnforcedEffective"`
	EmailCodeLogin       bool     `json:"emailCodeLogin"`
	Mail                 mailView `json:"mail"`
}

type mailView struct {
	Configured bool `json:"configured"`
}

func (s *server) settingsView(ctx context.Context, set auth.Settings) authSettingsView {
	return authSettingsView{set.Registration, set.EmailPolicy, set.MFAEnforced, s.mfaEnforcedEffective(ctx, set), set.EmailCodeLogin, mailView{s.mailConfigured(ctx)}}
}

// handleGetAuthSettings serves GET /api/admin/settings/auth.
func (s *server) handleGetAuthSettings(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	set, err := auth.LoadSettings(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, s.settingsView(r.Context(), set))
}

// handlePatchAuthSettings serves PATCH /api/admin/settings/auth with any
// subset of the keys. MFA enforcement and email-code sign-in can be turned
// on only while mail is configured.
func (s *server) handlePatchAuthSettings(w http.ResponseWriter, r *http.Request) {
	ap := s.requireAdminPrincipal(w, r)
	if ap == nil {
		return
	}
	admin := &ap.User
	var req struct {
		Registration   *string `json:"registration"`
		EmailPolicy    *string `json:"emailPolicy"`
		MFAEnforced    *bool   `json:"mfaEnforced"`
		EmailCodeLogin *bool   `json:"emailCodeLogin"`
		// SignOutOthers, with mfaEnforced turned on, also ends every session
		// except the acting administrator's current one.
		SignOutOthers bool `json:"signOutOthers"`
		// Re-authentication when the change lowers a protection or signs
		// everyone out (settingsPatchNeedsReauth).
		CurrentPassword string `json:"currentPassword"`
		Code            string `json:"code"`
	}
	if !readAccountBodyStrict(w, r, &req) {
		return
	}
	if !s.mailConfigured(r.Context()) && ((req.MFAEnforced != nil && *req.MFAEnforced) || (req.EmailCodeLogin != nil && *req.EmailCodeLogin)) {
		writeAuthError(w, http.StatusConflict, "mail_unavailable", "Set up email first: this switch needs a working mail server.")
		return
	}
	patch := auth.SettingsPatch{Registration: req.Registration, EmailPolicy: req.EmailPolicy, MFAEnforced: req.MFAEnforced, EmailCodeLogin: req.EmailCodeLogin}
	cur, err := auth.LoadSettings(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if settingsPatchNeedsReauth(cur, patch, req.SignOutOthers) && !s.requireAdminReauth(w, r, admin.ID, req.CurrentPassword, req.Code) {
		return
	}
	set, err := auth.UpdateSettings(r.Context(), s.db, admin.ID, patch)
	switch {
	case errors.Is(err, auth.ErrInvalidSetting):
		writeAuthError(w, http.StatusUnprocessableEntity, "invalid_setting", err.Error())
	case err != nil:
		writeInternal(w, r)
	default:
		if req.SignOutOthers && req.MFAEnforced != nil && *req.MFAEnforced {
			if _, rerr := auth.RevokeAllExcept(r.Context(), s.db, admin.ID, ap.SessionID); rerr != nil {
				writeInternal(w, r)
				return
			}
		}
		writeJSON(w, http.StatusOK, s.settingsView(r.Context(), set))
	}
}
