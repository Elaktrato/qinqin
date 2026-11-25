package reminders

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"qinqin/internal/netguard"
	"qinqin/internal/secretbox"
	"qinqin/internal/webpush"
)

// DefaultVAPIDSubject is the VAPID `sub` claim when QINQIN_VAPID_SUBJECT is
// not set: a contact URL for the push services (RFC 8292 section 2.1).
const DefaultVAPIDSubject = "https://github.com/Elaktrato/qinqin"

// PushProvider builds the web push sender on demand: the VAPID key pair is
// created on first use (sealed under QINQIN_SECRET) and every request goes
// through the network guard.
type PushProvider struct {
	DB        *sql.DB
	Cur, Prev *secretbox.Sealer
	Subject   string
	Policy    netguard.GuardPolicy
	Now       func() time.Time
	// Sender, when set, replaces the real one (tests).
	Sender PushSender
}

// Available reports whether push can be sent at all (a usable secret).
func (p *PushProvider) Available() bool { return p != nil && p.Cur != nil }

// VAPID returns the key pair (ErrNoSecret without a usable secret).
func (p *PushProvider) VAPID(ctx context.Context) (*webpush.VAPID, error) {
	if !p.Available() {
		return nil, ErrNoSecret
	}
	now := time.Now()
	if p.Now != nil {
		now = p.Now()
	}
	return LoadVAPID(ctx, p.DB, p.Cur, p.Prev, now)
}

// Sender is the push sender for the Scheduler's Push hook and the test route.
func (p *PushProvider) SenderFor(ctx context.Context) (PushSender, error) {
	if p.Sender != nil {
		return p.Sender, nil
	}
	v, err := p.VAPID(ctx)
	if err != nil {
		return nil, err
	}
	subject := p.Subject
	if subject == "" {
		subject = DefaultVAPIDSubject
	}
	return &webpush.Sender{VAPID: v, Subject: subject, Policy: p.Policy}, nil
}

// SendTest posts one "test" notification to each of the user's subscriptions
// and reports how many were delivered; gone subscriptions are deleted.
func SendTest(ctx context.Context, db *sql.DB, sender PushSender, userID int64, now time.Time) (delivered, total int, err error) {
	subs, err := subscriptionsOf(ctx, db, userID)
	if err != nil {
		return 0, 0, err
	}
	for _, s := range subs {
		total++
		serr := sender.Send(ctx, s.sub, payload(Kind("test"), nil), webpush.Options{TTL: time.Hour, Urgency: "normal"})
		switch {
		case serr == nil:
			delivered++
			_, _ = db.ExecContext(ctx, `UPDATE push_subscriptions SET last_success_at = ?, failures = 0 WHERE id = ?`, now.UTC().Format(time.RFC3339), s.id)
		case isGone(serr):
			_, _ = db.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE id = ?`, s.id)
		}
	}
	return delivered, total, nil
}

// HasSubscriptions reports whether the user has any.
func HasSubscriptions(ctx context.Context, db *sql.DB, userID int64) (bool, error) {
	var n int
	err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?`, userID).Scan(&n)
	return n > 0, err
}

func isGone(err error) bool { return errors.Is(err, webpush.ErrGone) }
