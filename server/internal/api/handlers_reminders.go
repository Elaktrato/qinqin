package api

import (
	"encoding/base64"
	"errors"
	"fmt"
	"html"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"qinqin/internal/i18n"
	"qinqin/internal/mail"
	"qinqin/internal/netguard"
	"qinqin/internal/reminders"
	"qinqin/internal/studyday"
	"qinqin/internal/webpush"
)

// Body caps of the reminder routes (docs/contracts/reminders/).
const (
	maxFactsBody        = 16 << 10
	maxSubscriptionBody = 4 << 10
	maxTestBody         = 1 << 10
	testEvery           = time.Minute
)

// pushSetup is how the server sends web push (WithPush).
type pushSetup struct {
	subject string
	policy  netguard.GuardPolicy
	sender  reminders.PushSender // tests only
}

// WithPush configures web push: the VAPID subject (a mailto: or https URL the
// push services may contact; empty: the project URL) and the network policy
// for the push endpoints.
func WithPush(subject string, policy netguard.GuardPolicy) Option {
	return func(s *server) { s.push = &pushSetup{subject: subject, policy: policy} }
}

// pushProvider is the server's web push sender source (nil without a secret).
func (s *server) pushProvider() *reminders.PushProvider {
	p := &reminders.PushProvider{DB: s.db, Cur: s.sealCur, Prev: s.sealPrev, Now: s.now}
	if s.push != nil {
		p.Subject, p.Policy, p.Sender = s.push.subject, s.push.policy, s.push.sender
	}
	return p
}

// handlePutFacts serves PUT /api/reminders/facts: the client's derived study
// snapshot of one workspace (reminders/ contract, "Facts").
func (s *server) handlePutFacts(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var f reminders.Facts
	if err := decodeStrictJSON(w, r, &f, maxFactsBody); err != nil {
		badBody(w, err)
		return
	}
	now := s.now()
	if f.AsOf.IsZero() || f.AsOf.After(now.Add(5*time.Minute)) {
		f.AsOf = now
	}
	err := reminders.SaveFacts(r.Context(), s.db, u.ID, f, now)
	switch {
	case errors.Is(err, reminders.ErrNoWorkspace):
		writeError(w, http.StatusNotFound, "workspace_not_found", "No such workspace.")
	case err != nil && strings.HasPrefix(fmt.Sprint(err), "reminders: save"):
		writeInternal(w, r)
	case err != nil:
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid facts: "+err.Error()+".")
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

type planAnswer struct {
	GeneratedAt time.Time          `json:"generatedAt"`
	Zone        string             `json:"zone"`
	Enabled     bool               `json:"enabled"`
	Channels    reminders.Channels `json:"channels"`
	Available   struct {
		Email bool `json:"email"`
		Push  bool `json:"push"`
	} `json:"available"`
	Slots []reminders.Slot `json:"slots"`
}

// handleGetPlan serves GET /api/reminders/plan?days=N.
func (s *server) handleGetPlan(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	days := 3
	if v := r.URL.Query().Get("days"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 14 {
			writeError(w, http.StatusBadRequest, "bad_request", "days must be 1 to 14.")
			return
		}
		days = n
	}
	ctx := r.Context()
	set, err := reminders.LoadSettings(ctx, s.db, u.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	history, _, err := studyday.Load(ctx, s.db, u.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	facts, err := reminders.LoadFacts(ctx, s.db, u.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	now := s.now()
	out := planAnswer{GeneratedAt: now.UTC().Truncate(time.Second), Zone: history.Zone(), Enabled: set.Enabled, Channels: set.Channels, Slots: []reminders.Slot{}}
	out.Available.Email = u.EmailVerified && s.mail.Configured(ctx)
	out.Available.Push = s.pushProvider().Available()
	if slots := reminders.Plan(reminders.Input{Now: now, History: history, Settings: set, Facts: facts, Days: days}); slots != nil {
		out.Slots = slots
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, out)
}

// handleGetVAPIDKey serves GET /api/push/vapid-key.
func (s *server) handleGetVAPIDKey(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	v, err := s.pushProvider().VAPID(r.Context())
	if err != nil {
		writePushUnavailable(w)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]string{"publicKey": v.PublicKey()})
}

func writePushUnavailable(w http.ResponseWriter) {
	writeError(w, http.StatusServiceUnavailable, "push_unavailable", "Web push is not available on this server (QINQIN_SECRET is missing or invalid).")
}

func (s *server) handleListSubscriptions(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	list, err := reminders.ListSubscriptions(r.Context(), s.db, u.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"subscriptions": list})
}

// handleAddSubscription serves POST /api/push/subscriptions.
func (s *server) handleAddSubscription(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var req struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
		Label string `json:"label"`
	}
	if err := decodeStrictJSON(w, r, &req, maxSubscriptionBody); err != nil {
		badBody(w, err)
		return
	}
	p256dh, e1 := base64.RawURLEncoding.DecodeString(strings.TrimRight(req.Keys.P256dh, "="))
	auth, e2 := base64.RawURLEncoding.DecodeString(strings.TrimRight(req.Keys.Auth, "="))
	if !webpush.ValidEndpoint(req.Endpoint) || e1 != nil || e2 != nil || len(p256dh) != 65 || p256dh[0] != 4 || len(auth) != 16 || len([]rune(req.Label)) > reminders.MaxLabel {
		writeError(w, http.StatusBadRequest, "bad_request", "Send {endpoint (https), keys: {p256dh, auth}, label?} as a browser's PushSubscription gives it.")
		return
	}
	id, created, err := reminders.AddSubscription(r.Context(), s.db, u.ID, reminders.NewSubscription{Endpoint: req.Endpoint, P256dh: p256dh, Auth: auth, Label: strings.TrimSpace(req.Label)}, s.now())
	switch {
	case errors.Is(err, reminders.ErrTooMany):
		writeError(w, http.StatusConflict, "too_many_subscriptions", "This account already has the most push devices (10); remove one first.")
	case err != nil:
		writeInternal(w, r)
	default:
		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}
		writeJSON(w, status, map[string]int64{"id": id})
	}
}

// handleDeleteSubscription serves DELETE /api/push/subscriptions/{id}.
func (s *server) handleDeleteSubscription(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "No such subscription.")
		return
	}
	switch err := reminders.DeleteSubscription(r.Context(), s.db, u.ID, id); {
	case errors.Is(err, reminders.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "No such subscription.")
	case err != nil:
		writeInternal(w, r)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// reminderTestGate lets one test message per account per minute.
type reminderTestGate struct {
	mu   sync.Mutex
	last map[int64]time.Time
}

func (g *reminderTestGate) allow(user int64, now time.Time) (bool, time.Duration) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.last == nil {
		g.last = map[int64]time.Time{}
	}
	if t, ok := g.last[user]; ok && now.Sub(t) < testEvery {
		return false, testEvery - now.Sub(t)
	}
	g.last[user] = now
	return true, 0
}

// handleReminderTest serves POST /api/reminders/test {channel}.
func (s *server) handleReminderTest(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var req struct {
		Channel string `json:"channel"`
	}
	if err := decodeStrictJSON(w, r, &req, maxTestBody); err != nil {
		badBody(w, err)
		return
	}
	if req.Channel != "email" && req.Channel != "push" {
		writeError(w, http.StatusBadRequest, "bad_request", `channel must be "email" or "push".`)
		return
	}
	ctx := r.Context()
	// Refuse what cannot work before it uses the account's one test a minute.
	var subs bool
	switch req.Channel {
	case "email":
		if u.Email == nil || !u.EmailVerified {
			writeError(w, http.StatusConflict, "email_unverified", "Confirm your email address first.")
			return
		}
		if !s.mail.Configured(ctx) {
			writeError(w, http.StatusConflict, "mail_unavailable", "This server has no mail configured.")
			return
		}
	case "push":
		if !s.pushProvider().Available() {
			writePushUnavailable(w)
			return
		}
		var err error
		if subs, err = reminders.HasSubscriptions(ctx, s.db, u.ID); err != nil {
			writeInternal(w, r)
			return
		}
		if !subs {
			writeError(w, http.StatusConflict, "no_subscription", "No device of this account has push turned on.")
			return
		}
	}
	if ok, wait := s.testGate.allow(u.ID, s.now()); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Wait a minute before sending another test.")
		return
	}
	if req.Channel == "email" {
		base := s.mail.PublicURL(ctx)
		d := mail.ReminderData{Link: base + "/study", Items: []mail.ReminderItem{{Kind: "test"}}}
		if s.sealCur != nil {
			d.Unsubscribe = base + "/api/reminders/unsubscribe?t=" + reminders.UnsubscribeToken(s.sealCur, u.ID)
		}
		if err := s.mail.SendReminder(ctx, u.ID, *u.Email, d); err != nil {
			writeError(w, http.StatusBadGateway, "delivery_failed", "The test mail could not be sent.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	sender, err := s.pushProvider().SenderFor(ctx)
	if err != nil {
		writePushUnavailable(w)
		return
	}
	delivered, total, err := reminders.SendTest(ctx, s.db, sender, u.ID, s.now())
	if err != nil {
		writeInternal(w, r)
		return
	}
	if total == 0 { // every subscription was gone
		writeError(w, http.StatusConflict, "no_subscription", "No device of this account has push turned on.")
		return
	}
	if delivered == 0 {
		writeError(w, http.StatusBadGateway, "delivery_failed", "No device accepted the test notification.")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// unsubscribePage renders the small public page of the unsubscribe link: text
// in the language the browser asks for, no script, no account data.
func (s *server) unsubscribePage(w http.ResponseWriter, r *http.Request, token string, step mail.Kind) {
	lang := i18n.Pick("", r.Header.Get("Accept-Language"), mail.Languages())
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
	w.WriteHeader(http.StatusOK)
	var form string
	if step == mail.PageAsk {
		form = `<form method="post" action="/api/reminders/unsubscribe?t=` + html.EscapeString(token) + `"><button type="submit">` +
			html.EscapeString(mail.Line(lang, mail.PageButton)) + `</button></form>`
	}
	fmt.Fprintf(w, `<!doctype html><html lang="%s"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>qinqin</title>`+
		`<style>body{font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:12vh auto;padding:0 1rem}button{font:inherit;padding:.5rem 1rem}</style></head><body><p>%s</p>%s</body></html>`,
		html.EscapeString(lang), html.EscapeString(mail.Line(lang, step)), form)
}

// handleUnsubscribe serves GET and POST /api/reminders/unsubscribe?t=.
func (s *server) handleUnsubscribe(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("t")
	id, ok := reminders.VerifyUnsubscribeToken(token, s.sealCur, s.sealPrev)
	if !ok {
		writeError(w, http.StatusBadRequest, "bad_request", "This unsubscribe link is not valid.")
		return
	}
	if r.Method == http.MethodGet {
		s.unsubscribePage(w, r, token, mail.PageAsk)
		return
	}
	if err := reminders.EmailOff(r.Context(), s.db, id); err != nil {
		writeInternal(w, r)
		return
	}
	s.unsubscribePage(w, r, token, mail.PageDone)
}
