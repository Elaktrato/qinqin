package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// KeyState tells whether a stored key can be used with the current secret.
type KeyState string

const (
	KeyOK            KeyState = "ok"
	KeyUndecryptable KeyState = "undecryptable"
)

// StoredKey is what the API shows about a key: never the key itself.
type StoredKey struct {
	Provider   string     `json:"provider"`
	Hint       string     `json:"hint"` // "…" + last 4 runes of the key
	Model      string     `json:"model"`
	State      KeyState   `json:"state"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
}

// Credentials carry a decrypted key to a provider call. No json tags and a
// redacting String, Format, MarshalJSON and MarshalText, so formatting or
// encoding it by accident leaks nothing.
type Credentials struct{ APIKey, Model string }

const redactedCredentials = "ai.Credentials{redacted}"

func (Credentials) String() string               { return redactedCredentials }
func (Credentials) GoString() string             { return redactedCredentials }
func (Credentials) MarshalText() ([]byte, error) { return []byte(redactedCredentials), nil }
func (Credentials) MarshalJSON() ([]byte, error) { return []byte(`"` + redactedCredentials + `"`), nil }
func (Credentials) Format(f fmt.State, _ rune)   { _, _ = f.Write([]byte(redactedCredentials)) }

var (
	ErrNoKey            = errors.New("ai: no key stored")
	ErrKeyUndecryptable = errors.New("ai: key stored with another QINQIN_SECRET")
)

// KeyStore keeps one encrypted API key per user.
type KeyStore struct {
	DB                *sql.DB
	Current, Previous *Sealer
	Now               func() time.Time
}

func (k *KeyStore) now() time.Time {
	if k.Now != nil {
		return k.Now().UTC()
	}
	return time.Now().UTC()
}

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func hintOf(key string) string {
	r := []rune(key)
	if len(r) > 4 {
		r = r[len(r)-4:]
	}
	return "…" + string(r)
}

// Put stores or replaces the user's key, sealed under the current secret.
// An empty model means DefaultModel.
func (k *KeyStore) Put(ctx context.Context, userID int64, provider, apiKey, model string) error {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return errors.New("ai: empty key")
	}
	if provider == "" {
		return errors.New("ai: empty provider")
	}
	if model == "" {
		model = DefaultModel
	}
	if !ValidModel(model) {
		return fmt.Errorf("ai: unknown model %q", model)
	}
	if k.Current == nil {
		return errors.New("ai: no secret")
	}
	hint := hintOf(apiKey)
	ct, nonce, err := k.Current.Seal([]byte(apiKey), KeyAAD(userID, provider))
	if err != nil {
		return err
	}
	_, err = k.DB.ExecContext(ctx, `INSERT INTO ai_keys (user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, provider) DO UPDATE SET ciphertext = excluded.ciphertext,
			nonce = excluded.nonce, secret_fp = excluded.secret_fp, hint = excluded.hint,
			model = excluded.model, created_at = excluded.created_at, last_used_at = NULL`,
		userID, provider, ct, nonce, k.Current.Fingerprint(), hint, model, stamp(k.now()))
	return err
}

// SetModel changes only the model of the stored key.
func (k *KeyStore) SetModel(ctx context.Context, userID int64, model string) error {
	if !ValidModel(model) {
		return fmt.Errorf("ai: unknown model %q", model)
	}
	res, err := k.DB.ExecContext(ctx, `UPDATE ai_keys SET model = ? WHERE user_id = ?`, model, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNoKey
	}
	return nil
}

type keyRow struct {
	provider, hint, model, fp, created string
	ct, nonce                          []byte
	lastUsed                           sql.NullString
}

func (k *KeyStore) row(ctx context.Context, userID int64) (keyRow, error) {
	var r keyRow
	err := k.DB.QueryRowContext(ctx, `SELECT provider, ciphertext, nonce, secret_fp, hint, model, created_at, last_used_at
		FROM ai_keys WHERE user_id = ?`, userID).
		Scan(&r.provider, &r.ct, &r.nonce, &r.fp, &r.hint, &r.model, &r.created, &r.lastUsed)
	if errors.Is(err, sql.ErrNoRows) {
		return r, ErrNoKey
	}
	return r, err
}

// open decrypts a row with the sealer whose fingerprint it carries.
func (k *KeyStore) open(userID int64, r keyRow) ([]byte, error) {
	for _, s := range []*Sealer{k.Current, k.Previous} {
		if s != nil && s.Fingerprint() == r.fp {
			plain, err := s.Open(r.ct, r.nonce, KeyAAD(userID, r.provider))
			if err != nil {
				return nil, ErrKeyUndecryptable
			}
			return plain, nil
		}
	}
	return nil, ErrKeyUndecryptable
}

// Info describes the stored key without exposing it.
func (k *KeyStore) Info(ctx context.Context, userID int64) (*StoredKey, error) {
	r, err := k.row(ctx, userID)
	if err != nil {
		return nil, err
	}
	state := KeyOK
	if _, err := k.open(userID, r); err != nil {
		state = KeyUndecryptable
	}
	info := &StoredKey{Provider: r.provider, Hint: r.hint, Model: r.model, State: state}
	info.CreatedAt, _ = time.Parse(time.RFC3339, r.created)
	if r.lastUsed.Valid {
		if t, err := time.Parse(time.RFC3339, r.lastUsed.String); err == nil {
			info.LastUsedAt = &t
		}
	}
	return info, nil
}

// Credentials decrypts the key for a provider call and stamps last_used_at.
func (k *KeyStore) Credentials(ctx context.Context, userID int64) (Credentials, error) {
	r, err := k.row(ctx, userID)
	if err != nil {
		return Credentials{}, err
	}
	plain, err := k.open(userID, r)
	if err != nil {
		return Credentials{}, err
	}
	if _, err := k.DB.ExecContext(ctx, `UPDATE ai_keys SET last_used_at = ? WHERE user_id = ?`, stamp(k.now()), userID); err != nil {
		return Credentials{}, err
	}
	return Credentials{APIKey: string(plain), Model: r.model}, nil
}

// Delete removes the user's key; deleting nothing is fine.
func (k *KeyStore) Delete(ctx context.Context, userID int64) error {
	_, err := k.DB.ExecContext(ctx, `DELETE FROM ai_keys WHERE user_id = ?`, userID)
	return err
}

// Rotate re-seals every key sealed under Previous with Current and returns
// how many it moved. Rows that neither secret opens are left alone.
func (k *KeyStore) Rotate(ctx context.Context) (int, error) {
	if k.Previous == nil || k.Current == nil || k.Previous.Fingerprint() == k.Current.Fingerprint() {
		return 0, nil
	}
	tx, err := k.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT user_id, provider, ciphertext, nonce FROM ai_keys WHERE secret_fp = ?`, k.Previous.Fingerprint())
	if err != nil {
		return 0, err
	}
	type old struct {
		user      int64
		provider  string
		ct, nonce []byte
	}
	var olds []old
	for rows.Next() {
		var o old
		if err := rows.Scan(&o.user, &o.provider, &o.ct, &o.nonce); err != nil {
			rows.Close()
			return 0, err
		}
		olds = append(olds, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	n := 0
	for _, o := range olds {
		aad := KeyAAD(o.user, o.provider)
		plain, err := k.Previous.Open(o.ct, o.nonce, aad)
		if err != nil {
			continue
		}
		ct, nonce, err := k.Current.Seal(plain, aad)
		if err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE ai_keys SET ciphertext = ?, nonce = ?, secret_fp = ? WHERE user_id = ?`,
			ct, nonce, k.Current.Fingerprint(), o.user); err != nil {
			return 0, err
		}
		n++
	}
	return n, tx.Commit()
}
