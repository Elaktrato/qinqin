package study

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"qinqin/internal/study/rows"
)

// AdoptLeftovers moves every readable qinqin-flashcards plugin_data row of a
// typed family whose key no typed row holds (live or tombstoned) into its
// typed table, keeping user, workspace, identity, version and stamps, and
// deletes the plugin row; it returns how many moved. Migration 038 did this
// once; a database that a v0.3.x binary wrote to after that migration (a
// binary downgrade, which is unsupported) gets the same treatment at every
// start. Each row moves in its own transaction, so a failure leaves every
// other row where it is. A shadowed, unreadable, user-global or foreign-
// workspace row stays untouched (the legacy view serves it as before). A row
// that fails to move is logged and left (Failed), so one bad row never stops
// the server; a shadowed leftover edited after its typed row (an old binary's
// change the new clients do not see) is counted (NewerShadowed) and logged.
// The error is only for failing to read the candidates.
func AdoptLeftovers(ctx context.Context, db *sql.DB) (AdoptResult, error) {
	var res AdoptResult
	q, err := db.QueryContext(ctx, `
		SELECT p.rowid, p.user_id, p.workspace_id, p.key, p.data, p.version, p.updated_at,
			COALESCE(p.modified_at, p.updated_at), p.deleted_at
		FROM plugin_data p JOIN workspaces w ON w.id = p.workspace_id AND w.user_id = p.user_id
		WHERE p.pack_id = ? ORDER BY p.rowid`, rows.Namespace)
	if err != nil {
		return res, fmt.Errorf("study: read leftovers: %w", err)
	}
	type leftover struct {
		rowid, user, ws   int64
		key, data         string
		version           int
		updated, modified string
		deleted           sql.NullString
	}
	var all []leftover
	for q.Next() {
		var l leftover
		if err := q.Scan(&l.rowid, &l.user, &l.ws, &l.key, &l.data, &l.version, &l.updated, &l.modified, &l.deleted); err != nil {
			q.Close()
			return res, fmt.Errorf("study: scan leftover: %w", err)
		}
		if _, typed := rows.FamilyOf(l.key); typed {
			all = append(all, l)
		}
	}
	if err := q.Err(); err != nil {
		q.Close()
		return res, fmt.Errorf("study: read leftovers: %w", err)
	}
	q.Close()

	for _, l := range all {
		r, err := rows.FromLegacy(l.key, json.RawMessage(l.data))
		if err == nil {
			r.M().WorkspaceID = l.ws
			err = rows.Validate(r)
		}
		if err != nil {
			continue // unreadable: no client could read it
		}
		outcome, err := adoptOne(ctx, db, l.user, l.rowid, r, l.version, l.updated, l.modified, l.deleted)
		switch {
		case err != nil:
			res.Failed++
			log.Printf("study: could not adopt %s of user %d (left in plugin_data): %v", l.key, l.user, err)
		case outcome == adopted:
			res.Moved++
		case outcome == shadowedNewer:
			res.NewerShadowed++
		}
	}
	if res.Moved > 0 || res.Failed > 0 || res.NewerShadowed > 0 {
		log.Printf("study: adopted %d study rows that an older server left in plugin_data; %d could not move; %d shadowed rows were edited after their typed row and stay in plugin_data",
			res.Moved, res.Failed, res.NewerShadowed)
	}
	return res, nil
}

// AdoptResult counts what AdoptLeftovers did.
type AdoptResult struct {
	Moved, Failed, NewerShadowed int
}

type adoptOutcome int

const (
	shadowed adoptOutcome = iota
	shadowedNewer
	adopted
)

func adoptOne(ctx context.Context, db *sql.DB, user, rowid int64, r rows.Row, version int, updated, modified string, deleted sql.NullString) (adoptOutcome, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return shadowed, err
	}
	defer tx.Rollback()
	existing, held, err := Load(ctx, tx, user, r.M().WorkspaceID, r.Family(), r.Identity())
	if err != nil {
		return shadowed, err
	}
	if held {
		// A typed row holds the key: the leftover stays shadowed.
		if t, err := time.Parse(time.RFC3339, modified); err == nil && t.After(existing.M().ModifiedAt) {
			return shadowedNewer, nil
		}
		return shadowed, nil
	}
	var del *string
	if deleted.Valid {
		del = &deleted.String
	}
	if err := InsertStored(ctx, tx, user, r, version, updated, modified, del); err != nil {
		return shadowed, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM plugin_data WHERE rowid = ?`, rowid); err != nil {
		return shadowed, fmt.Errorf("study: remove adopted row %s: %w", rows.LegacyKey(r), err)
	}
	if err := tx.Commit(); err != nil {
		return shadowed, err
	}
	return adopted, nil
}
