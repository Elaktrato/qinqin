package api

import (
	"errors"
	"net/http"

	"qinqin/internal/auth"
)

// mailConfigured reports whether the instance can send mail. Until the
// SMTP work of plan 3 it is always false; the settings and options routes
// already read it through here so the seam is one function.
func (s *server) mailConfigured() bool { return false }

type authSettingsView struct {
	Registration   string   `json:"registration"`
	EmailPolicy    string   `json:"emailPolicy"`
	MFAEnforced    bool     `json:"mfaEnforced"`
	EmailCodeLogin bool     `json:"emailCodeLogin"`
	Mail           mailView `json:"mail"`
}

type mailView struct {
	Configured bool `json:"configured"`
}

func (s *server) settingsView(set auth.Settings) authSettingsView {
	return authSettingsView{set.Registration, set.EmailPolicy, set.MFAEnforced, set.EmailCodeLogin, mailView{s.mailConfigured()}}
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
	writeJSON(w, http.StatusOK, s.settingsView(set))
}

// handlePatchAuthSettings serves PATCH /api/admin/settings/auth with any
// subset of the keys. MFA enforcement and email-code sign-in can be turned
// on only while mail is configured.
func (s *server) handlePatchAuthSettings(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil {
		return
	}
	var req struct {
		Registration   *string `json:"registration"`
		EmailPolicy    *string `json:"emailPolicy"`
		MFAEnforced    *bool   `json:"mfaEnforced"`
		EmailCodeLogin *bool   `json:"emailCodeLogin"`
	}
	if !readAccountBodyStrict(w, r, &req) {
		return
	}
	if !s.mailConfigured() && ((req.MFAEnforced != nil && *req.MFAEnforced) || (req.EmailCodeLogin != nil && *req.EmailCodeLogin)) {
		writeAuthError(w, http.StatusConflict, "mail_unavailable", "Set up email first: this switch needs a working mail server.")
		return
	}
	set, err := auth.UpdateSettings(r.Context(), s.db, admin.ID, auth.SettingsPatch{
		Registration: req.Registration, EmailPolicy: req.EmailPolicy, MFAEnforced: req.MFAEnforced, EmailCodeLogin: req.EmailCodeLogin})
	switch {
	case errors.Is(err, auth.ErrInvalidSetting):
		writeAuthError(w, http.StatusUnprocessableEntity, "invalid_setting", err.Error())
	case err != nil:
		writeInternal(w, r)
	default:
		writeJSON(w, http.StatusOK, s.settingsView(set))
	}
}
