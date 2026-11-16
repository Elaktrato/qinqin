// Package packs is the one place that imports, uninstalls and lists data
// packs of every type — dictionaries, frequency lists, level lists,
// sentence, grammar, audio and components packs. The seed CLI and the admin API both go through it, so
// a pack installs, shows up and goes away the same way however it
// arrived.
package packs

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"

	"qinqin/internal/audio"
	"qinqin/internal/components"
	"qinqin/internal/dict"
	"qinqin/internal/freq"
	"qinqin/internal/grammar"
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
	dict.TypeGrammar:    4,
	dict.TypeAudio:      5,
	dict.TypeComponents: 6,
}

// Supported reports whether typ is a pack type this package manages.
func Supported(typ string) bool {
	_, ok := typeOrder[typ]
	return ok
}

// Installable reports whether a pack of type typ may be installed by an
// upload through the admin API. Audio packs may not: a pack of thousands of
// clips exceeds the upload's file and size limits and keeps its files under
// <data>/audio, so they are installed with scripts/fetch-audio-*.sh or
// `qinqin seed`; listing and uninstalling them work as for any pack.
func Installable(typ string) bool {
	return Supported(typ) && typ != dict.TypeAudio
}

// Option configures Import and Uninstall.
type Option func(*options)

type options struct{ audioStore string }

// WithAudioStore names the directory audio clips live in (<data>/audio);
// importing or uninstalling an audio pack needs it.
func WithAudioStore(dir string) Option { return func(o *options) { o.audioStore = dir } }

func collect(opts []Option) options {
	var o options
	for _, f := range opts {
		f(&o)
	}
	return o
}

// errNoAudioStore reports an audio pack handled without WithAudioStore.
var errNoAudioStore = errors.New("packs: audio packs need an audio store directory (WithAudioStore)")

// Import installs pack by its manifest type and returns the one-line
// summary the seed CLI prints.
func Import(ctx context.Context, sqlDB *sql.DB, pack dict.Pack, opts ...Option) (string, error) {
	o := collect(opts)
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
	case dict.TypeGrammar:
		r, err := grammar.Import(ctx, sqlDB, pack)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%d lessons", r.Lessons), nil
	case dict.TypeAudio:
		if o.audioStore == "" {
			return "", errNoAudioStore
		}
		r, err := audio.Import(ctx, sqlDB, pack, o.audioStore)
		if err != nil {
			return "", err
		}
		line := fmt.Sprintf("%d clips", r.Clips)
		if r.Skipped > 0 {
			line += fmt.Sprintf(" (skipped %d with no usable reading)", r.Skipped)
		}
		return line, nil
	case dict.TypeComponents:
		r, err := components.Import(ctx, sqlDB, pack)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%d characters, %d parts", r.Chars, r.Parts), nil
	}
	return "", fmt.Errorf("%w: %q", ErrUnknownType, pack.Type)
}

// Uninstall removes the live pack of type typ with manifest id packID.
// Unknown types return ErrUnknownType, packs that are not installed
// ErrNotFound.
func Uninstall(ctx context.Context, sqlDB *sql.DB, typ, packID string, opts ...Option) error {
	o := collect(opts)
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
	case dict.TypeGrammar:
		err = grammar.Uninstall(ctx, sqlDB, packID)
	case dict.TypeAudio:
		if o.audioStore == "" {
			return errNoAudioStore
		}
		_, err = audio.Uninstall(ctx, sqlDB, packID, o.audioStore)
	case dict.TypeComponents:
		err = components.Uninstall(ctx, sqlDB, packID)
	default:
		return fmt.Errorf("%w: %q", ErrUnknownType, typ)
	}
	if errors.Is(err, grammar.ErrNotFound) || errors.Is(err, dict.ErrNotFound) || errors.Is(err, freq.ErrNotFound) ||
		errors.Is(err, levels.ErrNotFound) || errors.Is(err, sentences.ErrNotFound) || errors.Is(err, audio.ErrPackNotFound) ||
		errors.Is(err, components.ErrNotFound) {
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
// (dictionary, frequency, levels, sentences, grammar, audio,
// components), then name, then pack id.
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
		{dict.TypeGrammar, `SELECT pack_id, name, version, language, license, attribution, notice, updated_at
			FROM grammar_packs WHERE deleted_at IS NULL`},
		{dict.TypeAudio, `SELECT pack_id, name, version, language, license, attribution, notice, updated_at
			FROM audio_packs WHERE deleted_at IS NULL`},
		{dict.TypeComponents, `SELECT pack_id, name, version, language, license, attribution, notice, updated_at
			FROM component_packs WHERE deleted_at IS NULL`},
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
