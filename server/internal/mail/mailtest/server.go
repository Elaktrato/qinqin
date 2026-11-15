// Package mailtest is a small in-process SMTP server for tests: EHLO,
// STARTTLS, implicit TLS, AUTH PLAIN/LOGIN, MAIL, RCPT, DATA, RSET, QUIT, with
// switches for the failure modes the transport must classify.
package mailtest

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"fmt"
	"math/big"
	"net"
	"strings"
	"sync"
	"time"
)

// Received is one accepted message.
type Received struct {
	From string
	To   []string
	Data string
}

// Options select the behaviour.
type Options struct {
	NoSTARTTLS   bool   // do not offer STARTTLS
	ImplicitTLS  bool   // TLS from the first byte
	AuthMechs    string // advertised mechanisms, default "PLAIN LOGIN"
	User, Pass   string // accepted credentials; empty User = no AUTH offered
	RejectAuth   bool   // answer 535 to every login
	RejectRcpt   bool   // answer 550 to RCPT
	RejectFrom   bool   // answer 553 to MAIL FROM
	Stall        bool   // accept the connection, say nothing
	CertNames    []string
	CertIPs      []net.IP
	GreetingText string
}

// Server is a running fake server.
type Server struct {
	Addr string
	Host string
	Port int
	opt  Options
	ln   net.Listener
	cert tls.Certificate
	pool *x509.CertPool

	mu    sync.Mutex
	conns int
	msgs  []Received
	auths []string // mechanisms used, for assertions
	wg    sync.WaitGroup
	done  chan struct{}
}

// New starts a server on 127.0.0.1 and stops it with Close.
func New(opt Options) (*Server, error) {
	if opt.AuthMechs == "" {
		opt.AuthMechs = "PLAIN LOGIN"
	}
	if len(opt.CertNames) == 0 && len(opt.CertIPs) == 0 {
		opt.CertNames = []string{"localhost"}
		opt.CertIPs = []net.IP{net.ParseIP("127.0.0.1")}
	}
	cert, pool, err := selfSigned(opt.CertNames, opt.CertIPs)
	if err != nil {
		return nil, err
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	s := &Server{Addr: ln.Addr().String(), opt: opt, ln: ln, cert: cert, pool: pool, done: make(chan struct{})}
	s.Host, _, _ = net.SplitHostPort(s.Addr)
	fmt.Sscanf(s.Addr[strings.LastIndex(s.Addr, ":")+1:], "%d", &s.Port)
	s.wg.Add(1)
	go s.accept()
	return s, nil
}

// RootCAs trusts the server's certificate.
func (s *Server) RootCAs() *x509.CertPool { return s.pool }

// Close stops the server and waits for its connections.
func (s *Server) Close() {
	close(s.done)
	s.ln.Close()
	s.wg.Wait()
}

// Connections is the number of TCP connections accepted so far.
func (s *Server) Connections() int { s.mu.Lock(); defer s.mu.Unlock(); return s.conns }

// Messages returns the accepted messages.
func (s *Server) Messages() []Received {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Received(nil), s.msgs...)
}

// AuthUsed returns the AUTH mechanisms clients used, in order.
func (s *Server) AuthUsed() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.auths...)
}

func selfSigned(names []string, ips []net.IP) (tls.Certificate, *x509.CertPool, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: "mailtest"},
		NotBefore:    time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage:    x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:    names, IPAddresses: ips,
		BasicConstraintsValid: true, IsCA: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	leaf, _ := x509.ParseCertificate(der)
	pool := x509.NewCertPool()
	pool.AddCert(leaf)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}, pool, nil
}

func (s *Server) accept() {
	defer s.wg.Done()
	for {
		c, err := s.ln.Accept()
		if err != nil {
			return
		}
		s.mu.Lock()
		s.conns++
		s.mu.Unlock()
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			defer c.Close()
			s.serve(c)
		}()
	}
}

func (s *Server) serve(c net.Conn) {
	c.SetDeadline(time.Now().Add(20 * time.Second))
	if s.opt.Stall {
		<-s.done
		return
	}
	cfg := &tls.Config{Certificates: []tls.Certificate{s.cert}, MinVersion: tls.VersionTLS12}
	if s.opt.ImplicitTLS {
		c = tls.Server(c, cfg)
	}
	r := bufio.NewReader(c)
	w := func(format string, a ...any) { fmt.Fprintf(c, format+"\r\n", a...) }
	greet := s.opt.GreetingText
	if greet == "" {
		greet = "mailtest ready"
	}
	w("220 %s", greet)
	secure := s.opt.ImplicitTLS
	authed := false
	var from string
	var to []string
	readLine := func() (string, bool) {
		l, err := r.ReadString('\n')
		return strings.TrimRight(l, "\r\n"), err == nil
	}
	for {
		line, ok := readLine()
		if !ok {
			return
		}
		verb := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(verb, "EHLO"), strings.HasPrefix(verb, "HELO"):
			w("250-mailtest")
			if !secure && !s.opt.NoSTARTTLS && !s.opt.ImplicitTLS {
				w("250-STARTTLS")
			}
			if s.opt.User != "" || s.opt.RejectAuth {
				w("250-AUTH %s", s.opt.AuthMechs)
			}
			w("250 8BITMIME")
		case verb == "STARTTLS":
			if s.opt.NoSTARTTLS || secure {
				w("502 not offered")
				continue
			}
			w("220 go ahead")
			tc := tls.Server(c, cfg)
			if err := tc.Handshake(); err != nil {
				return
			}
			c = tc
			r = bufio.NewReader(c)
			secure = true
		case strings.HasPrefix(verb, "AUTH "):
			mech := strings.Fields(verb)[1]
			s.mu.Lock()
			s.auths = append(s.auths, mech)
			s.mu.Unlock()
			var user, pass string
			switch mech {
			case "PLAIN":
				arg := ""
				if f := strings.Fields(line); len(f) > 2 {
					arg = f[2]
				} else {
					w("334 ")
					arg, _ = readLine()
				}
				raw, _ := base64.StdEncoding.DecodeString(arg)
				parts := strings.Split(string(raw), "\x00")
				if len(parts) == 3 {
					user, pass = parts[1], parts[2]
				}
			case "LOGIN":
				w("334 %s", base64.StdEncoding.EncodeToString([]byte("Username:")))
				u, _ := readLine()
				ub, _ := base64.StdEncoding.DecodeString(u)
				w("334 %s", base64.StdEncoding.EncodeToString([]byte("Password:")))
				p, _ := readLine()
				pb, _ := base64.StdEncoding.DecodeString(p)
				user, pass = string(ub), string(pb)
			default:
				w("504 mechanism not supported")
				continue
			}
			if s.opt.RejectAuth || user != s.opt.User || pass != s.opt.Pass {
				w("535 5.7.8 authentication failed")
				continue
			}
			authed = true
			w("235 ok")
		case strings.HasPrefix(verb, "MAIL FROM:"):
			if s.opt.User != "" && !authed {
				w("530 authentication required")
				continue
			}
			if s.opt.RejectFrom {
				w("553 sender refused")
				continue
			}
			from = between(line)
			to = nil
			w("250 ok")
		case strings.HasPrefix(verb, "RCPT TO:"):
			if s.opt.RejectRcpt {
				w("550 5.1.1 no such user")
				continue
			}
			to = append(to, between(line))
			w("250 ok")
		case verb == "DATA":
			w("354 end with <CRLF>.<CRLF>")
			var b strings.Builder
			for {
				l, ok := readLine()
				if !ok {
					return
				}
				if l == "." {
					break
				}
				b.WriteString(strings.TrimPrefix(l, ".") + "\r\n")
			}
			s.mu.Lock()
			s.msgs = append(s.msgs, Received{From: from, To: to, Data: b.String()})
			s.mu.Unlock()
			w("250 queued")
		case verb == "RSET":
			from, to = "", nil
			w("250 ok")
		case verb == "NOOP":
			w("250 ok")
		case verb == "QUIT":
			w("221 bye")
			return
		default:
			w("500 unknown command")
		}
	}
}

func between(line string) string {
	i, j := strings.IndexByte(line, '<'), strings.IndexByte(line, '>')
	if i < 0 || j < i {
		return ""
	}
	return line[i+1 : j]
}
