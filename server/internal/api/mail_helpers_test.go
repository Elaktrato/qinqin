package api_test

import (
	"database/sql"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/db"
	"qinqin/internal/mail"
	"qinqin/internal/mail/mailtest"
	"qinqin/internal/netguard"
	"qinqin/internal/secretbox"
)

// mailEnv is a server with the mail service mounted on a fake SMTP server.
type mailEnv struct {
	ts    *httptest.Server
	db    *sql.DB
	smtp  *mailtest.Server
	owner string
	svc   *mail.Service
}

const testSMTPPassword = "smtp-pass-sentinel-1"

func testSealer() *secretbox.Sealer {
	b := make([]byte, 32)
	for i := range b {
		b[i] = byte(i + 7)
	}
	return secretbox.NewSealer(b)
}

type mailOpts struct {
	smtp       mailtest.Options
	noSecret   bool
	authPolicy *api.AuthPolicy
	configure  bool // save settings through the admin route
	apiOpts    []api.Option
}

func newMailEnv(t *testing.T, o mailOpts) *mailEnv {
	t.Helper()
	if o.smtp.User == "" && o.smtp.Pass == "" {
		o.smtp.User, o.smtp.Pass = "mailer", testSMTPPassword
	}
	fake, err := mailtest.New(o.smtp)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(fake.Close)
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	policy := netguard.GuardPolicy{AllowPrivate: true}
	store := &mail.Store{DB: sqlDB, Policy: policy}
	state := secretbox.SecretMissing
	if !o.noSecret {
		store.Current = testSealer()
		state = secretbox.SecretOK
	}
	svc := &mail.Service{Store: store, Secret: state, Policy: policy, RootCAs: fake.RootCAs(), Timeout: 5 * time.Second}
	opts := append([]api.Option{api.WithMail(svc)}, o.apiOpts...)
	if o.authPolicy != nil {
		opts = append(opts, api.WithAuthPolicy(*o.authPolicy))
	}
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil, opts...))
	t.Cleanup(ts.Close)
	e := &mailEnv{ts: ts, db: sqlDB, smtp: fake, svc: svc}
	e.owner = registerUser(t, ts.URL, "owner", "")
	if o.configure {
		e.configure(t)
	}
	return e
}

// smtpPayload is a valid PUT body for the fake server.
func (e *mailEnv) smtpPayload() map[string]any {
	return map[string]any{"host": e.smtp.Host, "port": e.smtp.Port, "tls": "starttls", "username": "mailer", "password": testSMTPPassword,
		"fromAddress": "qinqin@example.org", "fromName": "qinqin", "publicUrl": "https://words.example.org"}
}

func (e *mailEnv) configure(t *testing.T) {
	t.Helper()
	if r := doJSON(t, "PUT", e.ts.URL, "/api/admin/settings/smtp", e.owner, e.smtpPayload()); r.StatusCode != 200 {
		t.Fatalf("configure smtp = %d", r.StatusCode)
	}
}

type mailOptsAlias = mailtest.Options

func smtpNoAuth() mailtest.Options { return mailtest.Options{User: "-"} }

func smtpWith(f func(*mailtest.Options)) mailtest.Options {
	o := mailtest.Options{User: "mailer", Pass: testSMTPPassword}
	f(&o)
	return o
}
