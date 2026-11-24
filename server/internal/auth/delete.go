package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
)

// ExportMode is the backup decision for a user table (the personal export
// of the backup design iterates the same registry, so a new user table
// cannot be forgotten by either feature).
type ExportMode int

const (
	ExportUnset ExportMode = iota // the schema guard fails on this
	ExportRows                    // the rows belong in a personal export
	ExportSkip                    // not exported; Reason says why
)

// RestoreMode is what restoring a personal backup does to a user table.
type RestoreMode int

const (
	RestoreUnset   RestoreMode = iota // the schema guard fails on this
	RestoreReplace                    // the user's rows are replaced by the archive's
	RestoreDrop                       // the user's rows are removed, nothing is restored (drafts)
	RestoreKeep                       // untouched: account identity and security data
)

// UserTable is one table that references a user: how deleting the user
// treats it, how the deletion preview counts it, and whether a personal
// export carries it.
type UserTable struct {
	Name string
	// Columns are the user-reference columns of the table (user_id,
	// created_by, updated_by, actor_id, target_id, workspace_id): the guard test requires
	// every such column of every table to be named by exactly one entry.
	Columns []string
	// Statements run in order inside the deletion transaction; ?1 is the
	// user's id. The list is empty for a table the deletion leaves alone
	// (and for a kept table whose rows are anonymised elsewhere).
	Statements []string
	// PreviewKey and Count: the preview field this table feeds and the
	// query (?1 = user id) that counts what goes.
	PreviewKey, Count string
	Export            ExportMode
	ExportReason      string // for ExportSkip
	// Restore decides what a restore does with the table; account state is
	// never resurrected from an archive (RestoreKeep).
	Restore RestoreMode
}

const (
	skipSecurity = "security or account data: never part of a personal export"
	skipDraft    = "temporary drafts"
)

// userTables lists every table whose rows are REMOVED with the user.
var userTables = []UserTable{
	{Name: "workspaces", Columns: []string{"user_id"}, Statements: []string{`DELETE FROM workspaces WHERE user_id = ?1`},
		PreviewKey: "workspaces", Count: `SELECT COUNT(*) FROM workspaces WHERE user_id = ?1`, Export: ExportRows, Restore: RestoreReplace},
	{Name: "study_events", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM study_events WHERE user_id = ?1`},
		PreviewKey: "studyEvents", Count: `SELECT COUNT(*) FROM study_events WHERE user_id = ?1`, Export: ExportRows, Restore: RestoreReplace},
	{Name: "feature_switches", Columns: []string{"user_id"}, Statements: []string{`DELETE FROM feature_switches WHERE user_id = ?1`}, Export: ExportRows, Restore: RestoreReplace},
	{Name: "keyed_rows", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM keyed_rows WHERE user_id = ?1`},
		PreviewKey: "keyedRows", Count: `SELECT COUNT(*) FROM keyed_rows WHERE user_id = ?1 AND deleted_at IS NULL`, Export: ExportRows, Restore: RestoreReplace},
	{Name: "user_edits", Columns: []string{"user_id"}, Statements: []string{`DELETE FROM user_edits WHERE user_id = ?1`},
		PreviewKey: "overlays", Count: `SELECT COUNT(*) FROM user_edits WHERE user_id = ?1`, Export: ExportRows, Restore: RestoreReplace},
	{Name: "sentences", Columns: []string{"user_id"}, Statements: []string{`DELETE FROM sentences WHERE user_id = ?1`},
		PreviewKey: "sentences", Count: `SELECT COUNT(*) FROM sentences WHERE user_id = ?1 AND deleted_at IS NULL`, Export: ExportRows, Restore: RestoreReplace},
	{Name: "library_books", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM library_books WHERE user_id = ?1`},
		PreviewKey: "books", Count: `SELECT COUNT(*) FROM library_books WHERE user_id = ?1`, Export: ExportRows, Restore: RestoreReplace},
	{Name: "library_bookmarks", Columns: []string{"user_id"}, Statements: []string{`DELETE FROM library_bookmarks WHERE user_id = ?1`}, Export: ExportRows, Restore: RestoreReplace},
	{Name: "library_highlights", Columns: []string{"user_id"}, Statements: []string{`DELETE FROM library_highlights WHERE user_id = ?1`}, Export: ExportRows, Restore: RestoreReplace},
	// Typed study rows (migration 038): exported in their keyed form,
	// replaced on restore.
	{Name: "study_cards", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM study_cards WHERE user_id = ?1`},
		PreviewKey: "cards", Count: `SELECT COUNT(*) FROM study_cards WHERE user_id = ?1 AND deleted_at IS NULL`, Export: ExportRows, Restore: RestoreReplace},
	{Name: "study_decks", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM study_decks WHERE user_id = ?1`}, Export: ExportRows, Restore: RestoreReplace},
	{Name: "study_deck_settings", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM study_deck_settings WHERE user_id = ?1`}, Export: ExportRows, Restore: RestoreReplace},
	{Name: "study_limits", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM study_limits WHERE user_id = ?1`}, Export: ExportRows, Restore: RestoreReplace},
	{Name: "study_fsrs_sets", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM study_fsrs_sets WHERE user_id = ?1`}, Export: ExportRows, Restore: RestoreReplace},
	{Name: "study_fsrs_active", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM study_fsrs_active WHERE user_id = ?1`}, Export: ExportRows, Restore: RestoreReplace},
	// The library deletion log is sync bookkeeping: never exported, removed
	// with the user and on a restore (clients do a full pull after one).
	{Name: "library_deletions", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM library_deletions WHERE user_id = ?1`},
		Export: ExportSkip, ExportReason: "sync bookkeeping (deletion log); clients pull in full after a restore", Restore: RestoreDrop},
	{Name: "user_time_zones", Columns: []string{"user_id"}, Statements: []string{`DELETE FROM user_time_zones WHERE user_id = ?1`}, Export: ExportRows, Restore: RestoreReplace},
	// The journal's documents (migration 044): exported in their keyed form,
	// replaced on restore.
	{Name: "journal_entries", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM journal_entries WHERE user_id = ?1`},
		PreviewKey: "journalEntries", Count: `SELECT COUNT(*) FROM journal_entries WHERE user_id = ?1`, Export: ExportRows, Restore: RestoreReplace},
	{Name: "journal_reviews", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM journal_reviews WHERE user_id = ?1`}, Export: ExportRows, Restore: RestoreReplace},
	{Name: "journal_suggestions", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM journal_suggestions WHERE user_id = ?1`}, Export: ExportRows, Restore: RestoreReplace},
	{Name: "journal_settings", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM journal_settings WHERE user_id = ?1`}, Export: ExportRows, Restore: RestoreReplace},
	// The conversations of the partner (migration 048, #185): one keyed document per conversation.
	{Name: "journal_conversations", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM journal_conversations WHERE user_id = ?1`},
		PreviewKey: "journalConversations", Count: `SELECT COUNT(*) FROM journal_conversations WHERE user_id = ?1`, Export: ExportRows, Restore: RestoreReplace},
	{Name: "journal_messages", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM journal_messages WHERE user_id = ?1`}, Export: ExportRows, Restore: RestoreReplace},
	// Grammar lesson progress (migration 045): exported in its keyed form, replaced on restore.
	{Name: "grammar_progress", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM grammar_progress WHERE user_id = ?1`}, Export: ExportRows, Restore: RestoreReplace},
	{Name: "journal_photos", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM journal_photos WHERE user_id = ?1`},
		PreviewKey: "journalPhotos", Count: `SELECT COUNT(*) FROM journal_photos WHERE user_id = ?1`, Export: ExportSkip, ExportReason: skipDraft, Restore: RestoreDrop},
	{Name: "ai_keys", Columns: []string{"user_id"}, Statements: []string{`DELETE FROM ai_keys WHERE user_id = ?1`},
		PreviewKey: "aiKeys", Count: `SELECT COUNT(*) FROM ai_keys WHERE user_id = ?1`, Export: ExportSkip, ExportReason: skipSecurity, Restore: RestoreKeep},
	{Name: "ai_selection", Columns: []string{"user_id"}, Statements: []string{`DELETE FROM ai_selection WHERE user_id = ?1`}, Export: ExportSkip, ExportReason: skipSecurity, Restore: RestoreKeep},
	{Name: "ai_calls", Columns: []string{"user_id"}, Statements: []string{`DELETE FROM ai_calls WHERE user_id = ?1`}, Export: ExportSkip, ExportReason: skipSecurity, Restore: RestoreKeep},
	{Name: "sessions", Columns: []string{"user_id"}, Statements: []string{`DELETE FROM sessions WHERE user_id = ?1`},
		PreviewKey: "sessions", Count: `SELECT COUNT(*) FROM sessions WHERE user_id = ?1`, Export: ExportSkip, ExportReason: skipSecurity, Restore: RestoreKeep},
	// Personal access tokens (only their hashes are stored): never exported,
	// kept on a personal restore (a restore is not a security action).
	{Name: "access_tokens", Columns: []string{"user_id", "workspace_id"}, Statements: []string{`DELETE FROM access_tokens WHERE user_id = ?1`},
		PreviewKey: "accessTokens", Count: `SELECT COUNT(*) FROM access_tokens WHERE user_id = ?1`, Export: ExportSkip, ExportReason: skipSecurity, Restore: RestoreKeep},
	// Reset links of the user go; links the user issued for others stay,
	// without the issuer.
	{Name: "password_resets", Columns: []string{"user_id", "created_by"},
		Statements: []string{`DELETE FROM password_resets WHERE user_id = ?1`, `UPDATE password_resets SET created_by = NULL WHERE created_by = ?1`},
		Export:     ExportSkip, ExportReason: skipSecurity, Restore: RestoreKeep},
	// Invites the user handed out go with them (a pending link stops working).
	{Name: "invites", Columns: []string{"created_by"}, Statements: []string{`DELETE FROM invites WHERE created_by = ?1`},
		Export: ExportSkip, ExportReason: skipSecurity, Restore: RestoreKeep},
	// Two-factor data and pending one-time-code challenges: secrets, never exported.
	{Name: "mfa_totp", Columns: []string{"user_id"}, Statements: []string{`DELETE FROM mfa_totp WHERE user_id = ?1`},
		Export: ExportSkip, ExportReason: skipSecurity, Restore: RestoreKeep},
	{Name: "mfa_recovery_codes", Columns: []string{"user_id"}, Statements: []string{`DELETE FROM mfa_recovery_codes WHERE user_id = ?1`},
		Export: ExportSkip, ExportReason: skipSecurity, Restore: RestoreKeep},
	{Name: "auth_challenges", Columns: []string{"user_id"}, Statements: []string{`DELETE FROM auth_challenges WHERE user_id = ?1`},
		Export: ExportSkip, ExportReason: skipSecurity, Restore: RestoreKeep},
}

// keptTables lists the tables that reference a user but outlive them,
// with what happens to the reference.
var keptTables = []UserTable{
	// Shared by every user: an admin-registered AI endpoint stays, its
	// creator becomes "nobody" (0).
	{Name: "ai_custom_providers", Columns: []string{"created_by"}, Statements: []string{`UPDATE ai_custom_providers SET created_by = 0 WHERE created_by = ?1`},
		Export: ExportSkip, ExportReason: "shared by every user", Restore: RestoreKeep},
	{Name: "auth_settings", Columns: []string{"updated_by"}, Statements: []string{`UPDATE auth_settings SET updated_by = NULL WHERE updated_by = ?1`},
		Export: ExportSkip, ExportReason: "instance settings", Restore: RestoreKeep},
	{Name: "smtp_settings", Columns: []string{"updated_by"}, Statements: []string{`UPDATE smtp_settings SET updated_by = NULL WHERE updated_by = ?1`},
		Export: ExportSkip, ExportReason: "instance settings", Restore: RestoreKeep},
	// The audit log keeps its rows; the user's name in them is replaced
	// (see DeleteUser).
	{Name: "auth_audit", Columns: []string{"actor_id", "target_id"}, Export: ExportSkip, ExportReason: skipSecurity, Restore: RestoreKeep},
}

// UserDirs are the per-user directories under the data directory that the
// deletion removes after the commit.
// "backups/pre-restore" holds the safety exports a restore writes first.
var UserDirs = []string{"books", "journal", "backups/pre-restore"}

// UserTables returns the registry (deleted, then kept) for features that
// must make the same per-table decision, such as the personal export.
func UserTables() []UserTable {
	return append(append([]UserTable{}, userTables...), keptTables...)
}

// Preview is what deleting a user would remove, as counts.
type Preview struct {
	Workspaces           int `json:"workspaces"`
	StudyEvents          int `json:"studyEvents"`
	KeyedRows            int `json:"keyedRows"`
	Cards                int `json:"cards"`
	Books                int `json:"books"`
	JournalEntries       int `json:"journalEntries"`
	JournalConversations int `json:"journalConversations"`
	JournalPhotos        int `json:"journalPhotos"`
	AIKeys               int `json:"aiKeys"`
	Sessions             int `json:"sessions"`
	Overlays             int `json:"overlays"`
	Sentences            int `json:"sentences"`
	AccessTokens         int `json:"accessTokens"`
}

// DeletionPreview counts what DeleteUser would remove, from the same
// registry, so the dialog cannot promise something the delete does not do.
func DeletionPreview(ctx context.Context, sqlDB *sql.DB, id int64) (Preview, error) {
	var exists int
	if err := sqlDB.QueryRowContext(ctx, `SELECT 1 FROM users WHERE id = ?`, id).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
		return Preview{}, ErrUserNotFound
	} else if err != nil {
		return Preview{}, fmt.Errorf("read user: %w", err)
	}
	var p Preview
	fields := map[string]*int{"workspaces": &p.Workspaces, "studyEvents": &p.StudyEvents, "keyedRows": &p.KeyedRows, "cards": &p.Cards,
		"books": &p.Books, "journalEntries": &p.JournalEntries, "journalConversations": &p.JournalConversations, "journalPhotos": &p.JournalPhotos, "aiKeys": &p.AIKeys, "sessions": &p.Sessions,
		"overlays": &p.Overlays, "sentences": &p.Sentences, "accessTokens": &p.AccessTokens}
	for _, t := range userTables {
		if t.PreviewKey == "" {
			continue
		}
		dst, ok := fields[t.PreviewKey]
		if !ok {
			return Preview{}, fmt.Errorf("preview key %q of %s has no field", t.PreviewKey, t.Name)
		}
		if err := sqlDB.QueryRowContext(ctx, t.Count, id).Scan(dst); err != nil {
			return Preview{}, fmt.Errorf("count %s: %w", t.Name, err)
		}
	}
	return p, nil
}

// DeleteUser removes the user and everything personal in ONE transaction
// whose first statement is the guarded delete of the users row (the last
// active administrator cannot go: ErrLastAdmin, nothing deleted). Every
// statement runs on tx. Files follow after the commit (a failure is logged,
// not fatal, like workspace deletion), and the audit log keeps its rows
// with the user's name replaced by "deleted user #<id>". actorID == id is a
// self-deletion (action account_deleted).
func (u *Users) DeleteUser(ctx context.Context, actorID, id int64, dataDir string) error {
	u.mu.Lock()
	defer u.mu.Unlock()
	tx, err := u.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete user: %w", err)
	}
	defer tx.Rollback()
	// A disabled administrator is not counted as one, so removing them never
	// endangers the rule; everybody else may go as long as an active admin stays.
	res, err := tx.ExecContext(ctx, `
		DELETE FROM users WHERE id = ?1
		AND (admin = 0 OR disabled_at IS NOT NULL OR EXISTS (SELECT 1 FROM users WHERE id <> ?1 AND admin = 1 AND disabled_at IS NULL))`, id)
	if err != nil {
		return fmt.Errorf("delete user row: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		var one int
		if err := tx.QueryRowContext(ctx, `SELECT 1 FROM users WHERE id = ?`, id).Scan(&one); errors.Is(err, sql.ErrNoRows) {
			return ErrUserNotFound
		} else if err != nil {
			return fmt.Errorf("read user: %w", err)
		}
		return ErrLastAdmin
	}
	for _, t := range append(append([]UserTable{}, userTables...), keptTables...) {
		for _, stmt := range t.Statements {
			if _, err := tx.ExecContext(ctx, stmt, id); err != nil {
				return fmt.Errorf("delete from %s: %w", t.Name, err)
			}
		}
	}
	action := "user_deleted"
	if actorID == id {
		action = "account_deleted"
	}
	if err := Audit(ctx, tx, AuditEvent{Action: action, ActorID: actorID, TargetID: &id}); err != nil {
		return err
	}
	gone := "deleted user #" + strconv.FormatInt(id, 10)
	if _, err := tx.ExecContext(ctx, `UPDATE auth_audit SET actor_name = ?1 WHERE actor_id = ?2`, gone, id); err != nil {
		return fmt.Errorf("anonymise audit actor: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE auth_audit SET target_name = ?1 WHERE target_id = ?2`, gone, id); err != nil {
		return fmt.Errorf("anonymise audit target: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit delete user: %w", err)
	}
	for _, dir := range UserDirs {
		if err := os.RemoveAll(filepath.Join(dataDir, dir, strconv.FormatInt(id, 10))); err != nil {
			log.Printf("delete user %d: remove %s files: %v", id, dir, err)
		}
	}
	return nil
}

// SweepOrphanUserDirs removes the per-user directories (UserDirs) of user
// ids that no longer exist: a deletion whose file removal failed, or a
// request that wrote a file just after the commit, leaves one behind. Names
// that are not plain numbers are left alone. It returns how many it removed.
func SweepOrphanUserDirs(ctx context.Context, sqlDB *sql.DB, dataDir string) (int, error) {
	removed := 0
	for _, dir := range UserDirs {
		entries, err := os.ReadDir(filepath.Join(dataDir, dir))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return removed, fmt.Errorf("list %s: %w", dir, err)
		}
		for _, e := range entries {
			id, perr := strconv.ParseInt(e.Name(), 10, 64)
			if perr != nil || !e.IsDir() || strconv.FormatInt(id, 10) != e.Name() {
				continue
			}
			var one int
			err := sqlDB.QueryRowContext(ctx, `SELECT 1 FROM users WHERE id = ?`, id).Scan(&one)
			if err == nil {
				continue
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return removed, fmt.Errorf("check user %d: %w", id, err)
			}
			if err := os.RemoveAll(filepath.Join(dataDir, dir, e.Name())); err != nil {
				log.Printf("sweep: remove %s/%s: %v", dir, e.Name(), err)
				continue
			}
			removed++
		}
	}
	return removed, nil
}
