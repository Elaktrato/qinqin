package db

import (
	"log"

	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"qinqin/internal/model"
)

// goSteps are migration work SQL cannot do. A step runs inside the
// transaction of its migration, right after the migration's SQL, so a
// failing step rolls the SQL back and leaves the version unapplied. Keys
// are the full version names versionOf returns ("032_accounts"); a test
// checks every key names an embedded migration, so renumbering a file
// cannot silently skip its step.
var goSteps = map[string]func(*sql.Tx) error{
	"032_accounts": accountsStep,
}

// hashSessionTokens replaces the plaintext bearer tokens migration 032
// copied into sessions.token_hash with their hex SHA-256, so existing
// logins keep working and no stored value is a live credential.
func hashSessionTokens(tx *sql.Tx) error {
	rows, err := tx.Query(`SELECT id, token_hash FROM sessions`)
	if err != nil {
		return fmt.Errorf("read sessions: %w", err)
	}
	type row struct {
		id    int64
		token string
	}
	var all []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.id, &r.token); err != nil {
			rows.Close()
			return fmt.Errorf("scan session: %w", err)
		}
		all = append(all, r)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("read sessions: %w", err)
	}
	rows.Close()
	for _, r := range all {
		sum := sha256.Sum256([]byte(r.token))
		if _, err := tx.Exec(`UPDATE sessions SET token_hash = ? WHERE id = ?`, hex.EncodeToString(sum[:]), r.id); err != nil {
			return fmt.Errorf("hash session %d: %w", r.id, err)
		}
	}
	return nil
}

// accountsStep is the Go half of migration 032.
func accountsStep(tx *sql.Tx) error {
	if err := hashSessionTokens(tx); err != nil {
		return err
	}
	return fillUsernameKeys(tx)
}

// fillUsernameKeys gives every legacy user a username_key. The lowest id wins
// a collision (two names that differ only in case or compatibility form); the
// later user keeps no key and stays usable (login matches the exact name), and
// only a count is logged. Nothing is deleted or renamed.
func fillUsernameKeys(tx *sql.Tx) error {
	rows, err := tx.Query(`SELECT id, username FROM users ORDER BY id`)
	if err != nil {
		return fmt.Errorf("read users: %w", err)
	}
	type u struct {
		id   int64
		name string
	}
	var all []u
	for rows.Next() {
		var x u
		if err := rows.Scan(&x.id, &x.name); err != nil {
			rows.Close()
			return err
		}
		all = append(all, x)
	}
	rows.Close()
	seen := map[string]bool{}
	skipped := 0
	for _, x := range all {
		k := model.UsernameKey(x.name)
		if seen[k] {
			skipped++
			continue
		}
		seen[k] = true
		if _, err := tx.Exec(`UPDATE users SET username_key = ? WHERE id = ?`, k, x.id); err != nil {
			return fmt.Errorf("username key of user %d: %w", x.id, err)
		}
	}
	if skipped > 0 {
		log.Printf("migration 032: %d legacy username(s) collide with another when case and compatibility forms are ignored; they keep working but cannot be taken again as a new name", skipped)
	}
	return nil
}
