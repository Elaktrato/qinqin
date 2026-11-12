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
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"qinqin/internal/library"
)

// Result is one search hit.
type Result struct{ SourceID, Title, Author, Language, Note string }

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

// ErrTooLarge reports a response body above the caller's cap.
var ErrTooLarge = errors.New("sources: response too large")

const (
	requestTimeout = 15 * time.Second
	hostInterval   = time.Second
	maxRedirects   = 5
)

// HTTPClient fetches http(s) URLs with a User-Agent, a timeout, at most
// one request per second per host, a body cap and an on-disk cache.
type HTTPClient struct {
	hc       *http.Client
	ua       string
	cacheDir string

	mu    sync.Mutex
	next  map[string]time.Time // earliest start of the next request per host
	now   func() time.Time
	sleep func(ctx context.Context, d time.Duration) error
}

// NewHTTPClient returns a client caching under cacheDir (created on
// first write) and sending userAgent.
func NewHTTPClient(cacheDir, userAgent string) *HTTPClient {
	return &HTTPClient{
		hc: &http.Client{
			Timeout: requestTimeout,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= maxRedirects {
					return errors.New("sources: too many redirects")
				}
				return checkScheme(req.URL)
			},
		},
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
}

// SetClock replaces the clock and the sleep used for rate limiting and
// cache expiry; it exists so tests do not wait.
func (c *HTTPClient) SetClock(now func() time.Time, sleep func(ctx context.Context, d time.Duration) error) {
	c.mu.Lock()
	c.now, c.sleep = now, sleep
	c.mu.Unlock()
}

func checkScheme(u *url.URL) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("sources: unsupported URL scheme %q", u.Scheme)
	}
	if u.Host == "" {
		return errors.New("sources: URL has no host")
	}
	return nil
}

// cachePath is derived from a hash of the URL only.
func (c *HTTPClient) cachePath(rawURL string) string {
	sum := sha256.Sum256([]byte(rawURL))
	return filepath.Join(c.cacheDir, hex.EncodeToString(sum[:]))
}

// Get returns the body of rawURL. A cached copy younger than ttl is
// returned without a request; ttl <= 0 disables caching. A body larger
// than maxBytes is an ErrTooLarge error, never a truncated result.
func (c *HTTPClient) Get(ctx context.Context, rawURL string, maxBytes int64, ttl time.Duration) ([]byte, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("sources: bad URL: %w", err)
	}
	if err := checkScheme(u); err != nil {
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
		return nil, err
	}
	req.Header.Set("User-Agent", c.ua)
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, err
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
		return nil, err
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
	c.mu.Lock()
	now := c.now()
	c.mu.Unlock()
	if now.Sub(fi.ModTime()) >= ttl {
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
