package backup

import (
	"context"
	crand "crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"

	"qinqin/internal/auth"
)

// Errors a restore reports before it has changed anything.
var (
	ErrUnresolved = errors.New("backup: the archive refers to entries this server does not have; acknowledge dropping them")
	ErrBlocked    = errors.New("backup: the archive cannot be restored on this server")
	ErrUserGone   = errors.New("backup: the account is gone or disabled")
)

// RestoreDeps are the services a restore needs.
type RestoreDeps struct {
	DB      *sql.DB
	DataDir string
	Users   *auth.Users
	Now     func() time.Time // nil: time.Now
}

// Options of one restore.
type Options struct {
	DropUnresolved bool
	// BeforeCommit, when set, runs inside the transaction after the last
	// insert (tests inject a failure here).
	BeforeCommit func(tx *sql.Tx) error
}

// Result is what a finished restore did.
type Result struct {
	Restored           Counts `json:"restored"`
	DroppedRows        int    `json:"droppedRows"`
	ReidentifiedEvents int    `json:"reidentifiedEvents"`
	RevokedSessions    int64  `json:"revokedSessions"`
	SafetyExport       bool   `json:"safetyExport"`
}

func (d RestoreDeps) now() time.Time {
	if d.Now != nil {
		return d.Now()
	}
	return time.Now()
}

// SafetyDir is where a user's pre-restore exports live.
func SafetyDir(dataDir string, userID int64) string {
	return filepath.Join(dataDir, "backups", "pre-restore", strconv.FormatInt(userID, 10))
}

// WriteSafetyExport writes the user's current data to <data>/backups/
// pre-restore/<id>/<ts>.zip (temp file, then rename) and removes the older
// ones: only the newest is kept.
func WriteSafetyExport(ctx context.Context, d RestoreDeps, userID int64) (string, error) {
	dir := SafetyDir(d.DataDir, userID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("backup: safety export dir: %w", err)
	}
	now := d.now().UTC()
	final := filepath.Join(dir, now.Format("20060102-150405.000")+".zip")
	tmp := final + ".part"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", fmt.Errorf("backup: safety export: %w", err)
	}
	_, err = WriteUser(ctx, d.DB, d.DataDir, userID, f, Meta{AppVersion: AppVersion, SchemaVersion: SchemaVersion(ctx, d.DB), Now: now})
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return "", fmt.Errorf("backup: safety export: %w", err)
	}
	if err := os.Rename(tmp, final); err != nil {
		os.Remove(tmp)
		return "", err
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.Name() != filepath.Base(final) {
			os.Remove(filepath.Join(dir, e.Name()))
		}
	}
	return final, nil
}

// LatestSafetyExport returns the newest safety export of the user, if any.
func LatestSafetyExport(dataDir string, userID int64) (string, bool) {
	entries, err := os.ReadDir(SafetyDir(dataDir, userID))
	if err != nil {
		return "", false
	}
	best := ""
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".zip") && e.Name() > best {
			best = e.Name()
		}
	}
	if best == "" {
		return "", false
	}
	return filepath.Join(SafetyDir(dataDir, userID), best), true
}

// SweepSafetyExports removes safety exports older than maxAge.
func SweepSafetyExports(dataDir string, maxAge time.Duration, now time.Time) {
	root := filepath.Join(dataDir, "backups", "pre-restore")
	users, _ := os.ReadDir(root)
	for _, u := range users {
		files, _ := os.ReadDir(filepath.Join(root, u.Name()))
		for _, f := range files {
			info, err := f.Info()
			if err == nil && now.Sub(info.ModTime()) > maxAge {
				os.Remove(filepath.Join(root, u.Name(), f.Name()))
			}
		}
	}
}

func randHex() string {
	var b [8]byte
	crand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// Restore replaces ALL of the user's data with the archive's, in one
// transaction. Order: plan (nothing written), safety export, book files into
// a staging directory, then under the users lock one transaction (guarded
// first statement, every statement on tx), and only after the commit the
// staged files move into place and the old ones go. Account identity is never
// touched; the user's other sessions are revoked (keepSessionID stays).
func Restore(ctx context.Context, d RestoreDeps, userID, keepSessionID int64, a *Archive, opts Options) (Result, Report, error) {
	var res Result
	rep, maps, err := Plan(ctx, d.DB, a, userID)
	if err != nil {
		return res, rep, err
	}
	if len(rep.Blocking) > 0 {
		return res, rep, ErrBlocked
	}
	if (rep.Unresolved.EntryCount > 0 || rep.Unresolved.Sentences > 0) && !opts.DropUnresolved {
		return res, rep, ErrUnresolved
	}
	uid := strconv.FormatInt(userID, 10)
	userBooks := filepath.Join(d.DataDir, "books", uid)
	stage := filepath.Join(userBooks, ".restore-"+randHex())
	cleanStage := func() { os.RemoveAll(stage) }

	var oldBooks []int64
	var committed bool
	// Everything that touches files or rows of the user runs under the lock a
	// deletion holds, taken BEFORE the transaction opens.
	err = d.Users.WithUserLock(func() error {
		var one int
		if err := d.DB.QueryRowContext(ctx, `SELECT 1 FROM users WHERE id = ? AND disabled_at IS NULL`, userID).Scan(&one); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrUserGone
			}
			return err
		}
		if _, err := WriteSafetyExport(ctx, d, userID); err != nil {
			return err
		}
		res.SafetyExport = true
		if len(a.bookFiles) > 0 {
			if err := os.MkdirAll(stage, 0o700); err != nil {
				return fmt.Errorf("backup: stage books: %w", err)
			}
			for id := range a.bookFiles {
				if err := copyBook(a, id, filepath.Join(stage, strconv.FormatInt(id, 10)+".json")); err != nil {
					return err
				}
			}
		}
		tx, err := d.DB.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("backup: begin restore: %w", err)
		}
		defer tx.Rollback()
		ob, err := applyRestore(ctx, tx, d, userID, keepSessionID, a, maps, opts, &res)
		if err != nil {
			return err
		}
		oldBooks = ob
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("backup: commit restore: %w", err)
		}
		committed = true
		// Files follow the commit; a failure here is logged, the database is right.
		for oldID, newID := range maps.Books {
			if !a.bookFiles[oldID] {
				continue
			}
			if err := os.MkdirAll(userBooks, 0o755); err == nil {
				err = os.Rename(filepath.Join(stage, strconv.FormatInt(oldID, 10)+".json"), filepath.Join(userBooks, strconv.FormatInt(newID, 10)+".json"))
				if err != nil {
					log.Printf("restore of user %d: move book %d: %v", userID, newID, err)
				}
			}
		}
		for _, id := range oldBooks {
			if err := os.Remove(filepath.Join(userBooks, strconv.FormatInt(id, 10)+".json")); err != nil && !errors.Is(err, os.ErrNotExist) {
				log.Printf("restore of user %d: remove old book %d: %v", userID, id, err)
			}
		}
		if err := os.RemoveAll(filepath.Join(d.DataDir, "journal", uid)); err != nil {
			log.Printf("restore of user %d: remove journal photos: %v", userID, err)
		}
		return nil
	})
	cleanStage()
	if err != nil && !committed {
		return res, rep, err
	}
	return res, rep, err
}

func copyBook(a *Archive, id int64, dst string) error {
	rc, err := a.OpenBook(id)
	if err != nil {
		return err
	}
	defer rc.Close()
	f, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("backup: stage book %d: %w", id, err)
	}
	if _, err := io.Copy(f, rc); err != nil {
		f.Close()
		return zipErr(err)
	}
	return f.Close()
}

func applyRestore(ctx context.Context, tx *sql.Tx, d RestoreDeps, userID, keepSession int64, a *Archive, m *Maps, opts Options, res *Result) ([]int64, error) {
	now := d.now().UTC().Format(time.RFC3339)
	// 1. guarded first write: a deleted or disabled account aborts.
	r, err := tx.ExecContext(ctx, `UPDATE users SET updated_at = ? WHERE id = ? AND disabled_at IS NULL`, now, userID)
	if err != nil {
		return nil, fmt.Errorf("backup: guard: %w", err)
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return nil, ErrUserGone
	}
	// 2. what goes: collect book ids, then run the registry's own deletion
	// statements for every table that is replaced or dropped.
	var oldBooks []int64
	rs, err := tx.QueryContext(ctx, `SELECT id FROM library_books WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var id int64
		rs.Scan(&id)
		oldBooks = append(oldBooks, id)
	}
	if err := closeRows(rs); err != nil {
		return nil, err
	}
	for _, t := range auth.UserTables() {
		if t.Restore != auth.RestoreReplace && t.Restore != auth.RestoreDrop {
			continue
		}
		for _, stmt := range t.Statements {
			if _, err := tx.ExecContext(ctx, stmt, userID); err != nil {
				return nil, fmt.Errorf("backup: clear %s: %w", t.Name, err)
			}
		}
	}
	// 3. account state: plugin states and the time zone history
	for _, ps := range a.Account.PluginStates {
		en := 0
		if ps.Enabled {
			en = 1
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO plugin_states (user_id, pack_id, enabled, ord, updated_at) VALUES (?, ?, ?, ?, ?)`,
			userID, ps.PluginID, en, ps.Order, now); err != nil {
			return nil, fmt.Errorf("backup: plugin state: %w", err)
		}
	}
	for i, tz := range a.Account.TimeZones {
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_time_zones (user_id, seq, zone, effective_from, created_at) VALUES (?, ?, ?, ?, ?)`,
			userID, i, tz.Zone, tz.From, tz.CreatedAt); err != nil {
			return nil, fmt.Errorf("backup: time zone: %w", err)
		}
	}
	// 4. workspaces (new ids)
	for _, w := range a.Workspaces {
		settings := m.WorkspaceSettings(w.Settings)
		r, err := tx.ExecContext(ctx, `INSERT INTO workspaces (user_id, language, name, settings, updated_at) VALUES (?, ?, ?, ?, ?)`,
			userID, w.Language, w.Name, string(settings), now)
		if err != nil {
			return nil, fmt.Errorf("backup: workspace: %w", err)
		}
		id, _ := r.LastInsertId()
		m.Workspaces[w.ID] = id
		res.Restored.Workspaces++
	}
	// 5. own sentences (new ids), overlays
	insSent, err := tx.PrepareContext(ctx, `INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at) VALUES (?, '', ?, ?, ?, ?, ?)`)
	if err != nil {
		return nil, err
	}
	defer insSent.Close()
	ownSet := map[int64]bool{}
	for _, s := range a.SentRefs {
		if s.Own {
			ownSet[s.ID] = true
			delete(m.Sentences, s.ID)
		}
	}
	if err := a.OwnSentences(func(s OwnSentence) error {
		ne, ok := m.Entries[s.EntryID]
		if !ok {
			res.DroppedRows++
			return nil
		}
		r, err := insSent.ExecContext(ctx, ne, userID, s.Hanzi, s.Pinyin, s.Translation, s.UpdatedAt)
		if err != nil {
			return fmt.Errorf("backup: sentence: %w", err)
		}
		id, _ := r.LastInsertId()
		if ownSet[s.ID] {
			m.Sentences[s.ID] = id
		}
		res.Restored.Sentences++
		return nil
	}); err != nil {
		return nil, err
	}
	if err := a.Overlays(func(o Overlay) error {
		ne, ok := m.Entries[o.EntryID]
		if !ok {
			res.DroppedRows++
			return nil
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_edits (user_id, entry_id, written, readings, updated_at) VALUES (?, ?, ?, ?, ?)`,
			userID, ne, o.Written, o.Readings, o.UpdatedAt); err != nil {
			return fmt.Errorf("backup: overlay: %w", err)
		}
		res.Restored.Overlays++
		return nil
	}); err != nil {
		return nil, err
	}
	// 6. library
	for _, b := range a.Books {
		r, err := tx.ExecContext(ctx, `INSERT INTO library_books (user_id, workspace_id, language, title, author, source, source_id, source_url,
			attribution, license_note, chapter_count, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			userID, m.Workspaces[b.WorkspaceID], b.Language, b.Title, b.Author, b.Source, b.SourceID, b.SourceURL,
			b.Attribution, b.LicenseNote, b.ChapterCount, b.Position, b.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("backup: book: %w", err)
		}
		id, _ := r.LastInsertId()
		m.Books[b.ID] = id
		res.Restored.Books++
	}
	if err := a.Bookmarks(func(b Bookmark) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO library_bookmarks (user_id, book_id, position, label, created_at) VALUES (?, ?, ?, ?, ?)`,
			userID, m.Books[b.BookID], b.Position, b.Label, b.CreatedAt); err != nil {
			return fmt.Errorf("backup: bookmark: %w", err)
		}
		res.Restored.Bookmarks++
		return nil
	}); err != nil {
		return nil, err
	}
	if err := a.Highlights(func(h Highlight) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO library_highlights (user_id, book_id, chapter, paragraph, start_cp, end_cp, text, color, note, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			userID, m.Books[h.BookID], h.Chapter, h.Paragraph, h.StartCP, h.EndCP, h.Text, h.Color, h.Note, h.CreatedAt, h.UpdatedAt); err != nil {
			return fmt.Errorf("backup: highlight: %w", err)
		}
		res.Restored.Highlights++
		return nil
	}); err != nil {
		return nil, err
	}
	// 7. plugin rows: decide every card id first (one pass over the OLD ids), then insert
	m.Cards = map[string]string{}
	if err := a.PluginRows(func(r PluginRow) error {
		if r.PluginID == FlashcardsPlugin && strings.HasPrefix(r.Key, cardKeyPrefix) {
			m.RegisterCard(r.Key, r.Data)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	insRow, err := tx.PrepareContext(ctx, `INSERT INTO plugin_data (pack_id, user_id, workspace_id, key, data, version, updated_at, modified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return nil, err
	}
	defer insRow.Close()
	if err := a.PluginRows(func(r PluginRow) error {
		nr, drop := m.PluginRow(r)
		if drop {
			res.DroppedRows++
			return nil
		}
		var ws any
		if nr.WorkspaceID != nil {
			ws = *nr.WorkspaceID
		}
		// updated_at = now, so every client's delta pull sees the restored row.
		if _, err := insRow.ExecContext(ctx, nr.PluginID, userID, ws, nr.Key, string(nr.Data), nr.Version, now, nr.ModifiedAt); err != nil {
			return fmt.Errorf("backup: plugin row: %w", err)
		}
		res.Restored.PluginData++
		if nr.PluginID == FlashcardsPlugin && strings.HasPrefix(nr.Key, cardKeyPrefix) {
			res.Restored.Cards++
		}
		return nil
	}); err != nil {
		return nil, err
	}
	// 8. events: ids are kept; an id owned by another user is re-identified with a new ULID of the same millisecond
	insEv, err := tx.PrepareContext(ctx, `INSERT INTO study_events (id, user_id, workspace_id, device, ts, type, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (id) DO NOTHING`)
	if err != nil {
		return nil, err
	}
	defer insEv.Close()
	if err := a.Events(func(e Event) error {
		ne, drop := m.Event(e)
		if drop {
			res.DroppedRows++
			return nil
		}
		r, err := insEv.ExecContext(ctx, ne.ID, userID, ne.WorkspaceID, ne.Device, ne.TS, ne.Type, string(ne.Payload), ne.UpdatedAt)
		if err != nil {
			return fmt.Errorf("backup: event: %w", err)
		}
		if n, _ := r.RowsAffected(); n == 0 {
			var owner int64
			if err := tx.QueryRowContext(ctx, `SELECT user_id FROM study_events WHERE id = ?`, ne.ID).Scan(&owner); err != nil {
				return err
			}
			if owner == userID {
				return nil // the same event twice in the archive: once is enough
			}
			parsed, perr := ulid.ParseStrict(ne.ID)
			if perr != nil {
				return perr
			}
			newID, merr := ulid.New(parsed.Time(), crand.Reader)
			if merr != nil {
				return merr
			}
			if _, err := insEv.ExecContext(ctx, newID.String(), userID, ne.WorkspaceID, ne.Device, ne.TS, ne.Type, string(ne.Payload), ne.UpdatedAt); err != nil {
				return fmt.Errorf("backup: event: %w", err)
			}
			res.ReidentifiedEvents++
		}
		res.Restored.Events++
		return ctx.Err()
	}); err != nil {
		return nil, err
	}
	// 9. other devices must reload instead of pushing stale rows into the restored state
	rv, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE user_id = ? AND id <> ?`, userID, keepSession)
	if err != nil {
		return nil, fmt.Errorf("backup: revoke sessions: %w", err)
	}
	res.RevokedSessions, _ = rv.RowsAffected()
	if err := auth.Audit(ctx, tx, auth.AuditEvent{Action: "data_restored", ActorID: userID, TargetID: &userID,
		Detail: map[string]any{"count": res.Restored.Events, "revoked": res.RevokedSessions}}); err != nil {
		return nil, err
	}
	if opts.BeforeCommit != nil {
		if err := opts.BeforeCommit(tx); err != nil {
			return nil, err
		}
	}
	return oldBooks, nil
}
