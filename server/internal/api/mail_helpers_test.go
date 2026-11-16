package api_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"mime/quotedprintable"
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
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
	clk   *testClock
}

// testClock is the server's clock; tests move it to cross TOTP steps.
type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *testClock) now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *testClock) advance(d time.Duration) {
	c.mu.Lock()
	c.t = c.t.Add(d)
	c.mu.Unlock()
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
	workerCtx, stopWorker := context.WithCancel(context.Background())
	go svc.Run(workerCtx)
	t.Cleanup(stopWorker)
	clk := &testClock{t: time.Now()}
	opts := append([]api.Option{api.WithMail(svc), api.WithClock(clk.now)}, o.apiOpts...)
	if !o.noSecret {
		opts = append(opts, api.WithSecrets(testSealer(), nil))
	}
	pol := api.DefaultAuthPolicy()
	pol.Client.Burst = 5000
	if o.authPolicy != nil {
		pol = *o.authPolicy
	}
	opts = append(opts, api.WithAuthPolicy(pol))
	ts := httptest.NewServer(api.New(sqlDB, t.TempDir(), nil, opts...))
	t.Cleanup(ts.Close)
	e := &mailEnv{ts: ts, db: sqlDB, smtp: fake, svc: svc, clk: clk}
	e.owner = registerUser(t, ts.URL, "owner", "")
	if o.configure {
		e.configure(t)
	}
	return e
}

// smtpPayload is a valid PUT body for the fake server, with the owner's
// re-authentication (an owner without an authenticator).
func (e *mailEnv) smtpPayload() map[string]any {
	return map[string]any{"host": e.smtp.Host, "port": e.smtp.Port, "tls": "starttls", "username": "mailer", "password": testSMTPPassword,
		"fromAddress": "qinqin@example.org", "fromName": "qinqin", "publicUrl": "https://words.example.org", "currentPassword": "secret-pass-owner"}
}

// ownerReauth is the owner's re-authentication body (no authenticator).
var ownerReauth = map[string]any{"currentPassword": "secret-pass-owner"}

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

// inbox helpers: the fake server keeps raw messages; these decode them.

type inboxMail struct{ To, Subject, Body string }

func (e *mailEnv) inbox() []inboxMail {
	var out []inboxMail
	for _, m := range e.smtp.Messages() {
		head, body, _ := strings.Cut(m.Data, "\r\n\r\n")
		dec, _ := io.ReadAll(quotedprintable.NewReader(strings.NewReader(body)))
		subj := ""
		for _, l := range strings.Split(head, "\r\n") {
			if strings.HasPrefix(l, "Subject: ") {
				subj = strings.TrimPrefix(l, "Subject: ")
			}
		}
		out = append(out, inboxMail{To: m.To[0], Subject: subj, Body: string(dec)})
	}
	return out
}

// waitMails waits until the inbox holds n messages and returns them.
func (e *mailEnv) waitMails(t *testing.T, n int) []inboxMail {
	t.Helper()
	for i := 0; i < 300; i++ {
		if got := e.inbox(); len(got) >= n {
			return got
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("inbox has %d mails, want %d", len(e.inbox()), n)
	return nil
}

// noMoreMails fails when the inbox grows beyond n within a short grace.
func (e *mailEnv) noMoreMails(t *testing.T, n int) {
	t.Helper()
	time.Sleep(150 * time.Millisecond)
	if got := len(e.inbox()); got != n {
		t.Fatalf("inbox has %d mails, want %d", got, n)
	}
}

var sixDigits = regexp.MustCompile(`\b(\d{6})\b`)

func codeIn(t *testing.T, m inboxMail) string {
	t.Helper()
	g := sixDigits.FindStringSubmatch(m.Body)
	if g == nil {
		t.Fatalf("no code in %q", m.Body)
	}
	return g[1]
}

var resetLink = regexp.MustCompile(`https?://\S+/reset#t=(\S+)`)

func decodeString(t *testing.T, s string, v any) {
	t.Helper()
	if err := json.Unmarshal([]byte(s), v); err != nil {
		t.Fatalf("decode %q: %v", s, err)
	}
}
