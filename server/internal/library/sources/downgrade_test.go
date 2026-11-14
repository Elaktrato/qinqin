package sources

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPClientRefusesHTTPSToHTTPRedirect(t *testing.T) {
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "secret") }))
	defer plain.Close()
	secure := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, plain.URL, http.StatusFound)
	}))
	defer secure.Close()

	c := NewHTTPClient(t.TempDir(), "ua")
	c.AllowPrivate = true
	c.transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} // httptest certificate
	_, err := c.Get(context.Background(), secure.URL, 100, 0)
	if !errors.Is(err, ErrBlocked) {
		t.Fatalf("err = %v, want ErrBlocked", err)
	}
	// http to http is still fine
	if b, err := c.Get(context.Background(), plain.URL, 100, 0); err != nil || string(b) != "secret" {
		t.Fatalf("plain get: %q %v", b, err)
	}
}
