package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
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
// encoding it by accident leaks nothing (BaseURL may carry a token too).
type Credentials struct{ APIKey, Model, BaseURL, Provider string }

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

var modelIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@-]*$`)

// ValidModelID reports whether id may be stored as a model: 1-200 characters
// of [A-Za-z0-9._:/@-], starting with a letter or digit. Any such id is
// accepted for any provider.
func ValidModelID(id string) bool { return len(id) <= 200 && modelIDPattern.MatchString(id) }

// PutOptions tunes Put.
type PutOptions struct {
	// AllowEmptyKey stores a sealed empty key, for keyless custom endpoints.
	AllowEmptyKey bool
}

// KeyStore keeps one encrypted API key per user and provider.
type KeyStore struct {
	DB                *sql.DB
	Current, Previous *Sealer
	Now               func() time.Time
	// AADFor returns the additional data a key is sealed under. Nil means the
	// frozen built-in form KeyAAD. An error (an unknown provider) makes the
	// row undecryptable; it never panics.
	AADFor func(userID int64, provider string) (string, error)
}

func (k *KeyStore) now() time.Time {
	if k.Now != nil {
		return k.Now().UTC()
	}
	return time.Now().UTC()
}

func (k *KeyStore) aad(userID int64, provider string) (string, error) {
	if k.AADFor == nil {
		return KeyAAD(userID, provider), nil
	}
	return k.AADFor(userID, provider)
}

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func hintOf(key string) string {
	if key == "" {
		return ""
	}
	r := []rune(key)
	if len(r) > 4 {
		r = r[len(r)-4:]
	}
	return "…" + string(r)
}

// Put stores or replaces the user's key for one provider, sealed under the
// current secret. An empty model means DefaultModel for anthropic and is an
// error for any other provider (the caller knows the provider's default).
func (k *KeyStore) Put(ctx context.Context, userID int64, provider, apiKey, model string, opt PutOptions) error {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" && !opt.AllowEmptyKey {
		return errors.New("ai: empty key")
	}
	if provider == "" {
		return errors.New("ai: empty provider")
	}
	if model == "" {
		if provider != "anthropic" {
			return errors.New("ai: model required")
		}
		model = DefaultModel
	}
	if !ValidModelID(model) {
		return fmt.Errorf("ai: invalid model id %q", model)
	}
	if k.Current == nil {
		return errors.New("ai: no secret")
	}
	aad, err := k.aad(userID, provider)
	if err != nil {
		return fmt.Errorf("ai: provider %q cannot hold a key: %w", provider, err)
	}
	ct, nonce, err := k.Current.Seal([]byte(apiKey), aad)
	if err != nil {
		return err
	}
	_, err = k.DB.ExecContext(ctx, `INSERT INTO ai_keys (user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, provider) DO UPDATE SET ciphertext = excluded.ciphertext,
			nonce = excluded.nonce, secret_fp = excluded.secret_fp, hint = excluded.hint,
			model = excluded.model, created_at = excluded.created_at, last_used_at = NULL`,
		userID, provider, ct, nonce, k.Current.Fingerprint(), hintOf(apiKey), model, stamp(k.now()))
	return err
}

// SetModel changes only the model of one stored key.
func (k *KeyStore) SetModel(ctx context.Context, userID int64, provider, model string) error {
	if !ValidModelID(model) {
		return fmt.Errorf("ai: invalid model id %q", model)
	}
	res, err := k.DB.ExecContext(ctx, `UPDATE ai_keys SET model = ? WHERE user_id = ? AND provider = ?`, model, userID, provider)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNoKey
	}
	return nil
}

type keyRow struct {
	userID                             int64
	provider, hint, model, fp, created string
	ct, nonce                          []byte
	lastUsed                           sql.NullString
}

const keyColumns = `user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at, last_used_at`

type rowScanner interface{ Scan(dest ...any) error }

func scanKeyRow(s rowScanner) (keyRow, error) {
	var r keyRow
	err := s.Scan(&r.userID, &r.provider, &r.ct, &r.nonce, &r.fp, &r.hint, &r.model, &r.created, &r.lastUsed)
	return r, err
}

func (k *KeyStore) row(ctx context.Context, userID int64, provider string) (keyRow, error) {
	r, err := scanKeyRow(k.DB.QueryRowContext(ctx, `SELECT `+keyColumns+` FROM ai_keys WHERE user_id = ? AND provider = ?`, userID, provider))
	if errors.Is(err, sql.ErrNoRows) {
		return r, ErrNoKey
	}
	return r, err
}

// open decrypts a row with the sealer whose fingerprint it carries.
func (k *KeyStore) open(r keyRow) ([]byte, error) {
	aad, err := k.aad(r.userID, r.provider)
	if err != nil {
		return nil, ErrKeyUndecryptable
	}
	for _, s := range []*Sealer{k.Current, k.Previous} {
		if s != nil && s.Fingerprint() == r.fp {
			plain, err := s.Open(r.ct, r.nonce, aad)
			if err != nil {
				return nil, ErrKeyUndecryptable
			}
			return plain, nil
		}
	}
	return nil, ErrKeyUndecryptable
}

func (k *KeyStore) describe(r keyRow) StoredKey {
	state := KeyOK
	if _, err := k.open(r); err != nil {
		state = KeyUndecryptable
	}
	info := StoredKey{Provider: r.provider, Hint: r.hint, Model: r.model, State: state}
	info.CreatedAt, _ = time.Parse(time.RFC3339, r.created)
	if r.lastUsed.Valid {
		if t, err := time.Parse(time.RFC3339, r.lastUsed.String); err == nil {
			info.LastUsedAt = &t
		}
	}
	return info
}

// Info describes one stored key without exposing it.
func (k *KeyStore) Info(ctx context.Context, userID int64, provider string) (*StoredKey, error) {
	r, err := k.row(ctx, userID, provider)
	if err != nil {
		return nil, err
	}
	info := k.describe(r)
	return &info, nil
}

// List describes all of the user's keys, oldest first.
func (k *KeyStore) List(ctx context.Context, userID int64) ([]StoredKey, error) {
	rows, err := k.DB.QueryContext(ctx, `SELECT `+keyColumns+` FROM ai_keys WHERE user_id = ? ORDER BY created_at, provider`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StoredKey
	for rows.Next() {
		r, err := scanKeyRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, k.describe(r))
	}
	return out, rows.Err()
}

// Credentials decrypts one key for a provider call and stamps last_used_at.
// BaseURL is left for the caller (the registry knows it).
func (k *KeyStore) Credentials(ctx context.Context, userID int64, provider string) (Credentials, error) {
	r, err := k.row(ctx, userID, provider)
	if err != nil {
		return Credentials{}, err
	}
	plain, err := k.open(r)
	if err != nil {
		return Credentials{}, err
	}
	if _, err := k.DB.ExecContext(ctx, `UPDATE ai_keys SET last_used_at = ? WHERE user_id = ? AND provider = ?`, stamp(k.now()), userID, provider); err != nil {
		return Credentials{}, err
	}
	return Credentials{APIKey: string(plain), Model: r.model}, nil
}

// Delete removes one of the user's keys; deleting nothing is fine.
func (k *KeyStore) Delete(ctx context.Context, userID int64, provider string) error {
	_, err := k.DB.ExecContext(ctx, `DELETE FROM ai_keys WHERE user_id = ? AND provider = ?`, userID, provider)
	return err
}

// DeleteProvider removes every user's key for a provider (a deleted custom
// endpoint).
func (k *KeyStore) DeleteProvider(ctx context.Context, provider string) error {
	_, err := k.DB.ExecContext(ctx, `DELETE FROM ai_keys WHERE provider = ?`, provider)
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
		aad, err := k.aad(o.user, o.provider)
		if err != nil {
			continue
		}
		plain, err := k.Previous.Open(o.ct, o.nonce, aad)
		if err != nil {
			continue
		}
		ct, nonce, err := k.Current.Seal(plain, aad)
		if err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE ai_keys SET ciphertext = ?, nonce = ?, secret_fp = ? WHERE user_id = ? AND provider = ?`,
			ct, nonce, k.Current.Fingerprint(), o.user, o.provider); err != nil {
			return 0, err
		}
		n++
	}
	return n, tx.Commit()
}
