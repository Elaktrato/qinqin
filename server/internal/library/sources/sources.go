// Package sources defines the interface of public-domain text sources and
// the polite, cached, size-capped HTTP client they share.
package sources

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"qinqin/internal/library"
)

// Result is one search hit. Reading is the title's reading (hiragana
// for ja, toneless pinyin for zh), set only when the work matched the
// query phonetically.
type Result struct {
	SourceID string `json:"sourceId"`
	Title    string `json:"title"`
	Author   string `json:"author"`
	Language string `json:"language"`
	Note     string `json:"note"`
	Reading  string `json:"reading,omitempty"`
}

// Imported is a fetched work; Meta has title, author, language, source,
// source_id, source_url, attribution and license_note filled.
type Imported struct {
	Meta     library.Book
	Chapters []library.Chapter
}

// Source is a catalog of freely importable works.
type Source interface {
	ID() string // "aozora" | "gutenberg"
	Search(ctx context.Context, q string, limit int) ([]Result, error)
	Fetch(ctx context.Context, sourceID string) (Imported, error)
}

var (
	// ErrTooLarge reports a response body (or imported work) above its cap.
	ErrTooLarge = errors.New("sources: response too large")
	// ErrBlocked reports a URL refused by the host policy, a scheme
	// downgrade, or a non-public address.
	ErrBlocked = errors.New("sources: request blocked")
	// ErrTooManyRedirects reports a redirect chain longer than allowed.
	ErrTooManyRedirects = errors.New("sources: too many redirects")
	// ErrNotFound reports a work id the source does not offer.
	ErrNotFound = errors.New("sources: work not found")
)

const (
	// dialTimeout bounds connecting and the TLS handshake; headerTimeout
	// bounds the wait for the response headers. Nothing bounds the whole
	// request: the caller's context does, so a large body (the 21 MB
	// Gutenberg catalog) may take as long as the caller allows.
	dialTimeout   = 15 * time.Second
	headerTimeout = 15 * time.Second
	hostInterval  = time.Second
	maxRedirects  = 5
)

// shared is the state common to a client and its policy views: the
// cache, the per-host rate limiter, the clock and the transport.
type shared struct {
	ua        string
	cacheDir  string
	transport *http.Transport

	// AllowPrivate lets the client connect to loopback, private and
	// other non-public addresses. It is off in production; tests that
	// talk to httptest servers on 127.0.0.1 turn it on before use.
	AllowPrivate bool

	mu    sync.Mutex
	next  map[string]time.Time // earliest start of the next request per host
	now   func() time.Time
	sleep func(ctx context.Context, d time.Duration) error
}

// HTTPClient fetches http(s) URLs with a User-Agent, dial and
// response-header timeouts (the caller's context bounds the rest), at most
// one request per second per host, a body cap and an on-disk cache. It
// only connects to public addresses and applies an optional host policy
// to the first URL and to every redirect hop. Environment proxies are
// disabled on purpose: the dialer Control hook must see the real target
// IP, and enabling a proxy would bypass the SSRF guard.
type HTTPClient struct {
	*shared
	hc    *http.Client
	check func(*url.URL) error
}

// NewHTTPClient returns a client caching under cacheDir (created on
// first write) and sending userAgent.
func NewHTTPClient(cacheDir, userAgent string) *HTTPClient {
	s := &shared{
		ua:       userAgent,
		cacheDir: cacheDir,
		next:     map[string]time.Time{},
		now:      time.Now,
		sleep: func(ctx context.Context, d time.Duration) error {
			t := time.NewTimer(d)
			defer t.Stop()
			select {
			case <-t.C:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		},
	}
	dialer := &net.Dialer{
		Timeout: dialTimeout,
		// Control sees the resolved address, so it also stops hostnames
		// that resolve (or rebind) to a non-public IP.
		Control: func(network, address string, _ syscall.RawConn) error {
			if s.AllowPrivate {
				return nil
			}
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return ErrBlocked
			}
			if ip := net.ParseIP(host); ip == nil || !isPublic(ip) {
				return ErrBlocked
			}
			return nil
		},
	}
	// No Proxy on purpose (not http.ProxyFromEnvironment): the dialer Control hook
	// must see the real target IP, and a proxy would bypass the SSRF guard.
	s.transport = &http.Transport{
		DialContext:           dialer.DialContext,
		TLSHandshakeTimeout:   dialTimeout,
		ResponseHeaderTimeout: headerTimeout,
		MaxIdleConnsPerHost:   2,
		IdleConnTimeout:       30 * time.Second,
	}
	return s.view(nil)
}

func isPublic(ip net.IP) bool {
	return !(ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified())
}

func (s *shared) view(check func(*url.URL) error) *HTTPClient {
	return &HTTPClient{
		shared: s,
		check:  check,
		hc: &http.Client{
			// No Timeout: it would cover the body read too. Requests are
			// bounded by the caller's context and the transport timeouts.
			Transport: s.transport,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= maxRedirects {
					return ErrTooManyRedirects
				}
				if err := checkURL(req.URL, check); err != nil {
					return err
				}
				if prev := via[len(via)-1].URL; prev.Scheme == "https" && req.URL.Scheme != "https" {
					return fmt.Errorf("%w: https to http redirect", ErrBlocked)
				}
				return nil
			},
		},
	}
}

// For returns a view of the client that additionally enforces check on
// every URL it fetches, redirects included. The view shares the cache,
// rate limiter and clock with c.
func (c *HTTPClient) For(check func(*url.URL) error) *HTTPClient { return c.view(check) }

// SetResponseHeaderTimeout replaces how long a request waits for the
// response headers (15 s by default); it exists so tests do not wait.
// Call it before the client is used.
func (c *HTTPClient) SetResponseHeaderTimeout(d time.Duration) {
	c.transport.ResponseHeaderTimeout = d
}

// SetClock replaces the clock and the sleep used for rate limiting and
// cache expiry; it exists so tests do not wait.
func (c *HTTPClient) SetClock(now func() time.Time, sleep func(ctx context.Context, d time.Duration) error) {
	c.mu.Lock()
	c.now, c.sleep = now, sleep
	c.mu.Unlock()
}

// Now returns the client's (possibly injected) current time.
func (c *HTTPClient) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now()
}

func checkURL(u *url.URL, check func(*url.URL) error) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("%w: unsupported URL scheme %q", ErrBlocked, u.Scheme)
	}
	if u.Host == "" {
		return fmt.Errorf("%w: URL has no host", ErrBlocked)
	}
	if check != nil {
		if err := check(u); err != nil {
			return fmt.Errorf("%w: host %s", ErrBlocked, u.Host)
		}
	}
	return nil
}

// cachePath is derived from a hash of the URL only.
func (c *HTTPClient) cachePath(rawURL string) string {
	sum := sha256.Sum256([]byte(rawURL))
	return filepath.Join(c.cacheDir, hex.EncodeToString(sum[:]))
}

// Invalidate removes the cached body of rawURL; a missing entry is not
// an error. Callers use it when a cached body turned out to be bad.
func (c *HTTPClient) Invalidate(rawURL string) error {
	if err := os.Remove(c.cachePath(rawURL)); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// sanitize keeps request errors from leaking URLs and IP addresses
// while preserving errors.Is for the sentinels and context errors.
func sanitize(host string, err error) error {
	switch {
	case errors.Is(err, ErrBlocked):
		return fmt.Errorf("sources: GET %s: %w", host, ErrBlocked)
	case errors.Is(err, ErrTooManyRedirects):
		return fmt.Errorf("sources: GET %s: %w", host, ErrTooManyRedirects)
	case errors.Is(err, context.Canceled):
		return fmt.Errorf("sources: GET %s: %w", host, context.Canceled)
	case errors.Is(err, context.DeadlineExceeded):
		return fmt.Errorf("sources: GET %s: %w", host, context.DeadlineExceeded)
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return fmt.Errorf("sources: GET %s: %w", host, context.DeadlineExceeded)
	}
	return fmt.Errorf("sources: GET %s: request failed", host)
}

// Get returns the body of rawURL. A cached copy younger than ttl is
// returned without a request; ttl <= 0 disables caching. A body larger
// than maxBytes is an ErrTooLarge error, never a truncated result.
func (c *HTTPClient) Get(ctx context.Context, rawURL string, maxBytes int64, ttl time.Duration) ([]byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, errors.New("sources: bad URL")
	}
	if err := checkURL(u, c.check); err != nil {
		return nil, err
	}
	path := c.cachePath(rawURL)
	if ttl > 0 {
		if b, ok := c.readCache(path, maxBytes, ttl); ok {
			return b, nil
		}
	}
	if err := c.wait(ctx, u.Host); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, errors.New("sources: bad URL")
	}
	req.Header.Set("User-Agent", c.ua)
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, sanitize(u.Host, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("sources: GET %s: status %d", u.Host, resp.StatusCode)
	}
	if resp.ContentLength > maxBytes {
		return nil, ErrTooLarge
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, sanitize(u.Host, err)
	}
	if int64(len(body)) > maxBytes {
		return nil, ErrTooLarge
	}
	if ttl > 0 {
		c.writeCache(path, body) // best effort: a failed cache write is not a failed fetch
	}
	return body, nil
}

// wait reserves the next request slot for host and sleeps until it.
func (c *HTTPClient) wait(ctx context.Context, host string) error {
	c.mu.Lock()
	now, sleep := c.now(), c.sleep
	start := now
	if n := c.next[host]; n.After(start) {
		start = n
	}
	c.next[host] = start.Add(hostInterval)
	c.mu.Unlock()
	if d := start.Sub(now); d > 0 {
		return sleep(ctx, d)
	}
	return nil
}

func (c *HTTPClient) readCache(path string, maxBytes int64, ttl time.Duration) ([]byte, bool) {
	fi, err := os.Stat(path)
	if err != nil || !fi.Mode().IsRegular() || fi.Size() > maxBytes {
		return nil, false
	}
	if c.Now().Sub(fi.ModTime()) >= ttl {
		return nil, false
	}
	b, err := os.ReadFile(path)
	if err != nil || int64(len(b)) > maxBytes {
		return nil, false
	}
	return b, true
}

// writeCache writes to a temporary file and renames it into place so
// concurrent writers never expose a partial file.
func (c *HTTPClient) writeCache(path string, body []byte) {
	if err := os.MkdirAll(c.cacheDir, 0o700); err != nil {
		return
	}
	tmp, err := os.CreateTemp(c.cacheDir, "tmp-*")
	if err != nil {
		return
	}
	_, werr := tmp.Write(body)
	cerr := tmp.Close()
	if werr != nil || cerr != nil || os.Rename(tmp.Name(), path) != nil {
		os.Remove(tmp.Name())
	}
}
