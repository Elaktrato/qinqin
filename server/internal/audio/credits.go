package audio

import (
	"context"
	"database/sql"
	"errors"
)

// PackInfo is one installed audio pack with its clip count, for the
// Sources page.
type PackInfo struct {
	PackID, Name, Version, Language, License, Attribution, Notice string
	ClipCount                                                     int
}

// Packs returns the installed audio packs in install order, never nil.
func Packs(ctx context.Context, sqlDB *sql.DB) ([]PackInfo, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT p.pack_id, p.name, p.version, p.language, p.license, p.attribution, p.notice,
			(SELECT COUNT(*) FROM audio_clips c WHERE c.pack_id = p.id)
		FROM audio_packs p WHERE p.deleted_at IS NULL ORDER BY p.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PackInfo{}
	for rows.Next() {
		var p PackInfo
		if err := rows.Scan(&p.PackID, &p.Name, &p.Version, &p.Language, &p.License, &p.Attribution, &p.Notice, &p.ClipCount); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Credit is the credit of one recording: text fields only, no clip file.
type Credit struct {
	Kind, Form, Reading, License, Attribution, Source string
}

// CreditsPage is one page of a pack's credits: the pack's clip count, the
// offset and limit used, and the credits in clip order (never nil).
type CreditsPage struct {
	Total, Offset, Limit int
	Credits              []Credit
}

// MaxCreditsLimit caps the page size of Credits.
const MaxCreditsLimit = 500

// Credits returns a page of the per-recording credits of an installed pack,
// limit capped at MaxCreditsLimit; ErrPackNotFound for a pack that is not
// installed. offset is at least 0 and limit at least 1 (the caller checks
// its input).
func Credits(ctx context.Context, sqlDB *sql.DB, packID string, offset, limit int) (CreditsPage, error) {
	limit = min(limit, MaxCreditsLimit)
	var packRow int64
	err := sqlDB.QueryRowContext(ctx, `SELECT id FROM audio_packs WHERE pack_id = ? AND deleted_at IS NULL`, packID).Scan(&packRow)
	if errors.Is(err, sql.ErrNoRows) {
		return CreditsPage{}, ErrPackNotFound
	}
	if err != nil {
		return CreditsPage{}, err
	}
	page := CreditsPage{Offset: offset, Limit: limit, Credits: []Credit{}}
	if err := sqlDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM audio_clips WHERE pack_id = ?`, packRow).Scan(&page.Total); err != nil {
		return CreditsPage{}, err
	}
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT kind, form, reading_key, license, attribution, source
		FROM audio_clips WHERE pack_id = ? ORDER BY id LIMIT ? OFFSET ?`, packRow, limit, offset)
	if err != nil {
		return CreditsPage{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var c Credit
		if err := rows.Scan(&c.Kind, &c.Form, &c.Reading, &c.License, &c.Attribution, &c.Source); err != nil {
			return CreditsPage{}, err
		}
		page.Credits = append(page.Credits, c)
	}
	return page, rows.Err()
}

// ClipActive reports whether an installed pack references the clip with
// this SHA-256 and extension, so it may be served.
func ClipActive(ctx context.Context, sqlDB *sql.DB, sha, ext string) (bool, error) {
	var one int
	err := sqlDB.QueryRowContext(ctx, `
		SELECT 1 FROM audio_clips c JOIN audio_packs p ON p.id = c.pack_id
		WHERE c.sha256 = ? AND c.ext = ? AND p.deleted_at IS NULL LIMIT 1`, sha, ext).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
