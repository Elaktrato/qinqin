package mail

import (
	"context"
	"crypto/x509"
	"net"
	"time"

	"qinqin/internal/netguard"
	"qinqin/internal/secretbox"
)

// Service is what the API holds: the settings store and (task 6) the queue.
// A nil *Service means mail is not available at all.
type Service struct {
	Store  *Store
	Secret secretbox.SecretState // state of QINQIN_SECRET, for the admin form
	Policy netguard.GuardPolicy

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
