package workspaces

import (
	"context"
	"database/sql"

	"qinqin/internal/auth"
	"qinqin/internal/grammar"
	"qinqin/internal/journal"
	"qinqin/internal/library"
	"qinqin/internal/study"
)

// Rule is what deleting a workspace does to one table with a workspace_id
// column. Keep is empty for a table whose rows of the workspace go, else
// the reason they stay: a rule has a reason exactly when it deletes nothing
// (TestARuleKeepsExactlyWhenItDeletesNothing). TestEveryWorkspaceTableHasADeleteRule
// fails on a table of the schema without a rule.
type Rule struct {
	Table string
	Keep  string
}

// rule is a Rule with its statement: del removes the workspace's rows on
// tx and notes in d what the caller must clean up after the commit.
type rule struct {
	Rule
	del func(ctx context.Context, tx *sql.Tx, d *Deleted, userID, id int64) error
}

// byWorkspace deletes every row of the workspace from table.
func byWorkspace(table string) rule {
	return rule{Rule: Rule{Table: table}, del: func(ctx context.Context, tx *sql.Tx, _ *Deleted, _, id int64) error {
		_, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE workspace_id = ?`, id)
		return err
	}}
}

// rules are the delete rules in the order Delete runs them: the study
// events, the keyed rows (user-global rows have no workspace and
// stay), the typed study rows (migration 038), the journal's documents
// (migration 044), the grammar lesson progress (045), the access tokens limited
// to the workspace, the library books with their bookmarks and highlights,
// the journal photos.
func rules() []rule {
	out := []rule{byWorkspace("study_events"), byWorkspace("keyed_rows")}
	for _, table := range study.Tables() {
		out = append(out, byWorkspace(table))
	}
	for _, table := range append(journal.Tables(), grammar.ProgressTables()...) {
		out = append(out, byWorkspace(table))
	}
	return append(out,
		rule{Rule: Rule{Table: "access_tokens"}, del: deleteTokens},
		rule{Rule: Rule{Table: "library_books"}, del: func(ctx context.Context, tx *sql.Tx, d *Deleted, userID, id int64) error {
			books, err := library.DeleteWorkspaceBooks(ctx, tx, userID, id)
			d.Books = books
			return err
		}},
		rule{Rule: Rule{Table: "journal_photos"}, del: func(ctx context.Context, tx *sql.Tx, d *Deleted, userID, id int64) error {
			photos, err := journal.DeleteWorkspacePhotosTx(ctx, tx, userID, id)
			d.Photos = photos
			return err
		}},
		rule{Rule: Rule{Table: "library_deletions", Keep: "the sync log of deleted library rows: the delete of " +
			"the books writes their rows here, so a device that pulls every workspace learns that the books, " +
			"bookmarks and highlights are gone; removed with the user and on a restore"}},
	)
}

// Rules lists the delete rule of every table with a workspace_id column.
func Rules() []Rule {
	var out []Rule
	for _, r := range rules() {
		out = append(out, r.Rule)
	}
	return out
}

// deleteTokens removes the access tokens limited to the workspace (foreign
// keys are off), audited like every other revocation.
func deleteTokens(ctx context.Context, tx *sql.Tx, _ *Deleted, userID, id int64) error {
	res, err := tx.ExecContext(ctx, `DELETE FROM access_tokens WHERE workspace_id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		return auth.Audit(ctx, tx, auth.AuditEvent{Action: "token_revoked", ActorID: userID, TargetID: &userID,
			Detail: map[string]any{"scope": "workspace", "count": n}})
	}
	return nil
}

// Deleted names what a workspace delete removed whose files the caller
// removes after the commit: the library books (their content files) and
// the journal photos.
type Deleted struct {
	Books  []int64
	Photos []string
}

// Delete deletes one of the user's workspaces and everything scoped to it
// (rules) in one transaction. Foreign keys are not enforced in this
// database, so every table is deleted from explicitly; user-scoped data
// (overlays, own sentences, plugin states) is not the workspace's and
// stays. The first statement deletes the workspace row only when the user
// keeps another one: being a write, it takes SQLite's write lock before
// reading, so concurrent deletes serialise and two of them can never
// remove a user's last two workspaces together. Errors: ErrNotFound
// (unknown and foreign ids), ErrLastWorkspace (a user without any would
// get every installed language back as defaults on the next list).
func Delete(ctx context.Context, db *sql.DB, userID, id int64) (Deleted, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return Deleted{}, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `
		DELETE FROM workspaces WHERE id = ?1 AND user_id = ?2
		AND EXISTS (SELECT 1 FROM workspaces WHERE user_id = ?2 AND id <> ?1)`, id, userID)
	if err != nil {
		return Deleted{}, err
	}
	if n, err := res.RowsAffected(); err != nil {
		return Deleted{}, err
	} else if n == 0 {
		owned, err := Owned(ctx, tx, userID, id)
		if err != nil {
			return Deleted{}, err
		}
		if owned {
			return Deleted{}, ErrLastWorkspace
		}
		return Deleted{}, ErrNotFound
	}
	var d Deleted
	for _, r := range rules() {
		if r.del == nil {
			continue // a kept table
		}
		if err := r.del(ctx, tx, &d, userID, id); err != nil {
			return Deleted{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Deleted{}, err
	}
	return d, nil
}
