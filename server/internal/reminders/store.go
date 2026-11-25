package reminders

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"qinqin/internal/secretbox"
	"qinqin/internal/webpush"
)

// Limits of the facts a client may publish (docs/contracts/reminders/).
const (
	MaxBuckets       = 400
	MaxVacation      = 120
	MaxCount         = 1_000_000
	MaxSubscriptions = 10
	MaxLabel         = 80
	// DeliveryLogDays is how long the delivery log is kept.
	DeliveryLogDays = 90
)

var (
	ErrNoWorkspace = errors.New("reminders: workspace not found")
	ErrNotFound    = errors.New("reminders: not found")
	ErrTooMany     = errors.New("reminders: too many subscriptions")
	ErrNoSecret    = errors.New("reminders: no usable QINQIN_SECRET")
)

// Validate checks a published facts record by the contract's rules.
func (f Facts) Validate() error {
	if f.DueNow < 0 || f.DueNow > MaxCount {
		return errors.New("dueNow out of range")
	}
	if len(f.DueBuckets) > MaxBuckets {
		return errors.New("too many dueBuckets")
	}
	for _, b := range f.DueBuckets {
		if b.Count < 0 || b.Count > MaxCount || !b.At.Equal(b.At.Truncate(time.Hour)) {
			return errors.New("bad dueBucket")
		}
	}
	switch f.Goal.Status {
	case "", "open", "met", "vacation", "none":
	default:
		return errors.New("bad goal status")
	}
	if f.Streak.Current < 0 || f.Streak.Current > 100_000 {
		return errors.New("bad streak")
	}
	if len(f.Vacation) > MaxVacation {
		return errors.New("too many vacation days")
	}
	for _, d := range f.Vacation {
		if _, err := time.Parse("2006-01-02", d); err != nil {
			return errors.New("bad vacation day")
		}
	}
	return nil
}

// SaveFacts stores the workspace's facts, replacing the older record. The
// workspace must be the user's.
func SaveFacts(ctx context.Context, db *sql.DB, userID int64, f Facts, now time.Time) error {
	if err := f.Validate(); err != nil {
		return err
	}
	var one int
	err := db.QueryRowContext(ctx, `SELECT 1 FROM workspaces WHERE id = ? AND user_id = ?`, f.Workspace, userID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNoWorkspace
	}
	if err != nil {
		return fmt.Errorf("reminders: save facts: %w", err)
	}
	if f.DueBuckets == nil {
		f.DueBuckets = []Bucket{}
	}
	if f.Vacation == nil {
		f.Vacation = []string{}
	}
	data, err := json.Marshal(f)
	if err != nil {
		return err
	}
	stamp := now.UTC().Format(time.RFC3339)
	_, err = db.ExecContext(ctx, `
		INSERT INTO reminder_facts (user_id, workspace_id, as_of, data, updated_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT (user_id, workspace_id) DO UPDATE SET as_of = excluded.as_of, data = excluded.data, updated_at = excluded.updated_at`,
		userID, f.Workspace, f.AsOf.UTC().Format(time.RFC3339), string(data), stamp)
	if err != nil {
		return fmt.Errorf("reminders: save facts: %w", err)
	}
	return nil
}

// LoadFacts returns the user's facts of every workspace.
func LoadFacts(ctx context.Context, db *sql.DB, userID int64) ([]Facts, error) {
	rows, err := db.QueryContext(ctx, `SELECT data FROM reminder_facts WHERE user_id = ? ORDER BY workspace_id`, userID)
	if err != nil {
		return nil, fmt.Errorf("reminders: load facts: %w", err)
	}
	defer rows.Close()
	var out []Facts
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			return nil, fmt.Errorf("reminders: load facts: %w", err)
		}
		var f Facts
		if json.Unmarshal([]byte(data), &f) == nil {
			out = append(out, f)
		}
	}
	return out, rows.Err()
}

// NewSubscription is what a browser's PushSubscription holds.
type NewSubscription struct {
	Endpoint string
	P256dh   []byte
	Auth     []byte
	Label    string
}

// Subscription is a stored subscription as the list shows it: no endpoint, no keys.
type Subscription struct {
	ID            int64   `json:"id"`
	Label         string  `json:"label"`
	CreatedAt     string  `json:"createdAt"`
	LastSuccessAt *string `json:"lastSuccessAt"`
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// AddSubscription stores a subscription for the user. The same endpoint again
// updates it (also when it belonged to another account: the device now
// belongs to this one). More than MaxSubscriptions per user is ErrTooMany.
func AddSubscription(ctx context.Context, db *sql.DB, userID int64, s NewSubscription, now time.Time) (id int64, created bool, err error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, false, fmt.Errorf("reminders: add subscription: %w", err)
	}
	defer tx.Rollback()
	err = tx.QueryRowContext(ctx, `SELECT id FROM push_subscriptions WHERE endpoint = ?`, s.Endpoint).Scan(&id)
	switch {
	case err == nil:
		_, err = tx.ExecContext(ctx, `UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, label = ?, failures = 0 WHERE id = ?`,
			userID, b64(s.P256dh), b64(s.Auth), s.Label, id)
	case errors.Is(err, sql.ErrNoRows):
		var n int
		if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?`, userID).Scan(&n); err != nil {
			break
		}
		if n >= MaxSubscriptions {
			return 0, false, ErrTooMany
		}
		var res sql.Result
		res, err = tx.ExecContext(ctx, `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			userID, s.Endpoint, b64(s.P256dh), b64(s.Auth), s.Label, now.UTC().Format(time.RFC3339))
		if err == nil {
			id, err = res.LastInsertId()
			created = true
		}
	}
	if err != nil {
		return 0, false, fmt.Errorf("reminders: add subscription: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, false, fmt.Errorf("reminders: add subscription: %w", err)
	}
	return id, created, nil
}

// ListSubscriptions lists the user's subscriptions, oldest first.
func ListSubscriptions(ctx context.Context, db *sql.DB, userID int64) ([]Subscription, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, label, created_at, last_success_at FROM push_subscriptions WHERE user_id = ? ORDER BY id`, userID)
	if err != nil {
		return nil, fmt.Errorf("reminders: list subscriptions: %w", err)
	}
	defer rows.Close()
	out := []Subscription{}
	for rows.Next() {
		var s Subscription
		var last sql.NullString
		if err := rows.Scan(&s.ID, &s.Label, &s.CreatedAt, &last); err != nil {
			return nil, fmt.Errorf("reminders: list subscriptions: %w", err)
		}
		if last.Valid {
			s.LastSuccessAt = &last.String
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// DeleteSubscription removes one of the user's subscriptions (ErrNotFound
// for another account's id).
func DeleteSubscription(ctx context.Context, db *sql.DB, userID, id int64) error {
	res, err := db.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return fmt.Errorf("reminders: delete subscription: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

type storedSub struct {
	id  int64
	sub webpush.Subscription
}

func subscriptionsOf(ctx context.Context, db *sql.DB, userID int64) ([]storedSub, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? ORDER BY id`, userID)
	if err != nil {
		return nil, fmt.Errorf("reminders: subscriptions: %w", err)
	}
	defer rows.Close()
	var out []storedSub
	for rows.Next() {
		var s storedSub
		var k, a string
		if err := rows.Scan(&s.id, &s.sub.Endpoint, &k, &a); err != nil {
			return nil, fmt.Errorf("reminders: subscriptions: %w", err)
		}
		var e1, e2 error
		s.sub.P256dh, e1 = base64.RawURLEncoding.DecodeString(k)
		s.sub.Auth, e2 = base64.RawURLEncoding.DecodeString(a)
		if e1 == nil && e2 == nil {
			out = append(out, s)
		}
	}
	return out, rows.Err()
}

// Claim records that a (user, channel, kind, learner day) delivery is being
// made, before it is made: it reports false when one was already claimed, so a
// restart or a second tick can never send it twice.
func Claim(ctx context.Context, db *sql.DB, userID int64, channel string, kind Kind, day string, now time.Time) (bool, error) {
	res, err := db.ExecContext(ctx, `INSERT OR IGNORE INTO reminder_deliveries (user_id, channel, kind, day, sent_at, outcome) VALUES (?, ?, ?, ?, ?, 'claimed')`,
		userID, channel, string(kind), day, now.UTC().Format(time.RFC3339))
	if err != nil {
		return false, fmt.Errorf("reminders: claim: %w", err)
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// Finish sets the outcome ("sent" or "failed") of a claimed delivery.
func Finish(ctx context.Context, db *sql.DB, userID int64, channel string, kind Kind, day, outcome string) error {
	_, err := db.ExecContext(ctx, `UPDATE reminder_deliveries SET outcome = ? WHERE user_id = ? AND channel = ? AND kind = ? AND day = ?`,
		outcome, userID, channel, string(kind), day)
	if err != nil {
		return fmt.Errorf("reminders: finish: %w", err)
	}
	return nil
}

// PruneDeliveries drops log rows older than DeliveryLogDays.
func PruneDeliveries(ctx context.Context, db *sql.DB, now time.Time) (int64, error) {
	cut := now.UTC().AddDate(0, 0, -DeliveryLogDays).Format("2006-01-02")
	res, err := db.ExecContext(ctx, `DELETE FROM reminder_deliveries WHERE day < ?`, cut)
	if err != nil {
		return 0, fmt.Errorf("reminders: prune: %w", err)
	}
	return res.RowsAffected()
}

const vapidAAD = "qinqin push vapid key v1"

// LoadVAPID returns the instance's VAPID key pair, creating and storing it
// (private scalar sealed with the current secret) on first use. Without a
// usable secret it is ErrNoSecret: the private key is never stored in clear.
func LoadVAPID(ctx context.Context, db *sql.DB, current, previous *secretbox.Sealer, now time.Time) (*webpush.VAPID, error) {
	if current == nil {
		return nil, ErrNoSecret
	}
	var ct, nonce []byte
	err := db.QueryRowContext(ctx, `SELECT private_ct, private_nonce FROM push_vapid WHERE id = 1`).Scan(&ct, &nonce)
	if err == nil {
		for _, s := range []*secretbox.Sealer{current, previous} {
			if s == nil {
				continue
			}
			if plain, oerr := s.Open(ct, nonce, vapidAAD); oerr == nil {
				if s != current { // seal it under the new secret (rotation)
					if nct, nnonce, serr := current.Seal(plain, vapidAAD); serr == nil {
						_, _ = db.ExecContext(ctx, `UPDATE push_vapid SET private_ct = ?, private_nonce = ?, secret_fp = ? WHERE id = 1`, nct, nnonce, current.Fingerprint())
					}
				}
				return webpush.ParseVAPID(plain)
			}
		}
		return nil, secretbox.ErrOpen
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("reminders: load vapid: %w", err)
	}
	v, err := webpush.NewVAPID()
	if err != nil {
		return nil, fmt.Errorf("reminders: new vapid: %w", err)
	}
	ct, nonce, err = current.Seal(v.PrivateBytes(), vapidAAD)
	if err != nil {
		return nil, err
	}
	res, err := db.ExecContext(ctx, `INSERT OR IGNORE INTO push_vapid (id, public_key, private_ct, private_nonce, secret_fp, created_at) VALUES (1, ?, ?, ?, ?, ?)`,
		v.PublicKey(), ct, nonce, current.Fingerprint(), now.UTC().Format(time.RFC3339))
	if err != nil {
		return nil, fmt.Errorf("reminders: store vapid: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 { // a concurrent first use won
		return LoadVAPID(ctx, db, current, previous, now)
	}
	return v, nil
}
