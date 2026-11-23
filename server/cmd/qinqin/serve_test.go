package main

import (
	"io"
	"net"
	"net/http"
	"testing"
	"time"
)

// The server bounds how long a client may take to send its headers and how
// long an idle keep-alive connection stays open, and sets no whole-request
// read or write deadline: uploads, downloads and the streamed legacy pull set
// their own (#170).
func TestNewHTTPServerTimeouts(t *testing.T) {
	srv := newHTTPServer(http.NotFoundHandler())
	if srv.ReadHeaderTimeout != 10*time.Second {
		t.Errorf("ReadHeaderTimeout = %v, want 10s", srv.ReadHeaderTimeout)
	}
	// Longer than Caddy's default 2-minute keep-alive towards upstreams, so
	// the proxy, not qinqin, closes an idle connection first.
	if srv.IdleTimeout != 125*time.Second {
		t.Errorf("IdleTimeout = %v, want 125s", srv.IdleTimeout)
	}
	if srv.ReadTimeout != 0 || srv.WriteTimeout != 0 {
		t.Errorf("ReadTimeout %v, WriteTimeout %v, want none", srv.ReadTimeout, srv.WriteTimeout)
	}
	if srv.Handler == nil {
		t.Error("no handler")
	}
}

// A connection that never finishes its headers is closed once the header
// timeout passes (shortened here; the real server uses newHTTPServer's).
func TestSlowHeaderConnectionIsClosed(t *testing.T) {
	srv := newHTTPServer(http.NotFoundHandler())
	srv.ReadHeaderTimeout = 200 * time.Millisecond
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go srv.Serve(ln)
	defer srv.Close()

	conn, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err := io.WriteString(conn, "GET / HTTP/1.1\r\nHost: x\r\n"); err != nil { // no final CRLF
		t.Fatal(err)
	}
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	start := time.Now()
	_, err = io.ReadAll(conn) // the server answers 408 or just closes; either ends the read
	if ne, ok := err.(net.Error); ok && ne.Timeout() {
		t.Fatalf("connection still open after %v", time.Since(start))
	}
	if d := time.Since(start); d > 3*time.Second {
		t.Fatalf("closed only after %v", d)
	}
}
