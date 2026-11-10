// Package auth implements argon2id password hashing, user creation,
// bearer-token sessions, and request authentication.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/argon2"
	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"

	"qinqin/internal/model"
)

// Argon2id parameters, the RFC 9106 recommended option: 64 MiB of memory,
// 3 passes, 4 lanes. Salt and key lengths follow common practice.
const (
	argonMemoryKiB = 64 * 1024
	argonTime      = 3
	argonThreads   = 4
	argonSaltLen   = 16
	argonKeyLen    = 32
)

// ErrBadCredentials reports an unknown username or wrong password from Login.
var ErrBadCredentials = errors.New("bad credentials")

// ErrUsernameTaken reports a CreateUser attempt on an existing username.
var ErrUsernameTaken = errors.New("username taken")

// Hash returns the argon2id digest of password as a PHC-format string
// ($argon2id$v=19$m=…,t=…,p=…$salt$key) with a fresh random salt, so stored
// hashes carry their own parameters and are verifiable without config.
func Hash(password string) string {
	salt := randomBytes(argonSaltLen)
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemoryKiB, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemoryKiB, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key))
}

// Verify reports whether password matches a PHC-format argon2id hash from
// Hash. Malformed or unsupported hashes verify as false; the key comparison
// is constant-time.
func Verify(hash, password string) bool {
	salt, key, p, err := decodeHash(hash)
	if err != nil {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, p.time, p.memory, p.threads, uint32(len(key)))
	return subtle.ConstantTimeCompare(got, key) == 1
}

// argonParams are the parameters encoded in a stored hash.
type argonParams struct {
	memory  uint32
	time    uint32
	threads uint8
}

// decodeHash splits a PHC-format argon2id string into salt, key, and
// parameters.
func decodeHash(encoded string) (salt, key []byte, p argonParams, err error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return nil, nil, p, fmt.Errorf("malformed argon2id hash")
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return nil, nil, p, fmt.Errorf("unsupported argon2 version in %q", parts[2])
	}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.memory, &p.time, &p.threads); err != nil {
		return nil, nil, p, fmt.Errorf("malformed argon2id parameters in %q", parts[3])
	}
	// Reject degenerate parameters before they reach argon2.IDKey, which
	// panics on zero rounds or threads.
	if p.time < 1 || p.threads < 1 {
		return nil, nil, p, fmt.Errorf("invalid argon2id parameters in %q", parts[3])
	}
	if salt, err = base64.RawStdEncoding.DecodeString(parts[4]); err != nil {
		return nil, nil, p, fmt.Errorf("malformed argon2id salt: %w", err)
	}
	if key, err = base64.RawStdEncoding.DecodeString(parts[5]); err != nil {
		return nil, nil, p, fmt.Errorf("malformed argon2id key: %w", err)
	}
	if len(salt) == 0 || len(key) == 0 {
		return nil, nil, p, fmt.Errorf("empty salt or key in %q", encoded)
	}
	return salt, key, p, nil
}

// CreateUser inserts a user with an argon2id hash of password and returns
// it. ErrUsernameTaken marks a duplicate username.
func CreateUser(ctx context.Context, sqlDB *sql.DB, username, password string, admin bool) (model.User, error) {
	res, err := sqlDB.ExecContext(ctx,
		`INSERT INTO users (username, hash, admin, updated_at) VALUES (?, ?, ?, ?)`,
		username, Hash(password), admin, now())
	if err != nil {
		if isUniqueViolation(err) {
			return model.User{}, ErrUsernameTaken
		}
		return model.User{}, fmt.Errorf("insert user %q: %w", username, err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return model.User{}, fmt.Errorf("insert user %q: last insert id: %w", username, err)
	}
	return model.User{ID: id, Username: username, Admin: admin}, nil
}

// Login verifies username and password, creates a session, and returns its
// 32-byte hex bearer token. ErrBadCredentials marks any mismatch.
func Login(ctx context.Context, sqlDB *sql.DB, username, password string) (string, error) {
	var id int64
	var hash string
	err := sqlDB.QueryRowContext(ctx,
		`SELECT id, hash FROM users WHERE username = ?`, username).Scan(&id, &hash)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrBadCredentials
	}
	if err != nil {
		return "", fmt.Errorf("select user %q: %w", username, err)
	}
	if !Verify(hash, password) {
		return "", ErrBadCredentials
	}
	token := hex.EncodeToString(randomBytes(32))
	if _, err := sqlDB.ExecContext(ctx,
		`INSERT INTO sessions (token, user_id, updated_at) VALUES (?, ?, ?)`,
		token, id, now()); err != nil {
		return "", fmt.Errorf("insert session: %w", err)
	}
	return token, nil
}

// UserFromRequest resolves the bearer token in r to its user. A nil user
// with a nil error means the request is not authenticated (missing,
// malformed, or unknown token); a non-nil error means the lookup failed.
func UserFromRequest(r *http.Request, sqlDB *sql.DB) (*model.User, error) {
	token := bearerToken(r)
	if token == "" {
		return nil, nil
	}
	var u model.User
	var admin int
	err := sqlDB.QueryRowContext(r.Context(), `
		SELECT users.id, users.username, users.admin
		FROM sessions JOIN users ON users.id = sessions.user_id
		WHERE sessions.token = ?`, token).Scan(&u.ID, &u.Username, &admin)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lookup session: %w", err)
	}
	u.Admin = admin != 0
	return &u, nil
}

// bearerToken extracts the token from an "Authorization: Bearer <token>"
// header, or "" when absent or malformed.
func bearerToken(r *http.Request) string {
	scheme, rest, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	return strings.TrimSpace(rest)
}

// randomBytes returns n cryptographically random bytes. crypto/rand never
// fails on the supported platforms, so failure is unrecoverable.
func randomBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("auth: crypto/rand read: " + err.Error())
	}
	return b
}

// now returns the server clock as UTC RFC 3339, the timestamp convention
// for every write.
func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// isUniqueViolation reports whether err is a SQLite UNIQUE constraint error.
func isUniqueViolation(err error) bool {
	var sqliteErr *sqlite.Error
	return errors.As(err, &sqliteErr) && sqliteErr.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE
}
