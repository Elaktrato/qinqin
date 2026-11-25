package reminders

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"qinqin/internal/mail"
	"qinqin/internal/secretbox"
	"qinqin/internal/studyday"
	"qinqin/internal/webpush"
)

// Window is how long after its time a slot may still be delivered; later it is
// skipped (an old reminder is worse than none).
const Window = 2 * time.Hour

// DefaultEvery is how often the scheduler looks.
const DefaultEvery = 5 * time.Minute

// Mailer sends the reminder email; *mail.Service is one.
type Mailer interface {
	Configured(ctx context.Context) bool
	SendReminder(ctx context.Context, userID int64, to string, d mail.ReminderData) error
}

// PushSender posts one web push; *webpush.Sender is one.
type PushSender interface {
	Send(ctx context.Context, sub webpush.Subscription, payload []byte, opt webpush.Options) error
}

// Scheduler is the server-side delivery of the email and web push channels
// (#138, #139). It acts only on accounts that opted in, at most once per
// (channel, kind, learner day), and stops with its context (#170).
type Scheduler struct {
	DB        *sql.DB
	Mail      Mailer // nil: no email
	PublicURL func(ctx context.Context) string
	// Push returns the sender, or ErrNoSecret when push cannot be sent; nil: no push.
	Push  func(ctx context.Context) (PushSender, error)
	Seal  *secretbox.Sealer // signs the unsubscribe links
	Prev  *secretbox.Sealer
	Now   func() time.Time
	Every time.Duration
	Logf  func(string, ...any)
}

func (s *Scheduler) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Scheduler) logf(f string, a ...any) {
	if s.Logf != nil {
		s.Logf(f, a...)
	}
}

// Run ticks until ctx ends; the first pass is immediate.
func (s *Scheduler) Run(ctx context.Context) {
	every := s.Every
	if every <= 0 {
		every = DefaultEvery
	}
	for {
		s.Tick(ctx)
		select {
		case <-ctx.Done():
			return
		case <-time.After(every):
		}
	}
}

type candidate struct {
	id       int64
	row      json.RawMessage
	email    sql.NullString
	verified bool
}

// Tick is one pass over the opted-in accounts.
func (s *Scheduler) Tick(ctx context.Context) {
	now := s.now()
	if _, err := PruneDeliveries(ctx, s.DB, now); err != nil {
		s.logf("reminders: %v", err)
	}
	rows, err := s.DB.QueryContext(ctx, `
		SELECT k.user_id, k.data, u.email, u.email_verified_at IS NOT NULL
		FROM keyed_rows k JOIN users u ON u.id = k.user_id
		WHERE k.key = ? AND k.workspace_id IS NULL AND k.deleted_at IS NULL AND u.disabled_at IS NULL`, Key)
	if err != nil {
		s.logf("reminders: list accounts: %v", err)
		return
	}
	var cands []candidate
	for rows.Next() {
		var c candidate
		var data string
		if err := rows.Scan(&c.id, &data, &c.email, &c.verified); err == nil {
			c.row = json.RawMessage(data)
			cands = append(cands, c)
		}
	}
	rows.Close()
	for _, c := range cands {
		if ctx.Err() != nil {
			return
		}
		s.account(ctx, now, c)
	}
}

func (s *Scheduler) account(ctx context.Context, now time.Time, c candidate) {
	set := ParseSettings(c.row)
	if !set.Enabled || (!set.Channels.Email && !set.Channels.Push) {
		return
	}
	history, _, err := studyday.Load(ctx, s.DB, c.id)
	if err != nil {
		s.logf("reminders: user=%d zone history: %v", c.id, err)
		return
	}
	facts, err := LoadFacts(ctx, s.DB, c.id)
	if err != nil {
		s.logf("reminders: user=%d facts: %v", c.id, err)
		return
	}
	var due []Slot
	for _, sl := range Plan(Input{Now: now, From: now.Add(-Window), History: history, Settings: set, Facts: facts, Days: 2}) {
		if !sl.At.After(now) {
			due = append(due, sl)
		}
	}
	if len(due) == 0 {
		return
	}
	if set.Channels.Email && c.verified && c.email.Valid && s.Mail != nil && s.Mail.Configured(ctx) {
		s.email(ctx, now, c, due)
	}
	if set.Channels.Push && s.Push != nil {
		s.push(ctx, now, c, due)
	}
}

func (s *Scheduler) email(ctx context.Context, now time.Time, c candidate, due []Slot) {
	var claimed []Slot
	for _, sl := range due {
		ok, err := Claim(ctx, s.DB, c.id, "email", sl.Kind, sl.Day, now)
		if err != nil {
			s.logf("reminders: user=%d claim: %v", c.id, err)
			continue
		}
		if ok {
			claimed = append(claimed, sl)
		}
	}
	if len(claimed) == 0 {
		return
	}
	base := ""
	if s.PublicURL != nil {
		base = s.PublicURL(ctx)
	}
	d := mail.ReminderData{Link: base + "/study"}
	if s.Seal != nil {
		d.Unsubscribe = base + "/api/reminders/unsubscribe?t=" + UnsubscribeToken(s.Seal, c.id)
	}
	for _, sl := range claimed {
		n := 0
		if sl.Count != nil {
			n = *sl.Count
		}
		d.Items = append(d.Items, mail.ReminderItem{Kind: string(sl.Kind), Count: n})
	}
	err := s.Mail.SendReminder(ctx, c.id, c.email.String, d)
	outcome := "sent"
	switch {
	case errors.Is(err, mail.ErrCapped):
		for _, sl := range claimed { // not an attempt: the next tick tries again
			_, _ = s.DB.ExecContext(ctx, `DELETE FROM reminder_deliveries WHERE user_id = ? AND channel = 'email' AND kind = ? AND day = ?`, c.id, string(sl.Kind), sl.Day)
		}
		return
	case err != nil:
		outcome = "failed"
		s.logf("reminders: email failed user=%d", c.id)
	}
	for _, sl := range claimed {
		_ = Finish(ctx, s.DB, c.id, "email", sl.Kind, sl.Day, outcome)
	}
}

func payload(kind Kind, count *int) []byte {
	b, _ := json.Marshal(struct {
		V     int    `json:"v"`
		Kind  Kind   `json:"kind"`
		Count *int   `json:"count"`
		Route string `json:"route"`
	}{1, kind, count, "/study"})
	return b
}

func (s *Scheduler) push(ctx context.Context, now time.Time, c candidate, due []Slot) {
	subs, err := subscriptionsOf(ctx, s.DB, c.id)
	if err != nil || len(subs) == 0 {
		return
	}
	sender, err := s.Push(ctx)
	if err != nil || sender == nil {
		return
	}
	for _, sl := range due {
		ok, err := Claim(ctx, s.DB, c.id, "push", sl.Kind, sl.Day, now)
		if err != nil || !ok {
			continue
		}
		delivered := false
		for _, sub := range subs {
			err := sender.Send(ctx, sub.sub, payload(sl.Kind, sl.Count), webpush.Options{TTL: 12 * time.Hour, Urgency: "low"})
			switch {
			case err == nil:
				delivered = true
				_, _ = s.DB.ExecContext(ctx, `UPDATE push_subscriptions SET last_success_at = ?, failures = 0 WHERE id = ?`, now.UTC().Format(time.RFC3339), sub.id)
			case errors.Is(err, webpush.ErrGone):
				_, _ = s.DB.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE id = ?`, sub.id)
			default:
				_, _ = s.DB.ExecContext(ctx, `UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?`, sub.id)
				s.logf("reminders: push failed user=%d sub=%d", c.id, sub.id)
			}
		}
		outcome := "failed"
		if delivered {
			outcome = "sent"
		}
		_ = Finish(ctx, s.DB, c.id, "push", sl.Kind, sl.Day, outcome)
	}
}
