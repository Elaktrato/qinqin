package netguard

import (
	"context"
	"errors"
	"net"
	"testing"
)

func TestCheckHost(t *testing.T) {
	cases := []struct {
		host      string
		none, prv bool // allowed without / with AllowPrivate
	}{
		{"mail.example.org", true, true},
		{"smtp.example.org.", true, true},
		{"8.8.8.8", true, true},
		{"169.254.169.254", false, false}, // cloud metadata
		{"fd00:ec2::254", false, false},
		{"100.100.100.200", false, false},
		{"169.254.1.1", false, false}, // link-local
		{"fe80::1", false, false},
		{"0.0.0.0", false, false},
		{"224.0.0.1", false, false},
		{"::ffff:169.254.169.254", false, false}, // mapped metadata
		{"localhost", false, true},
		{"relay.localhost", false, true},
		{"127.0.0.1", false, true},
		{"::1", false, true},
		{"10.1.2.3", false, true},
		{"192.168.0.5", false, true},
		{"172.16.0.1", false, true},
		{"100.64.0.1", false, true},
		{"fd12::1", false, true},
		{"2130706433", false, false}, // numeric IPv4 form: refused as unparsable
		{"0x7f.1", false, false},
		{"", false, false},
	}
	for _, c := range cases {
		for _, pol := range []struct {
			p    GuardPolicy
			want bool
		}{{GuardPolicy{}, c.none}, {GuardPolicy{AllowPrivate: true}, c.prv}} {
			err := CheckHost(c.host, pol.p)
			if (err == nil) != pol.want {
				t.Errorf("CheckHost(%q, %+v) = %v, want ok=%v", c.host, pol.p, err, pol.want)
			}
			if err != nil && !errors.Is(err, ErrBlocked) {
				t.Errorf("error is not ErrBlocked: %v", err)
			}
		}
	}
}

func TestDialContextRefusesLoopbackWithoutConnecting(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	accepted := make(chan struct{}, 1)
	go func() {
		if c, err := l.Accept(); err == nil {
			accepted <- struct{}{}
			c.Close()
		}
	}()
	if _, err := DialContext(GuardPolicy{}, nil)(context.Background(), "tcp", l.Addr().String()); !errors.Is(err, ErrBlocked) {
		t.Fatalf("dial = %v, want ErrBlocked", err)
	}
	select {
	case <-accepted:
		t.Fatal("the listener saw a connection")
	default:
	}
	c, err := DialContext(GuardPolicy{AllowPrivate: true}, nil)(context.Background(), "tcp", l.Addr().String())
	if err != nil {
		t.Fatalf("allowed dial: %v", err)
	}
	c.Close()
}
