// Package lemmapack stores lemmatizer rule-table packs (type lemma-rules,
// format rules-json, #176): one rules.json per pack in the format of
// docs/contracts/lemma/, for one language. The live packs overlay the
// built-in tables of internal/lemma (lemma.SetInstalled): an installed pack
// replaces the built-in table of its language, and uninstalling it brings
// the built-in back. Import and Uninstall reload the overlay after they
// commit, so segmentation and lookups follow at once; `qinqin serve` calls
// Reload once at start.
package lemmapack

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"qinqin/internal/lang"
	"qinqin/internal/lemma"
	"qinqin/internal/pack"
)

// DataFile is the data file of a lemma-rules pack.
const DataFile = "rules.json"

// MaxFileBytes caps rules.json (the Japanese table is about 25 KB).
const MaxFileBytes = 1 << 20

// ErrNotFound reports an uninstall of an unknown or already uninstalled
// pack.
var ErrNotFound = pack.NotFound("lemmapack: pack not found")

// Result describes an import.
type Result struct {
	Language string
	Rules    int
}

// Querier is what the readers go through (*sql.DB or *sql.Tx).
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// Hash is the content hash stored with a pack: the hex sha256 of its
// rules.json bytes.
func Hash(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// LoadFile reads and validates the rules.json of the pack in dir. Errors
// are pack.ErrInvalidPack naming the file.
func LoadFile(dir string) ([]byte, *lemma.Table, error) {
	f, err := os.Open(filepath.Join(dir, DataFile))
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %s: %v", pack.ErrInvalidPack, DataFile, err)
	}
	defer f.Close()
	raw, err := pack.ReadCapped(f, MaxFileBytes)
	if errors.Is(err, pack.ErrTooLarge) {
		return nil, nil, fmt.Errorf("%w: %s is larger than 1 MiB", pack.ErrInvalidPack, DataFile)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %s: %v", pack.ErrInvalidPack, DataFile, err)
	}
	t, err := lemma.Parse(raw)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %s: %v", pack.ErrInvalidPack, DataFile, err)
	}
	return raw, t, nil
}

// CheckPack validates the lemma-rules pack p as Import would — manifest,
// rules.json, the table's language against the manifest's, and that the
// language's code pack runs rule tables — without the installed packs
// (CheckLanguage). The staged upload calls it before the licence review.
func CheckPack(p pack.Pack) ([]byte, *lemma.Table, error) {
	m := p.Manifest
	if err := m.Validate(); err != nil {
		return nil, nil, fmt.Errorf("%w: %v", pack.ErrInvalidPack, err)
	}
	if m.Type != pack.TypeLemmaRules || m.Format != pack.FormatRulesJSON {
		return nil, nil, fmt.Errorf("%w: %q is a %s pack (format %s), not a lemma-rules pack", pack.ErrInvalidPack, m.ID, m.Type, m.Format)
	}
	raw, t, err := LoadFile(p.Dir)
	if err != nil {
		return nil, nil, err
	}
	if t.Language != m.Language {
		return nil, nil, fmt.Errorf("%w: %s is the table of %q, the manifest states %q", pack.ErrInvalidPack, DataFile, t.Language, m.Language)
	}
	if lang.Registered(m.Language) {
		if _, ok := lang.For(m.Language).(lang.Deinflector); !ok {
			return nil, nil, fmt.Errorf("%w: the %s language module does not use lemmatizer rule tables", pack.ErrInvalidPack, m.Language)
		}
	}
	return raw, t, nil
}

// CheckLanguage refuses a pack packID for language when another live pack
// already covers that language: one live pack per language.
func CheckLanguage(ctx context.Context, q Querier, packID, language string) error {
	var other string
	err := q.QueryRowContext(ctx, `SELECT pack_id FROM lemma_rule_packs
		WHERE language = ? AND pack_id != ? AND deleted_at IS NULL ORDER BY pack_id LIMIT 1`, language, packID).Scan(&other)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return nil
	case err != nil:
		return fmt.Errorf("lemmapack: %w", err)
	}
	return fmt.Errorf("%w: %s already has the lemma-rules pack %q; uninstall it first", pack.ErrInvalidPack, language, other)
}

// Import installs the lemma-rules pack p (CheckPack, then CheckLanguage in
// the transaction) and reloads the overlay. One transaction upserts the
// registry row with the raw rules.json, clearing an uninstall; an identical
// re-import (same bytes and manifest fields) writes nothing.
func Import(ctx context.Context, sqlDB *sql.DB, p pack.Pack) (Result, error) {
	raw, t, err := CheckPack(p)
	if err != nil {
		return Result{}, err
	}
	m := p.Manifest
	hash := Hash(raw)
	res := Result{Language: m.Language, Rules: len(t.Rules)}

	tx, err := pack.BeginWrite(ctx, sqlDB)
	if err != nil {
		return Result{}, fmt.Errorf("import lemma-rules pack %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	if err := CheckLanguage(ctx, tx, m.ID, m.Language); err != nil {
		return Result{}, err
	}
	stamp := pack.Now()
	_, changed, err := pack.UpsertRegistry(ctx, tx, pack.Registry{Table: "lemma_rule_packs", PackID: m.ID, Stamp: stamp,
		Columns: pack.ManifestColumns(m, pack.Column{Name: "language", Value: m.Language},
			pack.Column{Name: "rules_json", Value: string(raw)}, pack.Column{Name: "content_hash", Value: hash})})
	if err != nil {
		return Result{}, fmt.Errorf("register lemma-rules pack %s: %w", m.ID, err)
	}
	if !changed {
		return res, nil // identical: nothing to write
	}
	if err := tx.Commit(); err != nil {
		return Result{}, fmt.Errorf("import lemma-rules pack %s: %w", m.ID, err)
	}
	reloadAfterCommit(ctx, sqlDB, m.ID)
	return res, nil
}

// Uninstall soft-deletes the pack packID (its row and table stay, so a
// re-import revives it) and reloads the overlay. An unknown or already
// uninstalled pack is ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, packID string) error {
	stamp := pack.Now()
	res, err := sqlDB.ExecContext(ctx, `
		UPDATE lemma_rule_packs SET deleted_at = ?, updated_at = ? WHERE pack_id = ? AND deleted_at IS NULL`, stamp, stamp, packID)
	if err != nil {
		return fmt.Errorf("uninstall lemma-rules pack %s: %w", packID, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	reloadAfterCommit(ctx, sqlDB, packID)
	return nil
}

// reload is Reload; tests swap it.
var reload = Reload

// reloadAfterCommit reloads the overlay after a committed import or
// uninstall, even when ctx ends now. A failure is logged, not returned: the
// pack's change is committed, and Watch retries.
func reloadAfterCommit(ctx context.Context, q Querier, packID string) {
	if err := reload(context.WithoutCancel(ctx), q); err != nil {
		log.Printf("lemmapack: %s changed, but reloading the rule tables failed (retried by the watcher): %v", packID, err)
	}
}

// reloadMu serialises Reload, so a reload that read older rows never
// installs them after a newer one; loaded is the fingerprint of the rows the
// last successful Reload installed (Watch compares against it).
var (
	reloadMu sync.Mutex
	loaded   string
)

// Reload reads every live pack's table and installs them as the overlay
// (lemma.SetInstalled). A stored table that no longer parses (a binary
// older than the table's format) is skipped and logged: its language falls
// back to the built-in table. A database error keeps the overlay as it was.
func Reload(ctx context.Context, q Querier) error {
	reloadMu.Lock()
	defer reloadMu.Unlock()
	fp, err := fingerprint(ctx, q)
	if err != nil {
		return fmt.Errorf("lemmapack: reload: %w", err)
	}
	rows, err := q.QueryContext(ctx, `SELECT pack_id, language, rules_json FROM lemma_rule_packs
		WHERE deleted_at IS NULL ORDER BY pack_id`)
	if err != nil {
		return fmt.Errorf("lemmapack: reload: %w", err)
	}
	defer rows.Close()
	tables := map[string]*lemma.Table{}
	for rows.Next() {
		var id, language, raw string
		if err := rows.Scan(&id, &language, &raw); err != nil {
			return fmt.Errorf("lemmapack: reload: %w", err)
		}
		t, err := lemma.Parse([]byte(raw))
		if err == nil && t.Language != language {
			err = fmt.Errorf("table of %q stored for %q", t.Language, language)
		}
		if err != nil {
			log.Printf("lemmapack: stored lemma-rules pack %s skipped, %s uses its built-in table if any: %v", id, language, err)
			continue
		}
		if _, dup := tables[language]; dup {
			log.Printf("lemmapack: lemma-rules pack %s skipped: %s already has a live pack", id, language)
			continue
		}
		tables[language] = t
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("lemmapack: reload: %w", err)
	}
	lemma.SetInstalled(tables)
	loaded = fp
	return nil
}

// fingerprint identifies the state of the live packs: it changes with
// every import, re-import and uninstall.
func fingerprint(ctx context.Context, q Querier) (string, error) {
	var fp string
	err := q.QueryRowContext(ctx, `SELECT COALESCE(group_concat(pack_id || ':' || content_hash || ':' || updated_at, ','), '')
		FROM (SELECT pack_id, content_hash, updated_at FROM lemma_rule_packs WHERE deleted_at IS NULL ORDER BY pack_id)`).Scan(&fp)
	return fp, err
}

// Watch reloads the overlay whenever the live packs differ from what the
// last Reload installed — `qinqin seed` run while the server serves writes
// the database, not this process's overlay — checking every interval until
// ctx ends. Changes made through Import and Uninstall in this process
// reloaded already and cost nothing more. onReload, when set, runs after
// each reload it made (tests).
func Watch(ctx context.Context, q Querier, every time.Duration, onReload func()) {
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		fp, err := fingerprint(ctx, q)
		reloadMu.Lock()
		same := fp == loaded
		reloadMu.Unlock()
		if err != nil || same {
			continue
		}
		if err := Reload(ctx, q); err != nil {
			log.Printf("lemmapack: watch: %v", err)
			continue
		}
		if onReload != nil {
			onReload()
		}
	}
}

// Pack is one live lemma-rules pack with its credits.
type Pack struct {
	PackID, Name, Version, Language, License, Attribution, Notice string
}

// List returns the live packs by pack id.
func List(ctx context.Context, q Querier) ([]Pack, error) {
	rows, err := q.QueryContext(ctx, `SELECT pack_id, name, version, language, license, attribution, notice
		FROM lemma_rule_packs WHERE deleted_at IS NULL ORDER BY pack_id`)
	if err != nil {
		return nil, fmt.Errorf("lemmapack: list: %w", err)
	}
	defer rows.Close()
	var out []Pack
	for rows.Next() {
		var p Pack
		if err := rows.Scan(&p.PackID, &p.Name, &p.Version, &p.Language, &p.License, &p.Attribution, &p.Notice); err != nil {
			return nil, fmt.Errorf("lemmapack: list: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("lemmapack: list: %w", err)
	}
	return out, nil
}

// Stored reports the stored content hash of pack packID, whether a row
// exists (live or uninstalled) and whether it is live.
func Stored(ctx context.Context, q Querier, packID string) (hash string, found, live bool, err error) {
	var deleted sql.NullString
	err = q.QueryRowContext(ctx, `SELECT content_hash, deleted_at FROM lemma_rule_packs WHERE pack_id = ?`, packID).Scan(&hash, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, false, nil
	}
	if err != nil {
		return "", false, false, fmt.Errorf("lemmapack: %w", err)
	}
	return hash, true, !deleted.Valid, nil
}
