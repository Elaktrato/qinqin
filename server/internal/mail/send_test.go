package mail

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"qinqin/internal/mail/mailtest"
	"qinqin/internal/netguard"
)

var private = netguard.GuardPolicy{AllowPrivate: true}

func transport(s *mailtest.Server, mode Mode) Transport {
	return Transport{Host: s.Host, Port: s.Port, TLS: mode, Policy: private, RootCAs: s.RootCAs(), Timeout: 5 * time.Second}
}

func raw(t *testing.T) []byte {
	b, err := Compose(Sender{Address: "q@example.org"}, Message{To: "bob@example.com", Subject: "s", Body: "hello\n.dot line\n"}, fixedNow, fixedRnd())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func start(t *testing.T, o mailtest.Options) *mailtest.Server {
	s, err := mailtest.New(o)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

func category(t *testing.T, err error) *SendError {
	t.Helper()
	var se *SendError
	if !errors.As(err, &se) {
		t.Fatalf("error %v is not a SendError", err)
	}
	return se
}

func TestSendStartTLS(t *testing.T) {
	s := start(t, mailtest.Options{User: "u", Pass: "pw-sentinel"})
	tr := transport(s, ModeStartTLS)
	tr.Username, tr.Password = "u", "pw-sentinel"
	if err := tr.Send(context.Background(), "q@example.org", "bob@example.com", raw(t)); err != nil {
		t.Fatal(err)
	}
	m := s.Messages()
	if len(m) != 1 || m[0].From != "q@example.org" || m[0].To[0] != "bob@example.com" || !strings.Contains(m[0].Data, "\r\n.dot line\r\n") {
		t.Fatalf("messages = %+v", m)
	}
	if got := s.AuthUsed(); len(got) != 1 || got[0] != "PLAIN" {
		t.Errorf("auth = %v", got)
	}
}

func TestSendStartTLSNotOfferedIsATLSError(t *testing.T) {
	s := start(t, mailtest.Options{NoSTARTTLS: true})
	err := transport(s, ModeStartTLS).Send(context.Background(), "q@example.org", "bob@example.com", raw(t))
	if se := category(t, err); se.Category != CatTLS {
		t.Fatalf("category = %s", se.Category)
	}
	if len(s.Messages()) != 0 {
		t.Fatal("a message was delivered without TLS")
	}
}

func TestSendImplicitTLS(t *testing.T) {
	s := start(t, mailtest.Options{ImplicitTLS: true, User: "u", Pass: "p", AuthMechs: "LOGIN"})
	tr := transport(s, ModeTLS)
	tr.Username, tr.Password = "u", "p"
	if err := tr.Send(context.Background(), "q@example.org", "bob@example.com", raw(t)); err != nil {
		t.Fatal(err)
	}
	if got := s.AuthUsed(); len(got) != 1 || got[0] != "LOGIN" {
		t.Errorf("auth = %v (LOGIN is the fallback when PLAIN is not offered)", got)
	}
	if len(s.Messages()) != 1 {
		t.Fatal("no message")
	}
}

func TestSendWrongCertificateName(t *testing.T) {
	for _, mode := range []Mode{ModeStartTLS, ModeTLS} {
		s := start(t, mailtest.Options{ImplicitTLS: mode == ModeTLS, CertNames: []string{"other.example"}})
		err := transport(s, mode).Send(context.Background(), "q@example.org", "bob@example.com", raw(t))
		if se := category(t, err); se.Category != CatTLS {
			t.Errorf("%s: category = %s", mode, se.Category)
		}
		if len(s.Messages()) != 0 {
			t.Errorf("%s: delivered", mode)
		}
	}
}

func TestSendBadCredentials(t *testing.T) {
	s := start(t, mailtest.Options{User: "u", Pass: "right-pass-sentinel"})
	tr := transport(s, ModeStartTLS)
	tr.Username, tr.Password = "u", "wrong-pass-sentinel"
	err := tr.Send(context.Background(), "q@example.org", "bob@example.com", raw(t))
	se := category(t, err)
	if se.Category != CatAuth || se.Code != 535 {
		t.Fatalf("got %+v", se)
	}
	for _, secret := range []string{"wrong-pass-sentinel", "right-pass-sentinel"} {
		if strings.Contains(err.Error(), secret) {
			t.Errorf("error text holds the password: %v", err)
		}
	}
}

func TestSendNoneWithCredentialsRefusedBeforeDialing(t *testing.T) {
	s := start(t, mailtest.Options{})
	tr := transport(s, ModeNone)
	tr.Username, tr.Password = "u", "p"
	err := tr.Send(context.Background(), "q@example.org", "bob@example.com", raw(t))
	if category(t, err).Category != CatProtocol {
		t.Fatalf("err = %v", err)
	}
	if s.Connections() != 0 {
		t.Fatal("the transport connected although credentials would travel in clear text")
	}
	// mode none without credentials works
	if err := transport(s, ModeNone).Send(context.Background(), "q@example.org", "bob@example.com", raw(t)); err != nil {
		t.Fatal(err)
	}
}

func TestSendRejections(t *testing.T) {
	s := start(t, mailtest.Options{RejectRcpt: true})
	se := category(t, transport(s, ModeStartTLS).Send(context.Background(), "q@example.org", "bob@example.com", raw(t)))
	if se.Category != CatRecipient || se.Code != 550 {
		t.Fatalf("got %+v", se)
	}
	s2 := start(t, mailtest.Options{RejectFrom: true})
	se = category(t, transport(s2, ModeStartTLS).Send(context.Background(), "q@example.org", "bob@example.com", raw(t)))
	if se.Category != CatSender || se.Code != 553 {
		t.Fatalf("got %+v", se)
	}
}

func TestSendStallTimesOut(t *testing.T) {
	s := start(t, mailtest.Options{Stall: true})
	tr := transport(s, ModeStartTLS)
	tr.Timeout = 300 * time.Millisecond
	begin := time.Now()
	se := category(t, tr.Send(context.Background(), "q@example.org", "bob@example.com", raw(t)))
	if se.Category != CatTimeout {
		t.Fatalf("got %+v", se)
	}
	if time.Since(begin) > 3*time.Second {
		t.Fatalf("took %v", time.Since(begin))
	}
}

func TestSendBlockedWithoutConnecting(t *testing.T) {
	s := start(t, mailtest.Options{})
	tr := transport(s, ModeStartTLS)
	tr.Policy = netguard.GuardPolicy{} // loopback refused
	se := category(t, tr.Send(context.Background(), "q@example.org", "bob@example.com", raw(t)))
	if se.Category != CatBlocked {
		t.Fatalf("got %+v", se)
	}
	if s.Connections() != 0 {
		t.Fatal("the fake server saw a connection")
	}
	tr.Host = "169.254.169.254" // metadata is blocked even when private is allowed
	tr.Policy = private
	if se := category(t, tr.Send(context.Background(), "q@example.org", "bob@example.com", raw(t))); se.Category != CatBlocked {
		t.Fatalf("metadata: %+v", se)
	}
}

func TestSendRefusesBadAddressesAndNeverEchoesReplyText(t *testing.T) {
	s := start(t, mailtest.Options{RejectRcpt: true, GreetingText: "internal-host.corp secret banner"})
	tr := transport(s, ModeStartTLS)
	if se := category(t, tr.Send(context.Background(), "q@example.org", "bob@example.com\r\nRCPT TO:<evil@x.y>", raw(t))); se.Category != CatRecipient || se.Code != 0 {
		t.Errorf("injected recipient: %+v", se)
	}
	err := tr.Send(context.Background(), "q@example.org", "bob@example.com", raw(t))
	for _, leak := range vars() {
		if strings.Contains(err.Error(), leak) {
			t.Errorf("error leaks %q: %v", leak, err)
		}
	}
	if s.Connections() != 1 {
		t.Errorf("connections = %d", s.Connections())
	}
}

func vars() []string { return []string{"internal-host", "no such user", "banner"} }
