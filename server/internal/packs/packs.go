// Package packs is the one place that imports, uninstalls and lists data
// packs of every type — dictionaries, frequency lists, level lists,
// sentence, grammar, audio, components and strokes packs. The seed CLI and the admin API both go through it, so
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
	"qinqin/internal/strokes"
)

// Installed is one installed pack as the admin list shows it. License
// and Attribution are the strings the pack stated when it was imported,
// verbatim; a legacy sentence pack carries none of them. A strokes pack
// serves several languages: Language is empty and Languages lists them
// (sorted); every other type has Language and no Languages.
type Installed struct {
	Type        string   `json:"type"`
	PackID      string   `json:"packId"`
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Language    string   `json:"language"`
	Languages   []string `json:"languages,omitempty"`
	License     string   `json:"license"`
	Attribution string   `json:"attribution"`
	Notice      string   `json:"notice"`
	UpdatedAt   string   `json:"updatedAt"` // RFC 3339; "" for a legacy sentence pack
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
	dict.TypeStrokes:    7,
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

type options struct {
	audioStore string
	onChange   func(typ, packID, language string)
}

// WithAudioStore names the directory audio clips live in (<data>/audio);
// importing or uninstalling an audio pack needs it.
func WithAudioStore(dir string) Option { return func(o *options) { o.audioStore = dir } }

// WithOnChange has fn called after an import or an uninstall committed,
// with the pack's type, registry id and language ("" for a strokes pack,
// which serves several). The data packages built from the pack hang off it
// (datapkg.Builder.PackChanged); this package cannot name them itself.
func WithOnChange(fn func(typ, packID, language string)) Option {
	return func(o *options) { o.onChange = fn }
}

// changed tells the onChange hook, if any.
func (o options) changed(typ, packID, language string) {
	if o.onChange != nil {
		o.onChange(typ, packID, language)
	}
}

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
//
// After the type's import commits, the pack's licence files are kept
// (StoreTexts); a failure there is returned although the pack is installed.
//
// The onChange hook (WithOnChange) runs once the type's import committed,
// also when storing the texts failed afterwards: the pack's data changed.
func Import(ctx context.Context, sqlDB *sql.DB, pack dict.Pack, opts ...Option) (string, error) {
	o := collect(opts)
	line, err := importData(ctx, sqlDB, pack, o)
	if err != nil {
		return "", err
	}
	err = storeTextsAfterImport(ctx, sqlDB, pack)
	o.changed(pack.Type, RegistryID(pack.Manifest), pack.Language)
	if err != nil {
		return "", err
	}
	return line, nil
}

// importData imports pack by its type, in the type importer's transaction.
func importData(ctx context.Context, sqlDB *sql.DB, pack dict.Pack, o options) (string, error) {
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
	case dict.TypeStrokes:
		r, err := strokes.Import(ctx, sqlDB, pack)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%d characters", r.Chars), nil
	}
	return "", fmt.Errorf("%w: %q", ErrUnknownType, pack.Type)
}

// Uninstall removes the live pack of type typ with registry id packID and
// its licence texts.
// Unknown types return ErrUnknownType, packs that are not installed
// ErrNotFound. The onChange hook (WithOnChange) runs after the pack is gone.
func Uninstall(ctx context.Context, sqlDB *sql.DB, typ, packID string, opts ...Option) error {
	o := collect(opts)
	var language string
	if o.onChange != nil {
		// Read before the uninstall: the hook needs the pack's language.
		if p, err := Find(ctx, sqlDB, typ, packID); err == nil {
			language = p.Language
		}
	}
	if err := uninstall(ctx, sqlDB, typ, packID, o); err != nil {
		return err
	}
	o.changed(typ, packID, language)
	return nil
}

func uninstall(ctx context.Context, sqlDB *sql.DB, typ, packID string, o options) error {
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
	case dict.TypeStrokes:
		err = strokes.Uninstall(ctx, sqlDB, packID)
	default:
		return fmt.Errorf("%w: %q", ErrUnknownType, typ)
	}
	if errors.Is(err, grammar.ErrNotFound) || errors.Is(err, dict.ErrNotFound) || errors.Is(err, freq.ErrNotFound) ||
		errors.Is(err, levels.ErrNotFound) || errors.Is(err, sentences.ErrNotFound) || errors.Is(err, audio.ErrPackNotFound) ||
		errors.Is(err, components.ErrNotFound) || errors.Is(err, strokes.ErrNotFound) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	// The pack is gone; so are its licence texts.
	return deleteTexts(ctx, sqlDB, typ, packID)
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
// components, strokes), then name, then pack id.
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
	strokePacks, err := strokes.Packs(ctx, sqlDB)
	if err != nil {
		return nil, fmt.Errorf("packs: list %s: %w", dict.TypeStrokes, err)
	}
	for _, sp := range strokePacks {
		out = append(out, Installed{Type: dict.TypeStrokes, PackID: sp.PackID, Name: sp.Name, Version: sp.Version,
			Languages: sp.Languages, License: sp.License, Attribution: sp.Attribution, Notice: sp.Notice, UpdatedAt: sp.UpdatedAt})
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
