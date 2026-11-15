// Package packs is the one place that imports, uninstalls and lists data
// packs of every type — dictionaries, frequency lists, level lists and
// sentence packs. The seed CLI and the admin API both go through it, so
// a pack installs, shows up and goes away the same way however it
// arrived.
package packs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"

	"qinqin/internal/dict"
	"qinqin/internal/freq"
	"qinqin/internal/levels"
	"qinqin/internal/sentences"
)

// Installed is one installed pack as the admin list shows it. License
// and Attribution are the strings the pack stated when it was imported,
// verbatim; a legacy sentence pack carries none of them.
type Installed struct {
	Type        string `json:"type"`
	PackID      string `json:"packId"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Language    string `json:"language"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
	UpdatedAt   string `json:"updatedAt"` // RFC 3339; "" for a legacy sentence pack
}

// ErrNotFound reports a pack that is not installed.
var ErrNotFound = errors.New("packs: not found")

// ErrUnknownType reports a pack type this package does not manage.
var ErrUnknownType = errors.New("packs: unknown type")

// typeOrder is the list order of the pack types.
var typeOrder = map[string]int{
	dict.TypeDictionary: 0,
	dict.TypeFrequency:  1,
	dict.TypeLevels:     2,
	dict.TypeSentences:  3,
}

// Import installs pack by its manifest type and returns the one-line
// summary the seed CLI prints.
func Import(ctx context.Context, sqlDB *sql.DB, pack dict.Pack) (string, error) {
	switch pack.Type {
	case dict.TypeDictionary:
		r, err := dict.ImportLexicon(ctx, sqlDB, &pack)
		if err != nil {
			return "", err
		}
		line := fmt.Sprintf("%d entries, %d senses", r.Entries, r.Senses)
		if r.Skipped > 0 || r.Unconverted > 0 {
			line += fmt.Sprintf(" (skipped %d malformed lines, %d pinyin unconverted)", r.Skipped, r.Unconverted)
		}
		return line, nil
	case dict.TypeFrequency:
		r, err := freq.Import(ctx, sqlDB, &pack)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%d rows", r.Entries), nil
	case dict.TypeLevels:
		r, err := levels.Import(ctx, sqlDB, pack)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%d unknown forms skipped", len(r.Skipped)), nil
	case dict.TypeSentences:
		r, err := sentences.ImportPack(ctx, sqlDB, pack)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%d unknown words skipped", len(r.Skipped)), nil
	}
	return "", fmt.Errorf("%w: %q", ErrUnknownType, pack.Type)
}

// Uninstall removes the live pack of type typ with manifest id packID.
// Unknown types return ErrUnknownType, packs that are not installed
// ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, typ, packID string) error {
	var err error
	switch typ {
	case dict.TypeDictionary:
		var id int64
		id, err = rowID(ctx, sqlDB, `SELECT id FROM dictionaries WHERE pack_id = ? AND deleted_at IS NULL`, packID)
		if err == nil {
			err = dict.Uninstall(ctx, sqlDB, id)
		}
	case dict.TypeFrequency:
		err = freq.Uninstall(ctx, sqlDB, packID)
	case dict.TypeLevels:
		var id int64
		id, err = rowID(ctx, sqlDB, `SELECT id FROM schemes WHERE pack_id = ? AND deleted_at IS NULL`, packID)
		if err == nil {
			err = levels.Uninstall(ctx, sqlDB, id)
		}
	case dict.TypeSentences:
		err = sentences.Uninstall(ctx, sqlDB, packID)
	default:
		return fmt.Errorf("%w: %q", ErrUnknownType, typ)
	}
	if errors.Is(err, dict.ErrNotFound) || errors.Is(err, freq.ErrNotFound) ||
		errors.Is(err, levels.ErrNotFound) || errors.Is(err, sentences.ErrNotFound) {
		return ErrNotFound
	}
	return err
}

func rowID(ctx context.Context, sqlDB *sql.DB, query, packID string) (int64, error) {
	var id int64
	err := sqlDB.QueryRowContext(ctx, query, packID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return id, err
}

// Find returns the live pack of type typ with manifest id packID.
func Find(ctx context.Context, sqlDB *sql.DB, typ, packID string) (Installed, error) {
	if _, ok := typeOrder[typ]; !ok {
		return Installed{}, fmt.Errorf("%w: %q", ErrUnknownType, typ)
	}
	all, err := List(ctx, sqlDB)
	if err != nil {
		return Installed{}, err
	}
	for _, p := range all {
		if p.Type == typ && p.PackID == packID {
			return p, nil
		}
	}
	return Installed{}, ErrNotFound
}

// List returns every live pack of every type, ordered by type
// (dictionary, frequency, levels, sentences), then name, then pack id.
// Sentence packs imported before the registry existed list with only
// their type and id, after the registered ones: their licence is not
// recorded, and the list must not make them look like known packs.
func List(ctx context.Context, sqlDB *sql.DB) ([]Installed, error) {
	var out []Installed
	for _, q := range []struct{ typ, query string }{
		{dict.TypeDictionary, `SELECT pack_id, name, version, language, license, attribution, notice, updated_at
			FROM dictionaries WHERE deleted_at IS NULL`},
		{dict.TypeFrequency, `SELECT pack_id, name, version, language, license, attribution, notice, updated_at
			FROM frequency_packs WHERE deleted_at IS NULL`},
		{dict.TypeLevels, `SELECT pack_id, name, version, language, license, attribution, notice, updated_at
			FROM schemes WHERE deleted_at IS NULL`},
		{dict.TypeSentences, `SELECT pack_id, name, version, language, license, attribution, notice, updated_at
			FROM sentence_packs WHERE deleted_at IS NULL`},
	} {
		rows, err := sqlDB.QueryContext(ctx, q.query)
		if err != nil {
			return nil, fmt.Errorf("packs: list %s: %w", q.typ, err)
		}
		for rows.Next() {
			p := Installed{Type: q.typ}
			if err := rows.Scan(&p.PackID, &p.Name, &p.Version, &p.Language, &p.License, &p.Attribution, &p.Notice, &p.UpdatedAt); err != nil {
				rows.Close()
				return nil, fmt.Errorf("packs: list %s: %w", q.typ, err)
			}
			out = append(out, p)
		}
		if err := errors.Join(rows.Err(), rows.Close()); err != nil {
			return nil, fmt.Errorf("packs: list %s: %w", q.typ, err)
		}
	}

	legacy, err := sqlDB.QueryContext(ctx, `
		SELECT DISTINCT s.source_pack FROM sentences s
		WHERE s.user_id IS NULL AND s.deleted_at IS NULL AND s.source_pack != ''
		  AND NOT EXISTS (SELECT 1 FROM sentence_packs p WHERE p.pack_id = s.source_pack AND p.deleted_at IS NULL)`)
	if err != nil {
		return nil, fmt.Errorf("packs: list legacy sentence packs: %w", err)
	}
	for legacy.Next() {
		p := Installed{Type: dict.TypeSentences}
		if err := legacy.Scan(&p.PackID); err != nil {
			legacy.Close()
			return nil, fmt.Errorf("packs: list legacy sentence packs: %w", err)
		}
		out = append(out, p)
	}
	if err := errors.Join(legacy.Err(), legacy.Close()); err != nil {
		return nil, fmt.Errorf("packs: list legacy sentence packs: %w", err)
	}

	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Type != b.Type {
			return typeOrder[a.Type] < typeOrder[b.Type]
		}
		if (a.Name == "") != (b.Name == "") {
			return b.Name == "" // unnamed (legacy) last
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.PackID < b.PackID
	})
	return out, nil
}
