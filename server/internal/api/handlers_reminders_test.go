package api_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/reminders"
	"qinqin/internal/webpush"
)

type pushSpy struct {
	mu   sync.Mutex
	sent []string
}

func (p *pushSpy) Send(_ context.Context, _ webpush.Subscription, payload []byte, _ webpush.Options) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sent = append(p.sent, string(payload))
	return nil
}

func reminderEnv(t *testing.T, o mailOpts) (*mailEnv, *pushSpy, int64) {
	t.Helper()
	spy := &pushSpy{}
	o.apiOpts = append(o.apiOpts, api.WithPushSender(spy))
	e := newMailEnv(t, o)
	if _, err := e.db.Exec(`UPDATE users SET email = 'owner@example.org', email_norm = 'owner@example.org', email_verified_at = '2026-11-01T00:00:00Z' WHERE username = 'owner'`); err != nil {
		t.Fatal(err)
	}
	var ws int64
	r := doJSON(t, "GET", e.ts.URL, "/api/workspaces", e.owner, nil)
	var list []struct {
		ID int64 `json:"id"`
	}
	json.NewDecoder(r.Body).Decode(&list)
	if len(list) == 0 {
		r := doJSON(t, "POST", e.ts.URL, "/api/workspaces", e.owner, map[string]any{"name": "zh", "language": "zh"})
		var w struct {
			ID int64 `json:"id"`
		}
		json.NewDecoder(r.Body).Decode(&w)
		ws = w.ID
	} else {
		ws = list[0].ID
	}
	if ws == 0 {
		t.Fatal("no workspace")
	}
	return e, spy, ws
}

func rbody(t *testing.T, r *http.Response) string {
	t.Helper()
	b, _ := io.ReadAll(r.Body)
	r.Body.Close()
	return string(b)
}

func rcode(t *testing.T, r *http.Response) string {
	t.Helper()
	var e struct {
		Error string `json:"error"`
	}
	json.Unmarshal([]byte(rbody(t, r)), &e)
	return e.Error
}

func b64u(n int, first byte) string {
	b := make([]byte, n)
	b[0] = first
	return base64.RawURLEncoding.EncodeToString(b)
}

func TestFactsAndPlanRoute(t *testing.T) {
	e, _, ws := reminderEnv(t, mailOpts{configure: true})
	e.clk.t = time.Date(2026, 11, 25, 10, 0, 0, 0, time.UTC)
	doJSON(t, "PUT", e.ts.URL, "/api/me/time-zone", e.owner, map[string]any{"zone": "Europe/Berlin"})
	if r := doJSON(t, "PUT", e.ts.URL, "/api/rows/reminders", e.owner, map[string]any{"version": 1, "enabled": true, "times": []string{"18:00"}, "channels": map[string]any{"device": true}}); r.StatusCode != 200 {
		t.Fatalf("settings row: %d %s", r.StatusCode, rbody(t, r))
	}
	facts := map[string]any{"workspace": ws, "asOf": "2026-11-25T10:00:00Z", "dueNow": 12,
		"dueBuckets": []map[string]any{{"at": "2026-11-25T16:00:00Z", "count": 3}},
		"goal":       map[string]any{"set": true, "status": "open"}, "streak": map[string]any{"current": 5, "todayMet": false}, "vacation": []string{}}
	if r := doJSON(t, "PUT", e.ts.URL, "/api/reminders/facts", e.owner, facts); r.StatusCode != 204 {
		t.Fatalf("facts: %d %s", r.StatusCode, rbody(t, r))
	}
	r := doJSON(t, "GET", e.ts.URL, "/api/reminders/plan?days=1", e.owner, nil)
	if r.StatusCode != 200 || r.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("plan: %d %v", r.StatusCode, r.Header)
	}
	var got struct {
		Zone      string `json:"zone"`
		Enabled   bool   `json:"enabled"`
		Available struct{ Email, Push bool }
		Channels  struct{ Device bool }
		Slots     []struct {
			ID    int    `json:"id"`
			Kind  string `json:"kind"`
			At    string `json:"at"`
			Local string `json:"local"`
			Day   string `json:"day"`
			Count *int   `json:"count"`
		}
	}
	if err := json.Unmarshal([]byte(rbody(t, r)), &got); err != nil {
		t.Fatal(err)
	}
	if got.Zone != "Europe/Berlin" || !got.Enabled || !got.Channels.Device || !got.Available.Email || !got.Available.Push || len(got.Slots) != 3 {
		t.Fatalf("%+v", got)
	}
	if s := got.Slots[0]; s.Kind != "due" || s.At != "2026-11-25T17:00:00Z" || s.Local != "2026-11-25T18:00" || s.Day != "2026-11-25" || *s.Count != 15 || s.ID != 207821 {
		t.Fatalf("first slot %+v", s)
	}
	if rcode(t, doJSON(t, "GET", e.ts.URL, "/api/reminders/plan?days=99", e.owner, nil)) != "bad_request" {
		t.Error("days out of range")
	}
	// Refusals.
	for name, f := range map[string]map[string]any{
		"another workspace": {"workspace": ws + 999, "asOf": "2026-11-25T10:00:00Z"},
		"negative count":    {"workspace": ws, "dueNow": -1},
	} {
		r := doJSON(t, "PUT", e.ts.URL, "/api/reminders/facts", e.owner, f)
		if r.StatusCode < 400 {
			t.Errorf("%s: %d", name, r.StatusCode)
		}
	}
	if r := doJSON(t, "PUT", e.ts.URL, "/api/reminders/facts", "", facts); r.StatusCode != 401 {
		t.Errorf("anonymous: %d", r.StatusCode)
	}
	// No settings: an empty plan, off.
	other := registerUser(t, e.ts.URL, "bob", e.owner)
	r = doJSON(t, "GET", e.ts.URL, "/api/reminders/plan", other, nil)
	var empty struct {
		Enabled bool
		Slots   []any
	}
	json.Unmarshal([]byte(rbody(t, r)), &empty)
	if empty.Enabled || empty.Slots == nil || len(empty.Slots) != 0 {
		t.Fatalf("a fresh account: %+v", empty)
	}
}

func TestPushRoutes(t *testing.T) {
	e, _, _ := reminderEnv(t, mailOpts{})
	r := doJSON(t, "GET", e.ts.URL, "/api/push/vapid-key", e.owner, nil)
	var k struct {
		PublicKey string `json:"publicKey"`
	}
	json.Unmarshal([]byte(rbody(t, r)), &k)
	if raw, _ := base64.RawURLEncoding.DecodeString(k.PublicKey); len(raw) != 65 {
		t.Fatalf("key %q", k.PublicKey)
	}
	r = doJSON(t, "GET", e.ts.URL, "/api/push/vapid-key", e.owner, nil)
	var k2 struct {
		PublicKey string `json:"publicKey"`
	}
	json.Unmarshal([]byte(rbody(t, r)), &k2)
	if k2 != k {
		t.Fatal("the key must be stable across calls")
	}
	sub := func(endpoint string) map[string]any {
		return map[string]any{"endpoint": endpoint, "keys": map[string]any{"p256dh": b64u(65, 4), "auth": b64u(16, 1)}, "label": "Firefox on Linux"}
	}
	r = doJSON(t, "POST", e.ts.URL, "/api/push/subscriptions", e.owner, sub("https://push.example.com/a"))
	var created struct {
		ID int64 `json:"id"`
	}
	json.Unmarshal([]byte(rbody(t, r)), &created)
	if r.StatusCode != 201 || created.ID == 0 {
		t.Fatalf("subscribe: %d", r.StatusCode)
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/push/subscriptions", e.owner, sub("https://push.example.com/a")); r.StatusCode != 200 {
		t.Errorf("same endpoint again: %d", r.StatusCode)
	}
	bad := []map[string]any{sub("http://push.example.com/a"), sub("https://u:p@push.example.com/a"), sub(""), sub("javascript:alert(1)"),
		{"endpoint": "https://push.example.com/b", "keys": map[string]any{"p256dh": "AAAA", "auth": b64u(16, 1)}},
		{"endpoint": "https://push.example.com/b", "keys": map[string]any{"p256dh": b64u(65, 4), "auth": "AA"}}}
	for i, b := range bad {
		if r := doJSON(t, "POST", e.ts.URL, "/api/push/subscriptions", e.owner, b); r.StatusCode != 400 {
			t.Errorf("bad %d: %d", i, r.StatusCode)
		}
	}
	r = doJSON(t, "GET", e.ts.URL, "/api/push/subscriptions", e.owner, nil)
	text := rbody(t, r)
	if strings.Contains(text, "push.example.com") || strings.Contains(text, "p256dh") || !strings.Contains(text, "Firefox on Linux") {
		t.Fatalf("list leaks or lacks: %s", text)
	}
	other := registerUser(t, e.ts.URL, "bob", e.owner)
	if r := doJSON(t, "DELETE", e.ts.URL, "/api/push/subscriptions/"+ritoa(created.ID), other, nil); r.StatusCode != 404 {
		t.Errorf("foreign delete: %d", r.StatusCode)
	}
	if r := doJSON(t, "DELETE", e.ts.URL, "/api/push/subscriptions/"+ritoa(created.ID), e.owner, nil); r.StatusCode != 204 {
		t.Errorf("delete: %d", r.StatusCode)
	}
	for i := 0; i < reminders.MaxSubscriptions; i++ {
		doJSON(t, "POST", e.ts.URL, "/api/push/subscriptions", e.owner, sub("https://push.example.com/n"+ritoa(int64(i))))
	}
	if c := rcode(t, doJSON(t, "POST", e.ts.URL, "/api/push/subscriptions", e.owner, sub("https://push.example.com/over"))); c != "too_many_subscriptions" {
		t.Errorf("cap: %s", c)
	}
}

func ritoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

func TestPushNeedsASecret(t *testing.T) {
	e, _, _ := reminderEnv(t, mailOpts{noSecret: true})
	r := doJSON(t, "GET", e.ts.URL, "/api/push/vapid-key", e.owner, nil)
	if r.StatusCode != 503 || rcode(t, r) != "push_unavailable" {
		t.Fatalf("%d", r.StatusCode)
	}
}

func TestReminderTestRoute(t *testing.T) {
	e, spy, _ := reminderEnv(t, mailOpts{configure: true})
	post := func(ch string) *http.Response {
		return doJSON(t, "POST", e.ts.URL, "/api/reminders/test", e.owner, map[string]any{"channel": ch})
	}
	if c := rcode(t, post("push")); c != "no_subscription" {
		t.Fatalf("push without a device: %s", c)
	}
	if c := rcode(t, post("sms")); c != "bad_request" {
		t.Fatalf("unknown channel: %s", c)
	}
	doJSON(t, "POST", e.ts.URL, "/api/push/subscriptions", e.owner, map[string]any{"endpoint": "https://push.example.com/a", "keys": map[string]any{"p256dh": b64u(65, 4), "auth": b64u(16, 1)}})
	if r := post("push"); r.StatusCode != 204 {
		t.Fatalf("push test: %d", r.StatusCode)
	}
	if len(spy.sent) != 1 || !strings.Contains(spy.sent[0], `"kind":"test"`) {
		t.Fatalf("payload %v", spy.sent)
	}
	if r := post("email"); r.StatusCode != 429 || r.Header.Get("Retry-After") == "" {
		t.Fatalf("a second test within a minute: %d", r.StatusCode)
	}
	e.clk.advance(2 * time.Minute)
	if r := post("email"); r.StatusCode != 204 {
		t.Fatalf("email test: %d", r.StatusCode)
	}
	got := e.smtp.Messages()
	if len(got) != 1 || got[0].To[0] != "owner@example.org" || !strings.Contains(got[0].Data, "List-Unsubscribe-Post: List-Unsubscribe=One-Click") {
		t.Fatalf("mail %+v", got)
	}
	e.db.Exec(`UPDATE users SET email_verified_at = NULL`)
	e.clk.advance(2 * time.Minute)
	if c := rcode(t, post("email")); c != "email_unverified" {
		t.Fatalf("unverified: %s", c)
	}
}

func TestUnsubscribeLink(t *testing.T) {
	e, _, _ := reminderEnv(t, mailOpts{})
	var id int64
	e.db.QueryRow(`SELECT id FROM users WHERE username = 'owner'`).Scan(&id)
	tok := reminders.UnsubscribeToken(testSealer(), id)
	doJSON(t, "PUT", e.ts.URL, "/api/rows/reminders", e.owner, map[string]any{"version": 1, "enabled": true, "channels": map[string]any{"email": true}})
	read := func() bool {
		r := doJSON(t, "GET", e.ts.URL, "/api/rows/reminders", e.owner, nil)
		var row struct {
			Data struct {
				Channels struct{ Email bool }
			}
		}
		json.Unmarshal([]byte(rbody(t, r)), &row)
		return row.Data.Channels.Email
	}
	// GET shows a page and changes nothing; no session is needed.
	r := doJSON(t, "GET", e.ts.URL, "/api/reminders/unsubscribe?t="+tok, "", nil)
	page := rbody(t, r)
	if r.StatusCode != 200 || !strings.Contains(r.Header.Get("Content-Type"), "text/html") || !strings.Contains(page, "<form") || !read() {
		t.Fatalf("GET: %d email=%v\n%s", r.StatusCode, read(), page)
	}
	if !strings.Contains(r.Header.Get("Content-Security-Policy"), "default-src 'none'") {
		t.Error("no CSP")
	}
	r = doJSON(t, "POST", e.ts.URL, "/api/reminders/unsubscribe?t="+tok, "", nil)
	if r.StatusCode != 200 || read() {
		t.Fatalf("POST: %d email=%v", r.StatusCode, read())
	}
	if r := doJSON(t, "POST", e.ts.URL, "/api/reminders/unsubscribe?t="+tok, "", nil); r.StatusCode != 200 {
		t.Errorf("idempotent: %d", r.StatusCode)
	}
	for _, bad := range []string{"", "v1.1.AAAA", strings.Replace(tok, ".1.", ".2.", 1)} {
		if r := doJSON(t, "POST", e.ts.URL, "/api/reminders/unsubscribe?t="+bad, "", nil); r.StatusCode != 400 {
			t.Errorf("bad token %q: %d", bad, r.StatusCode)
		}
	}
}
