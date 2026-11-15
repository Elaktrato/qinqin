package db

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
)

// goSteps are migration work SQL cannot do. A step runs inside the
// transaction of its migration, right after the migration's SQL, so a
// failing step rolls the SQL back and leaves the version unapplied. Keys
// are the full version names versionOf returns ("032_accounts"); a test
// checks every key names an embedded migration, so renumbering a file
// cannot silently skip its step.
var goSteps = map[string]func(*sql.Tx) error{
	"032_accounts": hashSessionTokens,
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
