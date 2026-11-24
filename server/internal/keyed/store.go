package keyed

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"qinqin/internal/model"
)

// NoWorkspace is the value the keyed_rows unique key (migration 046) gives a
// NULL workspace_id: IFNULL(workspace_id, 0). It is why no real workspace id
// may be 0, and why queries that must hit that index spell the same literal.
const NoWorkspace = 0

// uniqueWorkspace is the index expression.
var uniqueWorkspace = "IFNULL(workspace_id, " + strconv.Itoa(NoWorkspace) + ")"

const selectCols = `SELECT key, user_id, workspace_id, data, version, updated_at, deleted_at FROM keyed_rows`

func now() string { return time.Now().UTC().Format(time.RFC3339) }

func scopeArgs(query string, args []any, workspace *int64) (string, []any) {
	if workspace == nil {
		return query + ` AND workspace_id IS NULL`, args
	}
	return query + ` AND workspace_id = ?`, append(args, *workspace)
}

// Put stores the value of one key (Check decides whether it may be), bumps
// the row's version, stamps updated_at and revives a tombstone; the first
// write is version 1. modifiedAt is when the edit happened (the clock last
// write wins compares); nil or the zero time means now. It answers the row
// this very statement wrote.
func Put(ctx context.Context, sqlDB *sql.DB, userID int64, workspace *int64, key string, data json.RawMessage, modifiedAt *time.Time) (*model.KeyedRow, error) {
	if err := Check(key, workspace); err != nil {
		return nil, err
	}
	var ws any
	if workspace != nil {
		if *workspace <= NoWorkspace {
			return nil, fmt.Errorf("keyed: put %s: invalid workspace id %d", key, *workspace)
		}
		ws = *workspace
	}
	stamp := now()
	modified := stamp
	if modifiedAt != nil && !modifiedAt.IsZero() {
		modified = modifiedAt.UTC().Format(time.RFC3339)
	}
	value := "null"
	if len(data) > 0 {
		value = string(data)
	}
	r, err := scan(sqlDB.QueryRowContext(ctx, `
		INSERT INTO keyed_rows (user_id, workspace_id, key, data, version, updated_at, modified_at)
		VALUES (?, ?, ?, ?, 1, ?, ?)
		ON CONFLICT (user_id, `+uniqueWorkspace+`, key) DO UPDATE SET
			data = excluded.data, version = keyed_rows.version + 1,
			updated_at = excluded.updated_at, modified_at = excluded.modified_at, deleted_at = NULL
		RETURNING key, user_id, workspace_id, data, version, updated_at, deleted_at`,
		userID, ws, key, value, stamp, modified))
	if err != nil {
		return nil, fmt.Errorf("keyed: put %s for user %d: %w", key, userID, err)
	}
	return r, nil
}

// Get returns the live row of one key in the scope (nil = user-global), or
// ErrNotFound.
func Get(ctx context.Context, sqlDB *sql.DB, userID int64, workspace *int64, key string) (*model.KeyedRow, error) {
	q, args := scopeArgs(selectCols+` WHERE user_id = ? AND key = ? AND deleted_at IS NULL`, []any{userID, key}, workspace)
	r, err := scan(sqlDB.QueryRowContext(ctx, q, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("keyed: get %s for user %d: %w", key, userID, err)
	}
	return r, nil
}

// List returns the live rows of the scope whose key starts with prefix
// (compared literally), ordered by key; never nil.
func List(ctx context.Context, sqlDB *sql.DB, userID int64, workspace *int64, prefix string) ([]model.KeyedRow, error) {
	q, args := scopeArgs(selectCols+` WHERE user_id = ? AND deleted_at IS NULL AND substr(key, 1, ?) = ?`,
		[]any{userID, len([]rune(prefix)), prefix}, workspace)
	rows, err := sqlDB.QueryContext(ctx, q+` ORDER BY key`, args...)
	if err != nil {
		return nil, fmt.Errorf("keyed: list for user %d: %w", userID, err)
	}
	defer rows.Close()
	out := make([]model.KeyedRow, 0)
	for rows.Next() {
		r, err := scan(rows)
		if err != nil {
			return nil, fmt.Errorf("keyed: scan for user %d: %w", userID, err)
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// Each streams the user's rows changed since since (inclusive), tombstones
// included unless liveOnly, ordered by stamp then key.
func Each(ctx context.Context, sqlDB *sql.DB, userID int64, since time.Time, liveOnly bool, fn func(*model.KeyedRow) error) error {
	live := ""
	if liveOnly {
		live = " AND deleted_at IS NULL"
	}
	rows, err := sqlDB.QueryContext(ctx, selectCols+` WHERE user_id = ? AND updated_at >= ?`+live+` ORDER BY updated_at, key`,
		userID, since.UTC().Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("keyed: rows of user %d: %w", userID, err)
	}
	defer rows.Close()
	for rows.Next() {
		r, err := scan(rows)
		if err != nil {
			return fmt.Errorf("keyed: scan for user %d: %w", userID, err)
		}
		if err := fn(r); err != nil {
			return err
		}
	}
	return rows.Err()
}

// Delete tombstones the live row of one key, stamping updated_at so a pull
// since before sees the deletion; modifiedAt is when it happened (zero =
// now). A missing or already deleted row is ErrNotFound.
func Delete(ctx context.Context, sqlDB *sql.DB, userID int64, workspace *int64, key string, modifiedAt time.Time) error {
	stamp := now()
	modified := stamp
	if !modifiedAt.IsZero() {
		modified = modifiedAt.UTC().Format(time.RFC3339)
	}
	q, args := scopeArgs(`UPDATE keyed_rows SET deleted_at = ?, updated_at = ?, modified_at = ? WHERE user_id = ? AND key = ? AND deleted_at IS NULL`,
		[]any{stamp, stamp, modified, userID, key}, workspace)
	res, err := sqlDB.ExecContext(ctx, q, args...)
	if err != nil {
		return fmt.Errorf("keyed: delete %s for user %d: %w", key, userID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("keyed: delete %s for user %d: %w", key, userID, err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// EditTime is when the client made the edit a pushed row carries: its
// updatedAt, or its deletedAt when that is later. Zero when it has neither.
func EditTime(row model.KeyedRow) time.Time {
	t := row.UpdatedAt
	if row.DeletedAt != nil && row.DeletedAt.After(t) {
		t = *row.DeletedAt
	}
	return t.UTC()
}

// Apply applies one pushed row under last write wins on edit time — the
// client's clock, clamped to the server's so a clock running ahead cannot pin
// a row — and reports whether it changed the server. It compares against the
// stored edit time (modified_at), at second precision: a same-second write
// wins. A deletion of an absent or deleted row changes nothing. The caller
// checks the key (Check) first.
func Apply(ctx context.Context, sqlDB *sql.DB, userID int64, row model.KeyedRow) (bool, error) {
	edited := EditTime(row)
	if n := time.Now().UTC(); edited.After(n) {
		edited = n
	}
	var ws any
	if row.WorkspaceID != nil {
		ws = *row.WorkspaceID
	}
	var stored string
	var deleted sql.NullString
	err := sqlDB.QueryRowContext(ctx, `SELECT modified_at, deleted_at FROM keyed_rows
		WHERE user_id = ? AND `+uniqueWorkspace+` = IFNULL(?, `+strconv.Itoa(NoWorkspace)+`) AND key = ?`,
		userID, ws, row.Key).Scan(&stored, &deleted)
	exists := !errors.Is(err, sql.ErrNoRows)
	if err != nil && exists {
		return false, fmt.Errorf("keyed: read %s: %w", row.Key, err)
	}
	if exists {
		server, err := time.Parse(time.RFC3339, stored)
		if err != nil {
			return false, fmt.Errorf("keyed: parse modified_at %q of %s: %w", stored, row.Key, err)
		}
		if server.After(edited.Truncate(time.Second)) {
			return false, nil
		}
	}
	if row.DeletedAt != nil {
		if !exists || deleted.Valid {
			return false, nil
		}
		if err := Delete(ctx, sqlDB, userID, row.WorkspaceID, row.Key, edited); err != nil {
			return false, err
		}
		return true, nil
	}
	if _, err := Put(ctx, sqlDB, userID, row.WorkspaceID, row.Key, row.Data, &edited); err != nil {
		return false, err
	}
	return true, nil
}

type scanner interface{ Scan(...any) error }

func scan(row scanner) (*model.KeyedRow, error) {
	var (
		r             model.KeyedRow
		ws            sql.NullInt64
		data, updated string
		deleted       sql.NullString
	)
	if err := row.Scan(&r.Key, &r.UserID, &ws, &data, &r.Version, &updated, &deleted); err != nil {
		return nil, err
	}
	t, err := time.Parse(time.RFC3339, updated)
	if err != nil {
		return nil, fmt.Errorf("keyed: parse updated_at %q of %s: %w", updated, r.Key, err)
	}
	r.UpdatedAt = t
	if ws.Valid {
		id := ws.Int64
		r.WorkspaceID = &id
	}
	if deleted.Valid {
		d, err := time.Parse(time.RFC3339, deleted.String)
		if err != nil {
			return nil, fmt.Errorf("keyed: parse deleted_at %q of %s: %w", deleted.String, r.Key, err)
		}
		r.DeletedAt = &d
	}
	r.Data = json.RawMessage(data)
	return &r, nil
}
