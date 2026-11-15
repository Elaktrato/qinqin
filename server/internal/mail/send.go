package mail

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"time"

	"qinqin/internal/netguard"
)

// Mode is how the connection is secured.
type Mode string

const (
	ModeStartTLS Mode = "starttls" // STARTTLS is required, never silently skipped
	ModeTLS      Mode = "tls"      // implicit TLS (port 465)
	ModeNone     Mode = "none"     // plain text; never with credentials
)

// Valid reports whether m is one of the three modes.
func (m Mode) Valid() bool { return m == ModeStartTLS || m == ModeTLS || m == ModeNone }

// Failure categories of SendError.
const (
	CatConnect   = "connect"
	CatBlocked   = "blocked"
	CatTLS       = "tls"
	CatAuth      = "auth"
	CatSender    = "sender"
	CatRecipient = "recipient"
	CatTimeout   = "timeout"
	CatProtocol  = "protocol"
)

// SendError is the only error Send returns. It carries a category and the
// 3-digit reply code when there was one, never reply text, a banner, an
// address or a credential: those could expose internal details or secrets.
type SendError struct {
	Category string
	Code     int
}

func (e *SendError) Error() string {
	if e.Code != 0 {
		return "smtp " + e.Category + " " + strconv.Itoa(e.Code)
	}
	return "smtp " + e.Category
}

// Transport sends one message per call to the configured server.
type Transport struct {
	Host     string
	Port     int
	TLS      Mode
	Username string
	Password string
	Policy   netguard.GuardPolicy
	Resolver *net.Resolver
	// Timeout bounds the whole conversation (default 30 s).
	Timeout time.Duration
	// RootCAs replaces the system roots (tests only).
	RootCAs *x509.CertPool
}

const defaultTimeout = 30 * time.Second

func classify(err error, fallback string) *SendError {
	var se *SendError
	if errors.As(err, &se) {
		return se
	}
	var ne net.Error
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) || (errors.As(err, &ne) && ne.Timeout()) {
		return &SendError{Category: CatTimeout}
	}
	var te *textproto.Error
	if errors.As(err, &te) {
		return &SendError{Category: fallback, Code: te.Code}
	}
	return &SendError{Category: fallback}
}

// Send delivers raw (a composed message) from the envelope sender to one
// recipient.
func (t Transport) Send(ctx context.Context, from, to string, raw []byte) error {
	if t.TLS == ModeNone && (t.Username != "" || t.Password != "") {
		return &SendError{Category: CatProtocol} // credentials never travel in clear text
	}
	if !t.TLS.Valid() {
		return &SendError{Category: CatProtocol}
	}
	if _, err := ValidAddress(from); err != nil {
		return &SendError{Category: CatSender}
	}
	if _, err := ValidAddress(to); err != nil {
		return &SendError{Category: CatRecipient}
	}
	if err := netguard.CheckHost(t.Host, t.Policy); err != nil {
		return &SendError{Category: CatBlocked}
	}
	timeout := t.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	err := t.converse(ctx, from, to, raw)
	if err != nil && ctx.Err() != nil {
		return &SendError{Category: CatTimeout} // the deadline closed the connection under the client
	}
	return err
}

func (t Transport) converse(ctx context.Context, from, to string, raw []byte) error {
	conn, err := netguard.DialContext(t.Policy, t.Resolver)(ctx, "tcp", net.JoinHostPort(t.Host, strconv.Itoa(t.Port)))
	if err != nil {
		if errors.Is(err, netguard.ErrBlocked) {
			return &SendError{Category: CatBlocked}
		}
		return classify(err, CatConnect)
	}
	defer conn.Close()
	deadline, _ := ctx.Deadline()
	conn.SetDeadline(deadline)
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()

	cfg := &tls.Config{ServerName: t.Host, MinVersion: tls.VersionTLS12, RootCAs: t.RootCAs}
	if t.TLS == ModeTLS {
		tc := tls.Client(conn, cfg)
		if err := tc.HandshakeContext(ctx); err != nil {
			return tlsOrTimeout(err)
		}
		conn = tc
	}
	c, err := smtp.NewClient(conn, t.Host)
	if err != nil {
		return classify(err, CatProtocol)
	}
	defer c.Close()
	if err := c.Hello("localhost"); err != nil {
		return classify(err, CatProtocol)
	}
	if t.TLS == ModeStartTLS {
		if ok, _ := c.Extension("STARTTLS"); !ok {
			return &SendError{Category: CatTLS}
		}
		if err := c.StartTLS(cfg); err != nil {
			return tlsOrTimeout(err)
		}
	}
	if t.Username != "" {
		_, params := c.Extension("AUTH")
		var auth smtp.Auth
		switch mechs := " " + strings.ToUpper(params) + " "; {
		case strings.Contains(mechs, " PLAIN "):
			auth = smtp.PlainAuth("", t.Username, t.Password, t.Host)
		case strings.Contains(mechs, " LOGIN "):
			auth = loginAuth{t.Username, t.Password}
		default:
			return &SendError{Category: CatAuth}
		}
		if err := c.Auth(auth); err != nil {
			return classify(err, CatAuth)
		}
	}
	if err := c.Mail(from); err != nil {
		return classify(err, CatSender)
	}
	if err := c.Rcpt(to); err != nil {
		return classify(err, CatRecipient)
	}
	w, err := c.Data()
	if err != nil {
		return classify(err, CatProtocol)
	}
	if _, err := w.Write(raw); err != nil {
		return classify(err, CatProtocol)
	}
	if err := w.Close(); err != nil {
		return classify(err, CatProtocol)
	}
	c.Quit()
	return nil
}

func tlsOrTimeout(err error) *SendError {
	var ne net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &ne) && ne.Timeout()) {
		return &SendError{Category: CatTimeout}
	}
	return &SendError{Category: CatTLS}
}
