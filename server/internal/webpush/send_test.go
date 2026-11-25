package webpush

import (
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qinqin/internal/netguard"
)

func testKeys(t *testing.T) (*VAPID, *ecdh.PrivateKey, []byte) {
	t.Helper()
	v, err := NewVAPID()
	if err != nil {
		t.Fatal(err)
	}
	ua, _ := ecdh.P256().GenerateKey(randReader())
	return v, ua, make([]byte, 16)
}

func TestVAPIDRoundTripAndHeader(t *testing.T) {
	v, _, _ := testKeys(t)
	again, err := ParseVAPID(v.PrivateBytes())
	if err != nil || again.PublicKey() != v.PublicKey() {
		t.Fatalf("parse: %v", err)
	}
	if got, _ := base64.RawURLEncoding.DecodeString(v.PublicKey()); len(got) != 65 || got[0] != 4 {
		t.Fatalf("public key is not an uncompressed P-256 point: %d bytes", len(got))
	}
	now := time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC)
	h, err := v.Authorization("https://push.example.com/send/abc", "https://example.org", now)
	if err != nil {
		t.Fatal(err)
	}
	rest, ok := strings.CutPrefix(h, "vapid t=")
	if !ok {
		t.Fatalf("header %q", h)
	}
	jwt, k, _ := strings.Cut(rest, ", k=")
	if k != v.PublicKey() {
		t.Fatalf("k = %q", k)
	}
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		t.Fatal(jwt)
	}
	claims, _ := base64.RawURLEncoding.DecodeString(parts[1])
	var c struct {
		Aud string `json:"aud"`
		Exp int64  `json:"exp"`
		Sub string `json:"sub"`
	}
	if err := json.Unmarshal(claims, &c); err != nil || c.Aud != "https://push.example.com" || c.Sub != "https://example.org" || c.Exp != now.Add(12*time.Hour).Unix() {
		t.Fatalf("claims %s (%v)", claims, err)
	}
	sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
	if len(sig) != 64 {
		t.Fatalf("signature is %d bytes, want 64 (r||s)", len(sig))
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if !ecdsa.Verify(&v.key.PublicKey, digest[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		t.Fatal("signature does not verify")
	}
}

func TestSendDeliversAndClassifies(t *testing.T) {
	v, ua, auth := testKeys(t)
	var gotHeaders http.Header
	var gotBody []byte
	status := 201
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeaders = r.Header.Clone()
		buf := make([]byte, 8192)
		n, _ := r.Body.Read(buf)
		gotBody = buf[:n]
		w.WriteHeader(status)
	}))
	defer srv.Close()
	s := &Sender{VAPID: v, Subject: "https://example.org", Client: srv.Client(), Now: func() time.Time { return time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC) }}
	sub := Subscription{Endpoint: srv.URL + "/push/1", P256dh: ua.PublicKey().Bytes(), Auth: auth}

	if err := s.Send(context.Background(), sub, []byte(`{"v":1,"kind":"due","count":3,"route":"/study"}`), Options{TTL: 12 * time.Hour, Urgency: "low"}); err != nil {
		t.Fatal(err)
	}
	if gotHeaders.Get("Content-Encoding") != "aes128gcm" || gotHeaders.Get("TTL") != "43200" || gotHeaders.Get("Urgency") != "low" || !strings.HasPrefix(gotHeaders.Get("Authorization"), "vapid t=") {
		t.Fatalf("headers %v", gotHeaders)
	}
	plain, err := decrypt(gotBody, ua, auth)
	if err != nil || !strings.Contains(string(plain), `"kind":"due"`) {
		t.Fatalf("payload %q %v", plain, err)
	}
	for _, c := range []struct {
		status int
		gone   bool
	}{{404, true}, {410, true}, {429, false}, {500, false}, {400, false}} {
		status = c.status
		err := s.Send(context.Background(), sub, []byte("x"), Options{})
		var se *SendError
		if !errors.As(err, &se) || se.Status != c.status || errors.Is(err, ErrGone) != c.gone {
			t.Errorf("status %d: %v", c.status, err)
		}
	}
}

func TestSendRefusesUnsafeEndpoints(t *testing.T) {
	v, ua, auth := testKeys(t)
	s := &Sender{VAPID: v, Subject: "https://example.org", Policy: netguard.GuardPolicy{}}
	for _, ep := range []string{"http://push.example.com/x", "https://127.0.0.1/x", "https://user:pw@push.example.com/x", "https://localhost/x", "ftp://x/y", "https://10.0.0.1/x"} {
		err := s.Send(context.Background(), Subscription{Endpoint: ep, P256dh: ua.PublicKey().Bytes(), Auth: auth}, []byte("x"), Options{})
		if err == nil {
			t.Errorf("%s: accepted", ep)
		}
	}
}

func TestValidEndpoint(t *testing.T) {
	ok := []string{"https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/xyz"}
	bad := []string{"", "http://a.example/x", "https://a.example:99999/x", "https://u:p@a.example/x", "https:///x", "javascript:alert(1)", strings.Repeat("https://a.example/", 200)}
	for _, e := range ok {
		if !ValidEndpoint(e) {
			t.Errorf("%q refused", e)
		}
	}
	for _, e := range bad {
		if ValidEndpoint(e) {
			t.Errorf("%q accepted", e)
		}
	}
}
