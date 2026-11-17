package main

import (
	"context"
	"database/sql"
	"io/fs"
	"os"
	"path/filepath"

	"qinqin/internal/dict"
	"qinqin/internal/packs"
)

// storedTerms is what an installed pack's registry row holds of its
// manifest's terms.
type storedTerms struct{ license, attribution, notice string }

// warnStalePackTerms logs one warning per installed dictionary,
// frequency pack, level scheme, grammar pack or audio pack whose stored license, attribution or
// notice differs from its manifest under roots: the Sources page shows
// the stored copy, which only `qinqin seed` refreshes. The typical case
// is an upgrade past migration 024, which adds every notice empty.
//
// It is advisory and read-only: a missing root is silent, an unreadable
// or invalid pack is skipped with a log line, a failed query is logged,
// and nothing is ever written. It costs one query per registry and one
// manifest.json read per pack (the walk does not enter pack
// directories).
func warnStalePackTerms(ctx context.Context, sqlDB *sql.DB, roots []string, logf func(format string, args ...any)) {
	stored := map[string]map[string]storedTerms{}
	for kind, table := range map[string]string{
		dict.TypeDictionary: "dictionaries",
		dict.TypeFrequency:  "frequency_packs",
		dict.TypeLevels:     "schemes",
		dict.TypeGrammar:    "grammar_packs",
		dict.TypeAudio:      "audio_packs",
		dict.TypeComponents: "component_packs",
		dict.TypeStrokes:    "stroke_packs",
		dict.TypeTheme:      "theme_packs",
	} {
		rows, err := loadStoredTerms(ctx, sqlDB, table)
		if err != nil {
			logf("pack notice check: read %s: %v", table, err)
			return
		}
		stored[kind] = rows
	}

	for _, root := range roots {
		if info, err := os.Stat(root); err != nil || !info.IsDir() {
			continue // no packs here (a binary run outside the repo)
		}
		_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				logf("pack notice check: skipped %s: %v", path, err)
				if d != nil && d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if !d.IsDir() {
				return nil
			}
			manifest := filepath.Join(path, "manifest.json")
			if _, err := os.Stat(manifest); err != nil {
				return nil // not a pack; keep walking
			}
			pack, err := dict.LoadPack(path)
			if err != nil {
				logf("pack notice check: skipped %s: %v", path, err)
				return filepath.SkipDir
			}
			m := pack.Manifest
			id, license, attribution := m.ID, m.License, m.Attribution
			if m.Type == dict.TypeDictionary {
				id, license, attribution = dict.RegistryTerms(m)
			}
			// Sentence packs store no terms; uninstalled packs have no row.
			if got, ok := stored[m.Type][id]; ok && got != (storedTerms{license, attribution, m.Notice}) {
				logf(`pack %s: stored license/attribution/notice differs from %s; run "qinqin seed" to refresh`, m.ID, manifest)
			}
			return filepath.SkipDir
		})
	}
}

// loadStoredTerms reads the installed rows of one registry table by
// pack id.
func loadStoredTerms(ctx context.Context, sqlDB *sql.DB, table string) (map[string]storedTerms, error) {
	rows, err := sqlDB.QueryContext(ctx, `SELECT pack_id, license, attribution, notice FROM `+table+` WHERE deleted_at IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]storedTerms{}
	for rows.Next() {
		var id string
		var t storedTerms
		if err := rows.Scan(&id, &t.license, &t.attribution, &t.notice); err != nil {
			return nil, err
		}
		out[id] = t
	}
	return out, rows.Err()
}

// warnMissingPackTexts logs one line per installed pack whose licence
// files were never collected (imported before the server kept them), so
// its data package says licenseTexts false until an administrator re-seeds.
// Advisory and read-only like warnStalePackTerms: a failed query is logged.
func warnMissingPackTexts(ctx context.Context, sqlDB *sql.DB, logf func(format string, args ...any)) {
	installed, err := packs.List(ctx, sqlDB)
	if err != nil {
		logf("pack licence text check: %v", err)
		return
	}
	for _, p := range installed {
		ok, err := packs.TextsStored(ctx, sqlDB, p.Type, p.PackID)
		if err != nil {
			logf("pack licence text check: %v", err)
			return
		}
		if !ok {
			logf(`pack %s: no licence texts stored; run "qinqin seed"`, p.PackID)
		}
	}
}
