package packs

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"qinqin/internal/pack"
)

// A pack's licence texts: its LICENSE*, LICENCE*, ATTRIBUTION*, NOTICE* and
// COPYING* files (any case), kept verbatim in pack_texts at import so data
// packages can carry them (docs/contracts/packages/). Only regular files at
// the pack root count; a file above MaxTextBytes, one that is not valid
// UTF-8, and candidates beyond MaxTexts (in name order) are skipped and
// logged. The row with the empty name is a marker: the texts of this pack
// were collected (a pack may ship none). A pack imported before the server
// kept texts has no rows at all.
const (
	MaxTextBytes = 256 << 10
	MaxTexts     = 8
)

// Text is one stored licence file of a pack.
type Text struct{ Name, Text string }

// Querier is what Texts and TextsStored read through (*sql.DB or *sql.Tx).
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// logf logs skipped licence files; tests swap it.
var logf = log.Printf

var textPrefixes = []string{"license", "licence", "attribution", "notice", "copying"}

// collectedMarker is the name of the row that says the texts of a pack were
// collected; no file name is empty.
const collectedMarker = ""

// isTextCandidate reports whether a file name looks like a licence file.
func isTextCandidate(name string) bool {
	lower := strings.ToLower(name)
	for _, p := range textPrefixes {
		if strings.HasPrefix(lower, p) {
			return true
		}
	}
	return false
}

// StoreTexts replaces the stored licence texts of pack (typ, packID) with
// the licence files in dir and returns how many it stored. It reads the
// files first and writes in tx; it never follows a symlink.
func StoreTexts(ctx context.Context, tx *sql.Tx, typ, packID, dir string) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, fmt.Errorf("packs: read licence texts of %s %s: %w", typ, packID, err)
	}
	var keep []Text
	for _, e := range entries { // os.ReadDir sorts by name
		name := e.Name()
		if !isTextCandidate(name) {
			continue
		}
		if !e.Type().IsRegular() {
			logf("pack %s: licence file %s skipped: not a regular file", packID, name)
			continue
		}
		info, err := e.Info()
		if err != nil {
			logf("pack %s: licence file %s skipped: %v", packID, name, err)
			continue
		}
		if info.Size() > MaxTextBytes {
			logf("pack %s: licence file %s skipped: %d bytes, more than %d", packID, name, info.Size(), MaxTextBytes)
			continue
		}
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			logf("pack %s: licence file %s skipped: %v", packID, name, err)
			continue
		}
		if len(b) > MaxTextBytes { // grew since the stat
			logf("pack %s: licence file %s skipped: more than %d bytes", packID, name, MaxTextBytes)
			continue
		}
		if !utf8.Valid(b) {
			logf("pack %s: licence file %s skipped: not valid UTF-8", packID, name)
			continue
		}
		if len(keep) == MaxTexts {
			logf("pack %s: licence file %s skipped: more than %d licence files", packID, name, MaxTexts)
			continue
		}
		keep = append(keep, Text{Name: name, Text: string(b)})
	}

	if err := deleteTexts(ctx, tx, typ, packID); err != nil {
		return 0, err
	}
	for _, t := range append([]Text{{Name: collectedMarker}}, keep...) {
		if _, err := tx.ExecContext(ctx, `INSERT INTO pack_texts (pack_type, pack_id, name, text) VALUES (?, ?, ?, ?)`,
			typ, packID, t.Name, t.Text); err != nil {
			return 0, fmt.Errorf("packs: store licence text %s of %s %s: %w", t.Name, typ, packID, err)
		}
	}
	return len(keep), nil
}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

func deleteTexts(ctx context.Context, q execer, typ, packID string) error {
	if _, err := q.ExecContext(ctx, `DELETE FROM pack_texts WHERE pack_type = ? AND pack_id = ?`, typ, packID); err != nil {
		return fmt.Errorf("packs: delete licence texts of %s %s: %w", typ, packID, err)
	}
	return nil
}

// Texts returns the stored licence texts of pack (typ, packID) by name.
func Texts(ctx context.Context, q Querier, typ, packID string) ([]Text, error) {
	rows, err := q.QueryContext(ctx, `SELECT name, text FROM pack_texts
		WHERE pack_type = ? AND pack_id = ? AND name <> '' ORDER BY name`, typ, packID)
	if err != nil {
		return nil, fmt.Errorf("packs: read licence texts of %s %s: %w", typ, packID, err)
	}
	defer rows.Close()
	var out []Text
	for rows.Next() {
		var t Text
		if err := rows.Scan(&t.Name, &t.Text); err != nil {
			return nil, fmt.Errorf("packs: read licence texts of %s %s: %w", typ, packID, err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// TextsStored reports whether the licence texts of pack (typ, packID) were
// collected at its import (false for a pack imported before they were kept).
func TextsStored(ctx context.Context, q Querier, typ, packID string) (bool, error) {
	rows, err := q.QueryContext(ctx, `SELECT 1 FROM pack_texts WHERE pack_type = ? AND pack_id = ? LIMIT 1`, typ, packID)
	if err != nil {
		return false, fmt.Errorf("packs: read licence texts of %s %s: %w", typ, packID, err)
	}
	defer rows.Close()
	found := rows.Next()
	return found, rows.Err()
}

// RegistryID is the pack id of the registry row an import of manifest m
// writes (RegistryTerms).
func RegistryID(m pack.Manifest) string {
	id, _, _ := RegistryTerms(m)
	return id
}

// storeTextsAfterImport keeps the licence texts of an imported pack in a
// transaction of its own: each type importer commits its own transaction,
// so this runs after it. A failure is returned (the pack is installed; a
// re-import, which changes no data, stores the texts).
func storeTextsAfterImport(ctx context.Context, sqlDB *sql.DB, pk pack.Pack) error {
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("packs: pack %s installed, but its licence texts were not stored: %w", pk.ID, err)
	}
	defer tx.Rollback()
	if _, err := StoreTexts(ctx, tx, pk.Type, RegistryID(pk.Manifest), pk.Dir); err != nil {
		return fmt.Errorf("packs: pack %s installed, but its licence texts were not stored: %w", pk.ID, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("packs: pack %s installed, but its licence texts were not stored: %w", pk.ID, err)
	}
	return nil
}
