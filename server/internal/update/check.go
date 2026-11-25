package update

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Check states and error kinds (docs/contracts/version/update-check.json).
const (
	StateDisabled  = "disabled"
	StateUnchecked = "unchecked"
	StateOK        = "ok"
	StateError     = "error"

	ErrOffline     = "offline"
	ErrRateLimited = "rate_limited"
	ErrBadResponse = "bad_response"

	RelAvailable = "available"
	RelCurrent   = "current"
	RelAhead     = "ahead"
	RelUnknown   = "unknown"
)

// Limits of the check.
const (
	MaxNotes     = 16 * 1024
	maxBody      = 1 << 20
	okFresh      = 6 * time.Hour
	failFresh    = 15 * time.Minute
	forceFloor   = 30 * time.Second
	userAgent    = "qinqin-update-check"
	defaultBase  = "https://api.github.com"
	defaultRepo  = "Elaktrato/qinqin"
	defaultLimit = 8 * time.Second
)

// Release is the newest release the check found.
type Release struct {
	Version     string `json:"version"`
	Tag         string `json:"tag"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	PublishedAt string `json:"publishedAt"`
	Prerelease  bool   `json:"prerelease"`
	Notes       string `json:"notes"`
}

// Result is what the checker knows. Latest is nil when no release is known.
type Result struct {
	State     string
	Error     string
	Stale     bool
	Latest    *Release
	CheckedAt time.Time
}

// Config configures a Checker; every field has a default.
type Config struct {
	BaseURL string
	Repo    string
	Token   string
	Timeout time.Duration
	Now     func() time.Time
}

// Checker asks GitHub Releases for the newest release and caches the answer
// in memory. It is safe for concurrent use.
type Checker struct {
	cfg    Config
	client *http.Client

	mu          sync.Mutex
	releases    []Release // newest first, stable and pre-release
	etag        string
	have        bool      // a good answer is cached
	fetchedAt   time.Time // last good answer or 304
	lastAttempt time.Time
	failErr     string
	failAt      time.Time
	inflight    chan struct{} // closed when the request under way is stored
}

// NewChecker builds a Checker.
func NewChecker(cfg Config) *Checker {
	if cfg.BaseURL == "" {
		cfg.BaseURL = defaultBase
	}
	if cfg.Repo == "" {
		cfg.Repo = defaultRepo
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = defaultLimit
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Checker{cfg: cfg, client: &http.Client{Timeout: cfg.Timeout}}
}

// Last reports the cached state without any request.
func (c *Checker) Last(prereleases bool) Result {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.resultLocked(prereleases)
}

// Check returns the cached answer while it is fresh, else asks GitHub. force
// ("check now") skips the freshness windows but not a 30 s floor.
//
// The request to GitHub runs without the mutex (readers of the cached state are
// never held up by a slow GitHub) and is shared: callers that arrive while one
// is under way wait for its answer. It is detached from the caller's
// cancellation, bounded by the client timeout instead: an admin who closes the
// page must not record "offline" and cache it for the failure window.
func (c *Checker) Check(ctx context.Context, prereleases, force bool) Result {
	c.mu.Lock()
	now := c.cfg.Now()
	switch {
	case force:
		if !c.lastAttempt.IsZero() && now.Sub(c.lastAttempt) < forceFloor {
			defer c.mu.Unlock()
			return c.resultLocked(prereleases)
		}
	case c.failErr != "" && now.Sub(c.failAt) < failFresh:
		defer c.mu.Unlock()
		return c.resultLocked(prereleases)
	case c.failErr == "" && c.have && now.Sub(c.fetchedAt) < okFresh:
		defer c.mu.Unlock()
		return c.resultLocked(prereleases)
	}
	if done := c.inflight; done != nil {
		c.mu.Unlock()
		select {
		case <-done:
		case <-ctx.Done():
		}
		c.mu.Lock()
		defer c.mu.Unlock()
		return c.resultLocked(prereleases)
	}
	c.lastAttempt = now
	done := make(chan struct{})
	c.inflight = done
	have, etag := c.have, c.etag
	c.mu.Unlock()

	out := c.fetch(context.WithoutCancel(ctx), have, etag)

	c.mu.Lock()
	defer c.mu.Unlock()
	c.apply(out, now)
	c.inflight = nil
	close(done)
	return c.resultLocked(prereleases)
}

func (c *Checker) resultLocked(prereleases bool) Result {
	r := Result{State: StateUnchecked}
	if c.have {
		r.State, r.CheckedAt = StateOK, c.fetchedAt
		for i := range c.releases {
			if c.releases[i].Prerelease && !prereleases {
				continue
			}
			rel := c.releases[i]
			r.Latest = &rel
			break
		}
	}
	if c.failErr != "" {
		r.State, r.Error, r.Stale = StateError, c.failErr, c.have
	}
	return r
}

// outcome is what one request to GitHub found; apply stores it.
type outcome struct {
	failKind    string // non-empty: the request failed
	notModified bool
	releases    []Release
	etag        string
}

func failed(kind string) outcome { return outcome{failKind: kind} }

// apply records an outcome in the cached state.
func (c *Checker) apply(o outcome, now time.Time) {
	switch {
	case o.failKind != "":
		c.failErr, c.failAt = o.failKind, now
	case o.notModified:
		c.failErr, c.fetchedAt = "", now
	default:
		c.releases = o.releases
		c.etag, c.have, c.failErr, c.fetchedAt = o.etag, true, "", now
	}
}

// fetch asks GitHub; it reads no mutable state of the Checker (have and etag are
// the caller's snapshot).
func (c *Checker) fetch(ctx context.Context, have bool, etag string) outcome {
	u := strings.TrimRight(c.cfg.BaseURL, "/") + "/repos/" + c.cfg.Repo + "/releases?per_page=30"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return failed(ErrBadResponse)
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if have && etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	if c.cfg.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.Token)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return failed(ErrOffline)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotModified && have:
		return outcome{notModified: true}
	case resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests:
		return failed(ErrRateLimited)
	case resp.StatusCode != http.StatusOK:
		return failed(ErrBadResponse)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody+1))
	if err != nil {
		return failed(ErrOffline)
	}
	if len(body) > maxBody {
		return failed(ErrBadResponse)
	}
	var raw []struct {
		Tag         string `json:"tag_name"`
		Name        string `json:"name"`
		Body        string `json:"body"`
		Draft       bool   `json:"draft"`
		Prerelease  bool   `json:"prerelease"`
		PublishedAt string `json:"published_at"`
		HTMLURL     string `json:"html_url"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return failed(ErrBadResponse)
	}
	type entry struct {
		v   Version
		rel Release
	}
	var list []entry
	for _, r := range raw {
		if r.Draft {
			continue
		}
		v, err := ParseVersion(r.Tag)
		if err != nil {
			continue
		}
		link := r.HTMLURL
		if !strings.HasPrefix(link, "https://github.com/") {
			link = "https://github.com/" + c.cfg.Repo + "/releases/tag/" + url.PathEscape(r.Tag)
		}
		list = append(list, entry{v, Release{
			Version: v.String(), Tag: r.Tag, Name: r.Name, URL: link, PublishedAt: r.PublishedAt,
			Prerelease: r.Prerelease || v.Prerelease(), Notes: capNotes(r.Body),
		}})
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].v.Compare(list[j].v) > 0 })
	releases := make([]Release, 0, len(list))
	for _, e := range list {
		releases = append(releases, e.rel)
	}
	return outcome{releases: releases, etag: resp.Header.Get("ETag")}
}

// capNotes cuts s to MaxNotes bytes at a rune boundary, ending in an ellipsis.
func capNotes(s string) string {
	if len(s) <= MaxNotes {
		return s
	}
	const ell = "…"
	cut := MaxNotes - len(ell)
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + ell
}

// Relation says how the installed version stands against the latest one.
func Relation(installed, latest string) string {
	a, err := ParseVersion(installed)
	if err != nil {
		return RelUnknown
	}
	b, err := ParseVersion(latest)
	if err != nil {
		return RelUnknown
	}
	switch a.Compare(b) {
	case -1:
		return RelAvailable
	case 1:
		return RelAhead
	}
	return RelCurrent
}
