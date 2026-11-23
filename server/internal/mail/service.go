package mail

import (
	"context"
	"crypto/rand"
	"crypto/x509"
	"errors"
	"log"
	"net"
	"sync"
	"time"

	"qinqin/internal/i18n"
	"qinqin/internal/netguard"
	"qinqin/internal/secretbox"
)

// Service is what the API holds: the settings store and (task 6) the queue.
// A nil *Service means mail is not available at all.
type Service struct {
	Store  *Store
	Secret secretbox.SecretState // state of QINQIN_SECRET, for the admin form
	Policy netguard.GuardPolicy

	Logf          func(string, ...any) // default log.Printf
	GlobalPerHour int                  // default 200
	Now           func() time.Time

	qs queueState

	// Tests only.
	RootCAs  *x509.CertPool
	Resolver *net.Resolver
	Timeout  time.Duration
}

// Configured reports whether mail can be sent. Safe on a nil Service.
func (s *Service) Configured(ctx context.Context) bool {
	return s != nil && s.Store != nil && s.Store.Configured(ctx)
}

// AllowPrivate tells the admin form whether private targets are allowed.
func (s *Service) AllowPrivate() bool { return s != nil && s.Policy.AllowPrivate }

func (s *Service) tune(t Transport) Transport {
	t.RootCAs, t.Resolver, t.Policy = s.RootCAs, s.Resolver, s.Policy
	if s.Timeout > 0 {
		t.Timeout = s.Timeout
	}
	return t
}

// TransportFor returns the transport of a prepared configuration.
func (s *Service) TransportFor(p *Prepared) Transport { return s.tune(p.Transport(s.Policy)) }

// Job is one mail to send. Build, when set, runs on the worker just before
// sending and supplies the template data (a reset link is created there, so
// the request that queued the job does the same database work for a known and
// an unknown account). It returns ok=false to skip the mail.
// AcceptLanguage is the triggering request's header: the worker picks the
// mail's language from the recipient's stored interface language, else
// this header, else en (Language). Enqueue keeps at most
// i18n.MaxAcceptLanguage bytes of it (the parser reads no more).
type Job struct {
	Kind           Kind
	UserID         int64
	To             string
	AcceptLanguage string
	Data           TemplateData
	Build          func(ctx context.Context, cfg Config) (TemplateData, bool)
}

const (
	queueSize     = 100
	globalPerHour = 200
)

// sentAt is one send for the hourly cap; anon marks mails an unauthenticated
// request can trigger (reset links, sign-in codes).
type sentAt struct {
	t    time.Time
	anon bool
}

type queueState struct {
	once sync.Once
	ch   chan Job
	mu   sync.Mutex
	sent []sentAt // sends within the last hour (global cap)
}

func (s *Service) q() *queueState {
	s.qs.once.Do(func() { s.qs.ch = make(chan Job, queueSize) })
	return &s.qs
}

func (s *Service) logf(format string, a ...any) {
	if s.Logf != nil {
		s.Logf(format, a...)
		return
	}
	log.Printf(format, a...)
}

func (s *Service) clock() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Enqueue hands j to the worker and returns at once; it never blocks the
// request. A full queue drops the mail (logged without any address) and
// returns false. Nothing is retried: the user can ask again.
func (s *Service) Enqueue(j Job) bool {
	if s == nil {
		return false
	}
	if len(j.AcceptLanguage) > i18n.MaxAcceptLanguage {
		j.AcceptLanguage = j.AcceptLanguage[:i18n.MaxAcceptLanguage]
	}
	select {
	case s.q().ch <- j:
		return true
	default:
		s.logf("mail: dropped kind=%s user=%d reason=queue_full", j.Kind, j.UserID)
		return false
	}
}

// language resolves a job's language on the worker, so the request that
// queued it does the same work for a known and an unknown account. A failed
// read counts as no setting.
func (s *Service) language(ctx context.Context, j Job) string {
	var setting string
	if j.UserID != 0 && s.Store != nil && s.Store.DB != nil {
		if err := s.Store.DB.QueryRowContext(ctx, `SELECT interface_language FROM users WHERE id = ?`, j.UserID).Scan(&setting); err != nil {
			setting = ""
		}
	}
	return Language(setting, j.AcceptLanguage)
}

func anonymousKind(k Kind) bool { return k == KindReset || k == KindLoginCode }

// underCap reports whether another mail may go out within the global hourly
// cap, and records it. Mails an anonymous request can trigger may use only
// three quarters of the cap, so no client can use up the allowance of the
// signed-in flows (verification, second-step codes, notices, test mail).
func (s *Service) underCap(kind Kind) bool {
	q := s.q()
	q.mu.Lock()
	defer q.mu.Unlock()
	now := s.clock()
	keep := q.sent[:0]
	anon := 0
	for _, e := range q.sent {
		if now.Sub(e.t) < time.Hour {
			keep = append(keep, e)
			if e.anon {
				anon++
			}
		}
	}
	q.sent = keep
	limit := s.GlobalPerHour
	if limit <= 0 {
		limit = globalPerHour
	}
	isAnon := anonymousKind(kind)
	if len(q.sent) >= limit || (isAnon && anon >= limit*3/4) {
		return false
	}
	q.sent = append(q.sent, sentAt{now, isAnon})
	return true
}

// Pending is the number of queued mails the worker has not taken yet; serve
// logs it when the worker stops at shutdown (the queue lives in memory).
func (s *Service) Pending() int {
	if s == nil {
		return 0
	}
	return len(s.q().ch)
}

// Run is the single worker: it sends queued mails one at a time until ctx
// ends. Run it in its own goroutine.
func (s *Service) Run(ctx context.Context) {
	q := s.q()
	for {
		select {
		case <-ctx.Done():
			return
		case j := <-q.ch:
			s.deliver(ctx, j)
		}
	}
}

func (s *Service) deliver(ctx context.Context, j Job) {
	if !s.underCap(j.Kind) {
		s.logf("mail: dropped kind=%s user=%d reason=hourly_cap", j.Kind, j.UserID)
		return
	}
	t, cfg, err := s.Store.Stored(ctx)
	if err != nil || cfg == nil {
		s.logf("mail: failed kind=%s user=%d category=unconfigured", j.Kind, j.UserID)
		return
	}
	data := j.Data
	if j.Build != nil {
		var ok bool
		if data, ok = j.Build(ctx, *cfg); !ok {
			return
		}
	}
	data.Site = cfg.Site()
	if data.Minutes == 0 {
		data.Minutes = 10
	}
	if data.Hours == 0 {
		data.Hours = 1
	}
	msg, err := Render(j.Kind, s.language(ctx, j), data)
	if err != nil {
		s.logf("mail: failed kind=%s user=%d category=template", j.Kind, j.UserID)
		return
	}
	msg.To = j.To
	raw, err := Compose(Sender{Address: cfg.FromAddress, Name: cfg.FromName}, msg, s.clock(), rand.Reader)
	if err != nil {
		s.logf("mail: failed kind=%s user=%d category=compose", j.Kind, j.UserID)
		return
	}
	if err := s.tune(t).Send(ctx, cfg.FromAddress, j.To, raw); err != nil {
		var se *SendError
		cat := "internal"
		if errors.As(err, &se) {
			cat = se.Category
		}
		s.logf("mail: failed kind=%s user=%d category=%s", j.Kind, j.UserID, cat)
		return
	}
	s.logf("mail: sent kind=%s user=%d", j.Kind, j.UserID)
}
