package reminders

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/dbtest"
	"qinqin/internal/keyed"
	"qinqin/internal/mail"
	"qinqin/internal/secretbox"
	"qinqin/internal/studyday"
	"qinqin/internal/webpush"
)

type sentMail struct {
	user int64
	to   string
	d    mail.ReminderData
}

type fakeMailer struct {
	mu         sync.Mutex
	configured bool
	err        error
	sent       []sentMail
}

func (f *fakeMailer) Configured(context.Context) bool { return f.configured }
func (f *fakeMailer) SendReminder(_ context.Context, user int64, to string, d mail.ReminderData) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return f.err
	}
	f.sent = append(f.sent, sentMail{user, to, d})
	return nil
}

type fakePush struct {
	mu   sync.Mutex
	errs map[string]error // by endpoint
	got  []string         // endpoint + " " + payload
}

func (f *fakePush) Send(_ context.Context, sub webpush.Subscription, payload []byte, _ webpush.Options) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.got = append(f.got, sub.Endpoint+" "+string(payload))
	return f.errs[sub.Endpoint]
}

type world struct {
	db   *sql.DB
	user int64
	ws   int64
	now  time.Time
	mail *fakeMailer
	push *fakePush
	s    *Scheduler
	seal *secretbox.Sealer
}

// 2026-11-25 17:05Z is 18:05 in Berlin: the 18:00 slot (17:00Z) fell due five minutes ago.
func newWorld(t *testing.T, settings string) *world {
	t.Helper()
	db := dbtest.Open(t)
	u := dbtest.User(t, db, "ann")
	ws := dbtest.Workspace(t, db, u, "zh")
	ctx := context.Background()
	if _, err := db.Exec(`UPDATE users SET email = 'ann@example.org', email_norm = 'ann@example.org', email_verified_at = '2026-11-01T00:00:00Z' WHERE id = ?`, u); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 25, 17, 5, 0, 0, time.UTC)
	if _, err := studyday.Set(ctx, db, u, "Europe/Berlin", false, now.Add(-100*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if settings != "" {
		if _, err := keyed.Put(ctx, db, u, nil, Key, json.RawMessage(settings), nil); err != nil {
			t.Fatal(err)
		}
	}
	f := Facts{Workspace: ws, AsOf: now.Add(-time.Hour), DueNow: 5, Goal: GoalFacts{Set: true, Status: "open"}, Streak: StreakFacts{Current: 3}}
	if err := SaveFacts(ctx, db, u, f, now); err != nil {
		t.Fatal(err)
	}
	w := &world{db: db, user: u, ws: ws, now: now, mail: &fakeMailer{configured: true}, push: &fakePush{errs: map[string]error{}}, seal: secretbox.NewSealer(make([]byte, 32))}
	w.s = &Scheduler{DB: db, Mail: w.mail, PublicURL: func(context.Context) string { return "https://words.example.org" },
		Push: func(context.Context) (PushSender, error) { return w.push, nil }, Seal: w.seal, Now: func() time.Time { return w.now }, Logf: func(string, ...any) {}}
	return w
}

const everything = `{"version":1,"enabled":true,"times":["18:00"],"channels":{"email":true,"push":true,"device":false}}`
const emailOnly = `{"version":1,"enabled":true,"times":["18:00"],"channels":{"email":true,"push":false,"device":false}}`

func kindsOf(d mail.ReminderData) string {
	var k []string
	for _, i := range d.Items {
		k = append(k, i.Kind)
	}
	return strings.Join(k, ",")
}

func TestOneDigestEmailPerDayEvenAcrossTicksAndRestarts(t *testing.T) {
	w := newWorld(t, emailOnly)
	ctx := context.Background()
	w.s.Tick(ctx)
	if len(w.mail.sent) != 1 {
		t.Fatalf("sent %d", len(w.mail.sent))
	}
	m := w.mail.sent[0]
	if m.to != "ann@example.org" || m.user != w.user || kindsOf(m.d) != "due,goal,streak" || m.d.Items[0].Count != 5 || m.d.Items[2].Count != 3 {
		t.Fatalf("%+v", m)
	}
	if m.d.Link != "https://words.example.org/study" {
		t.Errorf("link %q", m.d.Link)
	}
	if id, ok := VerifyUnsubscribeToken(strings.TrimPrefix(m.d.Unsubscribe, "https://words.example.org/api/reminders/unsubscribe?t="), w.seal, nil); !ok || id != w.user {
		t.Errorf("unsubscribe link %q", m.d.Unsubscribe)
	}
	w.now = w.now.Add(15 * time.Minute)
	w.s.Tick(ctx)
	fresh := &Scheduler{}
	*fresh = *w.s // "a restart": a new scheduler value, the same database
	fresh.Tick(ctx)
	if len(w.mail.sent) != 1 {
		t.Fatalf("a later tick sent again: %d", len(w.mail.sent))
	}
	var n int
	w.db.QueryRow(`SELECT COUNT(*) FROM reminder_deliveries WHERE outcome = 'sent' AND channel = 'email'`).Scan(&n)
	if n != 3 {
		t.Fatalf("log rows %d, want one per kind", n)
	}
	// Next day, the same hour: a new learner day, a new digest (the goal and
	// streak are assumed open; the due count grows with nothing studied).
	w.now = w.now.Add(24 * time.Hour)
	w.s.Tick(ctx)
	if len(w.mail.sent) != 2 || kindsOf(w.mail.sent[1].d) != "due,goal" {
		t.Fatalf("next day: %+v", w.mail.sent)
	}
}

func TestNothingIsSentWhenItShouldNot(t *testing.T) {
	ctx := context.Background()
	cases := map[string]func(*world){
		"no row at all":      func(w *world) { w.s.DB.Exec(`DELETE FROM keyed_rows`) },
		"master switch off":  func(w *world) { put(t, w, `{"version":1,"enabled":false,"channels":{"email":true}}`) },
		"email channel off":  func(w *world) { put(t, w, `{"version":1,"enabled":true,"channels":{"email":false}}`) },
		"unverified address": func(w *world) { w.db.Exec(`UPDATE users SET email_verified_at = NULL`) },
		"no address": func(w *world) {
			w.db.Exec(`UPDATE users SET email = NULL, email_norm = NULL, email_verified_at = NULL`)
		},
		"disabled account":    func(w *world) { w.db.Exec(`UPDATE users SET disabled_at = '2026-11-02T00:00:00Z'`) },
		"smtp not configured": func(w *world) { w.mail.configured = false },
		"quiet hours at the time": func(w *world) {
			put(t, w, `{"version":1,"enabled":true,"times":["18:00"],"quiet":{"start":"17:00","end":"19:00"},"channels":{"email":true}}`)
		},
		"vacation today":            func(w *world) { addVacation(t, w, "2026-11-25") },
		"the slot is long past":     func(w *world) { w.now = w.now.Add(3 * time.Hour) },
		"the slot is still to come": func(w *world) { w.now = w.now.Add(-30 * time.Minute) },
		"nothing is due or at risk": func(w *world) {
			saveFacts(t, w, Facts{DueNow: 0, Goal: GoalFacts{Status: "met", Set: true}, Streak: StreakFacts{Current: 3, TodayMet: true}})
		},
		"facts older than 30 days": func(w *world) { saveFacts(t, w, Facts{AsOf: w.now.Add(-31 * 24 * time.Hour), DueNow: 9}) },
		"no facts yet":             func(w *world) { w.db.Exec(`DELETE FROM reminder_facts`) },
		"kinds all switched off": func(w *world) {
			put(t, w, `{"version":1,"enabled":true,"kinds":{"due":false,"goal":false,"streak":false},"channels":{"email":true}}`)
		},
	}
	for name, setup := range cases {
		w := newWorld(t, emailOnly)
		setup(w)
		w.s.Tick(ctx)
		if len(w.mail.sent) != 0 {
			t.Errorf("%s: sent %+v", name, w.mail.sent)
		}
	}
}

func put(t *testing.T, w *world, row string) {
	t.Helper()
	if _, err := keyed.Put(context.Background(), w.db, w.user, nil, Key, json.RawMessage(row), nil); err != nil {
		t.Fatal(err)
	}
}

func saveFacts(t *testing.T, w *world, f Facts) {
	t.Helper()
	f.Workspace = w.ws
	if f.AsOf.IsZero() {
		f.AsOf = w.now.Add(-time.Hour)
	}
	if err := SaveFacts(context.Background(), w.db, w.user, f, w.now); err != nil {
		t.Fatal(err)
	}
}

func addVacation(t *testing.T, w *world, day string) {
	t.Helper()
	f := Facts{Workspace: w.ws, AsOf: w.now.Add(-time.Hour), DueNow: 5, Goal: GoalFacts{Set: true, Status: "open"}, Streak: StreakFacts{Current: 3}, Vacation: []string{day}}
	if err := SaveFacts(context.Background(), w.db, w.user, f, w.now); err != nil {
		t.Fatal(err)
	}
}

func TestAHourlyCapLeavesTheDeliveryForTheNextTick(t *testing.T) {
	w := newWorld(t, emailOnly)
	w.mail.err = mail.ErrCapped
	w.s.Tick(context.Background())
	w.mail.err = nil
	w.now = w.now.Add(15 * time.Minute)
	w.s.Tick(context.Background())
	if len(w.mail.sent) != 1 {
		t.Fatalf("sent %d after the cap lifted", len(w.mail.sent))
	}
}

func TestAFailedSendIsNotRetriedAndLogsNoAddress(t *testing.T) {
	var logs []string
	w := newWorld(t, emailOnly)
	w.s.Logf = func(f string, a ...any) { logs = append(logs, f) }
	w.mail.err = errors.New("smtp down")
	w.s.Tick(context.Background())
	w.mail.err = nil
	w.now = w.now.Add(15 * time.Minute)
	w.s.Tick(context.Background())
	if len(w.mail.sent) != 0 {
		t.Fatal("a failed digest must not be retried (at most one attempt per kind per day)")
	}
	var n int
	w.db.QueryRow(`SELECT COUNT(*) FROM reminder_deliveries WHERE outcome = 'failed'`).Scan(&n)
	if n != 3 {
		t.Fatalf("failed rows %d", n)
	}
	for _, l := range logs {
		if strings.Contains(l, "ann@example.org") {
			t.Errorf("address logged: %s", l)
		}
	}
}

func TestWebPushSendsCountsOnlyAndDropsGoneSubscriptions(t *testing.T) {
	w := newWorld(t, `{"version":1,"enabled":true,"times":["18:00"],"channels":{"email":false,"push":true}}`)
	ctx := context.Background()
	for _, ep := range []string{"https://push.example/ok", "https://push.example/gone"} {
		if _, _, err := AddSubscription(ctx, w.db, w.user, NewSubscription{Endpoint: ep, P256dh: make([]byte, 65), Auth: make([]byte, 16)}, w.now); err != nil {
			t.Fatal(err)
		}
	}
	w.push.errs["https://push.example/gone"] = &webpush.SendError{Status: 410}
	w.s.Tick(ctx)
	// Three kinds, two devices.
	if len(w.push.got) != 6 {
		t.Fatalf("sends: %v", w.push.got)
	}
	want := `{"v":1,"kind":"due","count":5,"route":"/study"}`
	found := false
	for _, g := range w.push.got {
		if strings.HasSuffix(g, " "+want) {
			found = true
		}
		if strings.Contains(g, "ann") {
			t.Errorf("personal data in a payload: %s", g)
		}
	}
	if !found {
		t.Errorf("no payload %s in %v", want, w.push.got)
	}
	list, _ := ListSubscriptions(ctx, w.db, w.user)
	if len(list) != 1 {
		t.Fatalf("the gone subscription must be deleted: %+v", list)
	}
	w.now = w.now.Add(15 * time.Minute)
	w.s.Tick(ctx)
	if len(w.push.got) != 6 {
		t.Fatal("pushed again")
	}
}

func TestPushWithoutSubscriptionsOrWithoutVAPID(t *testing.T) {
	w := newWorld(t, `{"version":1,"enabled":true,"times":["18:00"],"channels":{"push":true}}`)
	w.s.Tick(context.Background())
	if len(w.push.got) != 0 {
		t.Fatal("no subscription, no push")
	}
	AddSubscription(context.Background(), w.db, w.user, NewSubscription{Endpoint: "https://push.example/a", P256dh: make([]byte, 65), Auth: make([]byte, 16)}, w.now)
	w.s.Push = func(context.Context) (PushSender, error) { return nil, ErrNoSecret }
	w.s.Tick(context.Background())
	if len(w.push.got) != 0 {
		t.Fatal("no usable key, no push")
	}
	var n int
	w.db.QueryRow(`SELECT COUNT(*) FROM reminder_deliveries`).Scan(&n)
	if n != 0 {
		t.Fatalf("nothing may be claimed when push cannot be sent: %d", n)
	}
}

func TestEmailAndPushAreIndependentChannels(t *testing.T) {
	w := newWorld(t, everything)
	AddSubscription(context.Background(), w.db, w.user, NewSubscription{Endpoint: "https://push.example/a", P256dh: make([]byte, 65), Auth: make([]byte, 16)}, w.now)
	w.s.Tick(context.Background())
	if len(w.mail.sent) != 1 || len(w.push.got) != 3 {
		t.Fatalf("mail %d push %d", len(w.mail.sent), len(w.push.got))
	}
}

func TestOldDeliveriesArePruned(t *testing.T) {
	w := newWorld(t, emailOnly)
	w.db.Exec(`INSERT INTO reminder_deliveries (user_id, channel, kind, day, sent_at, outcome) VALUES (?, 'email', 'due', '2026-01-01', 't', 'sent')`, w.user)
	w.s.Tick(context.Background())
	var n int
	w.db.QueryRow(`SELECT COUNT(*) FROM reminder_deliveries WHERE day = '2026-01-01'`).Scan(&n)
	if n != 0 {
		t.Fatal("old log row kept")
	}
}

func TestRunStopsWithItsContext(t *testing.T) {
	w := newWorld(t, emailOnly)
	w.s.Every = time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { w.s.Run(ctx); close(done) }()
	for i := 0; i < 500; i++ { // the first pass is immediate; a loaded machine may be slow
		w.mail.mu.Lock()
		n := len(w.mail.sent)
		w.mail.mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not stop")
	}
	if len(w.mail.sent) != 1 {
		t.Fatalf("sent %d", len(w.mail.sent))
	}
}
