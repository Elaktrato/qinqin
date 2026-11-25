package webpush

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"qinqin/internal/netguard"
)

// VAPID is the server's application server key pair (RFC 8292).
type VAPID struct{ key *ecdsa.PrivateKey }

// NewVAPID generates a P-256 key pair.
func NewVAPID() (*VAPID, error) {
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	return &VAPID{k}, nil
}

// ParseVAPID restores a pair from PrivateBytes.
func ParseVAPID(raw []byte) (*VAPID, error) {
	p, err := ecdh.P256().NewPrivateKey(raw)
	if err != nil {
		return nil, errors.New("webpush: bad private key")
	}
	k, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), p.Bytes())
	if err != nil {
		return nil, errors.New("webpush: bad private key")
	}
	return &VAPID{k}, nil
}

// PrivateBytes is the 32-byte private scalar: a secret, stored sealed.
func (v *VAPID) PrivateBytes() []byte {
	b, _ := v.key.Bytes()
	return b
}

// PublicKey is the application server key a browser subscribes with:
// the base64url (unpadded) uncompressed point.
func (v *VAPID) PublicKey() string {
	pub, _ := v.key.PublicKey.Bytes()
	return base64.RawURLEncoding.EncodeToString(pub)
}

// Authorization is the Authorization header for a push to endpoint: an
// ES256 JWT (aud = the endpoint's origin, valid 12 hours, sub = subject).
func (v *VAPID) Authorization(endpoint, subject string, now time.Time) (string, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" {
		return "", errors.New("webpush: bad endpoint")
	}
	claims, _ := json.Marshal(map[string]any{"aud": u.Scheme + "://" + u.Host, "exp": now.Add(12 * time.Hour).Unix(), "sub": subject})
	enc := base64.RawURLEncoding
	signing := enc.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`)) + "." + enc.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signing))
	r, s, err := ecdsa.Sign(rand.Reader, v.key, digest[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return "vapid t=" + signing + "." + enc.EncodeToString(sig) + ", k=" + v.PublicKey(), nil
}

// Subscription is a browser's push subscription: where to post, and the
// keys that encrypt for it. It is a credential: never log it.
type Subscription struct {
	Endpoint string
	P256dh   []byte
	Auth     []byte
}

// Options are the per-message headers.
type Options struct {
	TTL     time.Duration // default 12 hours
	Urgency string        // very-low, low, normal, high; empty: normal
}

// MaxEndpoint caps an endpoint's length.
const MaxEndpoint = 1024

// ValidEndpoint reports whether endpoint is an https URL with a host, no
// credentials and no fragment, of a sane length. The network guard
// (netguard) still checks where it resolves, at send time.
func ValidEndpoint(endpoint string) bool {
	if endpoint == "" || len(endpoint) > MaxEndpoint {
		return false
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return false
	}
	if p := u.Port(); p != "" {
		n, err := strconv.Atoi(p)
		if err != nil || n < 1 || n > 65535 {
			return false
		}
	}
	return true
}

// ErrGone reports that the push service no longer knows the subscription
// (404 or 410): delete it.
var ErrGone = errors.New("webpush: subscription gone")

// SendError is a failed delivery: the push service's status (0: no answer)
// and nothing else; never the endpoint, the keys or a response body.
type SendError struct {
	Status int
	Kind   string
}

func (e *SendError) Error() string { return fmt.Sprintf("webpush: %s %d", e.Kind, e.Status) }

func (e *SendError) Is(target error) bool {
	return target == ErrGone && (e.Status == http.StatusNotFound || e.Status == http.StatusGone)
}

// Sender posts messages. Every request goes through the network guard
// (Policy): a subscription cannot point the server at an internal address.
type Sender struct {
	VAPID   *VAPID
	Subject string // the VAPID sub claim: mailto: or https URL
	Policy  netguard.GuardPolicy
	// Client, when set, replaces the guarded client (tests with a local TLS server).
	Client   *http.Client
	Resolver *net.Resolver
	Now      func() time.Time
}

func (s *Sender) client() *http.Client {
	if s.Client != nil {
		return s.Client
	}
	return &http.Client{
		Timeout: 20 * time.Second,
		Transport: &http.Transport{
			DialContext:         netguard.DialContext(s.Policy, s.Resolver),
			TLSHandshakeTimeout: 10 * time.Second,
			DisableKeepAlives:   true,
		},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// Send encrypts payload for sub and posts it.
func (s *Sender) Send(ctx context.Context, sub Subscription, payload []byte, opt Options) error {
	if !ValidEndpoint(sub.Endpoint) {
		return &SendError{Kind: "endpoint"}
	}
	if u, _ := url.Parse(sub.Endpoint); u != nil && s.Client == nil {
		if err := netguard.CheckHost(u.Hostname(), s.Policy); err != nil {
			return &SendError{Kind: "blocked"}
		}
	}
	body, err := Encrypt(payload, sub.P256dh, sub.Auth)
	if err != nil {
		return &SendError{Kind: "encrypt"}
	}
	now := time.Now()
	if s.Now != nil {
		now = s.Now()
	}
	authz, err := s.VAPID.Authorization(sub.Endpoint, s.Subject, now)
	if err != nil {
		return &SendError{Kind: "vapid"}
	}
	ttl := opt.TTL
	if ttl <= 0 {
		ttl = 12 * time.Hour
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.Endpoint, bytes.NewReader(body))
	if err != nil {
		return &SendError{Kind: "endpoint"}
	}
	req.Header.Set("Authorization", authz)
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("TTL", strconv.Itoa(int(ttl.Seconds())))
	if opt.Urgency != "" {
		req.Header.Set("Urgency", opt.Urgency)
	}
	resp, err := s.client().Do(req)
	if err != nil {
		return &SendError{Kind: "network"}
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	return &SendError{Kind: "rejected", Status: resp.StatusCode}
}
