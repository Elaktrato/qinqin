package api

import (
	"context"
	"crypto/rand"
	"errors"
	"log"
	"net/http"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/mail"
)

// smtpBody is the JSON of PUT /api/admin/settings/smtp and of the test
// route's draft. Password: absent keeps the stored one, "" clears it, a
// string replaces it.
type smtpBody struct {
	Host        string  `json:"host"`
	Port        int     `json:"port"`
	TLS         string  `json:"tls"`
	Username    string  `json:"username"`
	Password    *string `json:"password"`
	FromAddress string  `json:"fromAddress"`
	FromName    string  `json:"fromName"`
	PublicURL   string  `json:"publicUrl"`
}

func (b smtpBody) input() mail.Input {
	return mail.Input{Config: mail.Config{Host: b.Host, Port: b.Port, TLS: mail.Mode(b.TLS), Username: b.Username,
		FromAddress: b.FromAddress, FromName: b.FromName, PublicURL: b.PublicURL}, PasswordValue: b.Password}
}

type smtpView struct {
	Configured   bool   `json:"configured"`
	Host         string `json:"host"`
	Port         int    `json:"port"`
	TLS          string `json:"tls"`
	Username     string `json:"username"`
	Password     string `json:"password"` // set | none | undecryptable: never the password
	FromAddress  string `json:"fromAddress"`
	FromName     string `json:"fromName"`
	PublicURL    string `json:"publicUrl"`
	Secret       string `json:"secret"` // ok | missing | invalid
	AllowPrivate bool   `json:"allowPrivate"`
	UpdatedAt    string `json:"updatedAt"`
	// UsersDependOnMail counts users whose only second step is an emailed
	// code: they cannot sign in while mail does not work.
	UsersDependOnMail int `json:"usersDependOnMail"`
}

func (s *server) smtpView(ctx context.Context) (smtpView, error) {
	v := smtpView{Port: 587, TLS: string(mail.ModeStartTLS), Password: string(mail.PasswordNone), Secret: string(s.mail.Secret), AllowPrivate: s.mail.AllowPrivate()}
	c, err := s.mail.Store.Load(ctx)
	if err != nil {
		return v, err
	}
	if c != nil {
		v.Host, v.Port, v.TLS, v.Username, v.Password = c.Host, c.Port, string(c.TLS), c.Username, string(c.Password)
		v.FromAddress, v.FromName, v.PublicURL, v.UpdatedAt = c.FromAddress, c.FromName, c.PublicURL, c.UpdatedAt
	}
	v.Configured = s.mail.Configured(ctx)
	if set, serr := auth.LoadSettings(ctx, s.db); serr == nil {
		if n, cerr := auth.CountMailDependents(ctx, s.db, set.MFAEnforced); cerr == nil {
			v.UsersDependOnMail = n
		}
	}
	return v, nil
}

// requireMailService answers 409 when the build has no mail service.
func (s *server) requireMailService(w http.ResponseWriter) bool {
	if s.mail == nil || s.mail.Store == nil {
		writeAuthError(w, http.StatusConflict, "mail_unavailable", "Email is not available on this server.")
		return false
	}
	return true
}

// writeSMTPInputError maps a validation or state error of the settings
// store to its response; false when err is not one of them.
func writeSMTPInputError(w http.ResponseWriter, err error) bool {
	type m struct {
		err    error
		status int
		code   string
		msg    string
	}
	for _, e := range []m{
		{mail.ErrInvalidHost, 422, "invalid_host", "Enter the host name of the mail server (no scheme, path or spaces)."},
		{mail.ErrHostBlocked, 422, "smtp_host_blocked", "This address is not allowed. Private networks need QINQIN_SMTP_ALLOW_PRIVATE; metadata and link-local addresses are never allowed."},
		{mail.ErrInvalidPort, 422, "invalid_port", "The port must be between 1 and 65535."},
		{mail.ErrInvalidTLS, 422, "invalid_tls", "The connection security must be starttls, tls or none."},
		{mail.ErrCredentialsNeedTLS, 422, "credentials_need_tls", "A user name and password may only be sent over an encrypted connection."},
		{mail.ErrPasswordRequired, 422, "password_required", "A user name needs a password."},
		{mail.ErrInvalidFrom, 422, "invalid_email", "Enter a valid sender address (letters, digits and symbols only, no name)."},
		{mail.ErrInvalidPublicURL, 422, "invalid_public_url", "Enter the address people use to reach this site, such as https://qinqin.example.org (no path, query or login)."},
		{mail.ErrReentryRequired, 422, "password_reentry_required", "Enter the mail password again: the server, port, security or user name changed."},
		{mail.ErrSecretUnavailable, 409, "secret_unavailable", "QINQIN_SECRET is missing or invalid, so a mail password cannot be stored. Set it, or use a relay that needs no password."},
	} {
		if errors.Is(err, e.err) {
			writeAuthError(w, e.status, e.code, e.msg)
			return true
		}
	}
	return false
}

// handleGetSMTP serves GET /api/admin/settings/smtp. The password is never
// part of the answer.
func (s *server) handleGetSMTP(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil || !s.requireMailService(w) {
		return
	}
	v, err := s.smtpView(r.Context())
	if err != nil {
		writeInternal(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, v)
}

// handlePutSMTP serves PUT /api/admin/settings/smtp (the whole object).
func (s *server) handlePutSMTP(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil || !s.requireMailService(w) {
		return
	}
	var req smtpBody
	if !readAccountBodyStrict(w, r, &req) {
		return
	}
	p, err := s.mail.Store.Prepare(r.Context(), req.input())
	if err != nil {
		if !writeSMTPInputError(w, err) {
			writeInternal(w, r)
		}
		return
	}
	if err := s.mail.Store.Save(r.Context(), p, admin.ID); err != nil {
		writeInternal(w, r)
		return
	}
	s.auditSMTP(r.Context(), admin.ID, "saved")
	v, err := s.smtpView(r.Context())
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// handleDeleteSMTP serves DELETE /api/admin/settings/smtp: mail-dependent
// features become inactive.
func (s *server) handleDeleteSMTP(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil || !s.requireMailService(w) {
		return
	}
	if err := s.mail.Store.Delete(r.Context()); err != nil {
		writeInternal(w, r)
		return
	}
	s.auditSMTP(r.Context(), admin.ID, "removed")
	w.WriteHeader(http.StatusNoContent)
}

// auditSMTP records that the settings changed: the field is "smtp", never a
// host, user name or address.
func (s *server) auditSMTP(ctx context.Context, adminID int64, to string) {
	if err := auth.Audit(ctx, s.db, auth.AuditEvent{Action: "settings_changed", ActorID: adminID,
		Detail: map[string]any{"field": "smtp", "to": to}}); err != nil {
		log.Printf("auth: audit of the mail settings failed: %v", err)
	}
}

// handleTestSMTP serves POST /api/admin/settings/smtp/test {to?, draft?}:
// one synchronous test mail through the saved (or draft) settings.
func (s *server) handleTestSMTP(w http.ResponseWriter, r *http.Request) {
	admin := s.requireAdmin(w, r)
	if admin == nil || !s.requireMailService(w) {
		return
	}
	var req struct {
		To    string    `json:"to"`
		Draft *smtpBody `json:"draft"`
	}
	if !readAccountBodyStrict(w, r, &req) {
		return
	}
	if ok, retry := s.authLimiter("smtp-test").Allow(int64Key(admin.ID)); !ok {
		s.logThrottled("smtp-test")
		writeRateLimitedAs(w, retry, "test mails")
		return
	}
	to := req.To
	if to == "" && admin.Email != nil {
		to = *admin.Email
	}
	if _, err := mail.ValidAddress(to); err != nil {
		code, msg := "invalid_email", "Enter a valid recipient address."
		if to == "" {
			code, msg = "recipient_required", "Enter a recipient: your account has no email address."
		}
		writeAuthError(w, http.StatusUnprocessableEntity, code, msg)
		return
	}
	var p *mail.Prepared
	var err error
	if req.Draft != nil {
		p, err = s.mail.Store.Prepare(r.Context(), req.Draft.input())
	} else {
		p, err = s.mail.Store.PrepareStored(r.Context())
	}
	if err != nil {
		if errors.Is(err, mail.ErrNotConfigured) {
			writeAuthError(w, http.StatusConflict, "mail_unavailable", "Save the email settings first.")
		} else if !writeSMTPInputError(w, err) {
			writeInternal(w, r)
		}
		return
	}
	msg, err := mail.Render(mail.KindTest, mail.TemplateData{Site: p.Site()})
	if err != nil {
		writeInternal(w, r)
		return
	}
	msg.To = to
	raw, err := mail.Compose(mail.Sender{Address: p.FromAddress, Name: p.FromName}, msg, time.Now(), rand.Reader)
	if err != nil {
		writeInternal(w, r)
		return
	}
	err = s.mail.TransportFor(p).Send(r.Context(), p.FromAddress, to, raw)
	var se *mail.SendError
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]bool{"sent": true})
	case errors.As(err, &se):
		log.Printf("mail: test failed category=%s", se.Category)
		body := map[string]any{"error": "smtp_test_failed", "category": se.Category,
			"message": "The test mail could not be sent (" + se.Category + ")."}
		if se.Code != 0 {
			body["smtpCode"] = se.Code
		}
		writeJSON(w, http.StatusBadGateway, body)
	default:
		writeInternal(w, r)
	}
}
