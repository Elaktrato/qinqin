package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"

	"qinqin/internal/model"
	"qinqin/internal/study"
	"qinqin/internal/study/rows"
)

// goSteps are migration work SQL cannot do. A step runs inside the
// transaction of its migration, right after the migration's SQL, so a
// failing step rolls the SQL back and leaves the version unapplied. Keys
// are the full version names versionOf returns ("032_accounts"); a test
// checks every key names an embedded migration, so renumbering a file
// cannot silently skip its step.
var goSteps = map[string]func(*sql.Tx) error{
	"032_accounts":   accountsStep,
	"038_core_study": coreStudyStep,
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

// coreStudyStep is the Go half of migration 038: it moves every readable
// qinqin-flashcards row of a typed study family (card:, deck:, deckcfg:,
// limits:, fsrs:set:, fsrs:active) into its study_* table with the same
// user, workspace, identity, version, updated_at, modified_at (NULL reads as
// updated_at, as everywhere) and deleted_at (a tombstone moves as a tombstone
// with its last data), and deletes the plugin_data row. A row whose workspace
// is NULL or not the row user's, or whose data the codec refuses, stays in
// plugin_data untouched: no client could read it before either. Study events
// are not touched. One log line counts what moved and what stayed.
func coreStudyStep(tx *sql.Tx) error {
	ctx := context.Background()
	q, err := tx.QueryContext(ctx, `
		SELECT p.rowid, p.user_id, p.workspace_id, w.user_id, p.key, p.data, p.version, p.updated_at,
			COALESCE(p.modified_at, p.updated_at), p.deleted_at
		FROM plugin_data p LEFT JOIN workspaces w ON w.id = p.workspace_id
		WHERE p.pack_id = ? ORDER BY p.rowid`, rows.Namespace)
	if err != nil {
		return fmt.Errorf("read study rows: %w", err)
	}
	type legacy struct {
		rowid, user       int64
		ws, wsOwner       sql.NullInt64
		key, data         string
		version           int
		updated, modified string
		deleted           sql.NullString
	}
	var all []legacy
	for q.Next() {
		var l legacy
		if err := q.Scan(&l.rowid, &l.user, &l.ws, &l.wsOwner, &l.key, &l.data, &l.version, &l.updated, &l.modified, &l.deleted); err != nil {
			q.Close()
			return fmt.Errorf("scan study row: %w", err)
		}
		all = append(all, l)
	}
	if err := q.Err(); err != nil {
		q.Close()
		return fmt.Errorf("read study rows: %w", err)
	}
	q.Close()

	moved := map[rows.Family]int{}
	total, left := 0, 0
	for _, l := range all {
		if _, typed := rows.FamilyOf(l.key); !typed {
			continue
		}
		if !l.ws.Valid || !l.wsOwner.Valid || l.wsOwner.Int64 != l.user {
			left++
			continue
		}
		r, err := rows.FromLegacy(l.key, json.RawMessage(l.data))
		if err == nil {
			r.M().WorkspaceID = l.ws.Int64
			err = rows.Validate(r)
		}
		if err != nil {
			left++
			continue
		}
		var deleted *string
		if l.deleted.Valid {
			deleted = &l.deleted.String
		}
		if err := study.InsertStored(ctx, tx, l.user, r, l.version, l.updated, l.modified, deleted); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM plugin_data WHERE rowid = ?`, l.rowid); err != nil {
			return fmt.Errorf("remove moved row %s: %w", l.key, err)
		}
		moved[r.Family()]++
		total++
	}
	log.Printf("migration 038: moved %d study rows (cards %d, decks %d, deckSettings %d, limits %d, fsrsSets %d, fsrsActive %d), left %d unreadable rows in plugin_data",
		total, moved[rows.Cards], moved[rows.Decks], moved[rows.DeckSettings], moved[rows.Limits], moved[rows.FsrsSets], moved[rows.FsrsActive], left)
	return nil
}
