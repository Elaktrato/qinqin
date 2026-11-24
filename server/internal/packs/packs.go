// Package packs is the one place that imports, uninstalls and lists data
// packs of every type of the pack-type table (pack.All), each through its
// type's handler (handlers.go). The seed CLI and the admin API both go
// through it, so a pack installs, shows up and goes away the same way
// however it arrived.
package packs

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"qinqin/internal/pack"
)

// Installed is one installed pack as the admin list shows it. License
// and Attribution are the strings the pack stated when it was imported,
// verbatim. A strokes pack
// serves several languages: Language is empty and Languages lists them
// (sorted); a theme or font pack has neither; every other type has Language and no
// Languages.
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
	UpdatedAt   string   `json:"updatedAt"` // RFC 3339
}

// ErrNotFound reports a pack that is not installed: pack.ErrNotFound, which
// every type package's not-found error is (errors.Is).
var ErrNotFound = pack.ErrNotFound

// ErrUnknownType reports a pack type this package does not manage.
var ErrUnknownType = errors.New("packs: unknown type")

// typeIndex is the list order of a pack type: its row in the pack-type
// table (internal/pack); -1 for an unknown type.
func typeIndex(typ string) int { return pack.Index(typ) }

// Supported reports whether typ is a pack type this package manages: every
// type of the pack-type table.
func Supported(typ string) bool {
	_, ok := pack.Lookup(typ)
	return ok
}

// Installable reports whether a pack of type typ may be installed by an
// upload through the admin API (the table's Uploadable). Audio packs may
// not: a pack of thousands of clips exceeds the upload's file and size
// limits and keeps its files under <data>/audio, so they are installed with
// scripts/fetch-audio-*.sh or `qinqin seed`; listing and uninstalling them
// work as for any pack. Font packs may: a face sliced for the web is a few
// MB in a few hundred files, well inside the limits, and the upload's
// licence review is the point of installing one.
func Installable(typ string) bool {
	d, ok := pack.Lookup(typ)
	return ok && d.Uploadable
}

// Option configures Import and Uninstall.
type Option func(*options)

type options struct {
	audioStore string
	fontStore  string
	onChange   func(typ, packID, language string)
}

// WithAudioStore names the directory audio clips live in (<data>/audio);
// importing or uninstalling an audio pack needs it.
func WithAudioStore(dir string) Option { return func(o *options) { o.audioStore = dir } }

// WithFontStore names the directory font slices live in (<data>/fonts);
// importing or uninstalling a font pack needs it.
func WithFontStore(dir string) Option { return func(o *options) { o.fontStore = dir } }

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

// errNoFontStore reports a font pack handled without WithFontStore.
var errNoFontStore = errors.New("packs: font packs need a font store directory (WithFontStore)")

// Import installs pack by its manifest type and returns the one-line
// summary the seed CLI prints.
//
// After the type's import commits, the pack's licence files are kept
// (StoreTexts); a failure there is returned although the pack is installed.
//
// The onChange hook (WithOnChange) runs once the type's import committed,
// also when storing the texts failed afterwards: the pack's data changed.
func Import(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, opts ...Option) (string, error) {
	o := collect(opts)
	line, err := importData(ctx, sqlDB, pk, o)
	if err != nil {
		return "", err
	}
	// The type's import committed: the bookkeeping after it runs to the end
	// even when ctx ends now (a shutdown), so an installed pack never lacks
	// its licence texts because of a cancellation.
	err = storeTextsAfterImport(context.WithoutCancel(ctx), sqlDB, pk)
	o.changed(pk.Type, RegistryID(pk.Manifest), pk.Language)
	if err != nil {
		return "", err
	}
	return line, nil
}

// importData imports pack by its type, in the type importer's transaction.
func importData(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, o options) (string, error) {
	h, ok := handlerOf(pk.Type)
	if !ok {
		return "", fmt.Errorf("%w: %q", ErrUnknownType, pk.Type)
	}
	return h.importPack(ctx, sqlDB, pk, o)
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
	h, ok := handlerOf(typ)
	if !ok {
		return fmt.Errorf("%w: %q", ErrUnknownType, typ)
	}
	err := h.uninstall(ctx, sqlDB, packID, o)
	if errors.Is(err, pack.ErrNotFound) {
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
	if !Supported(typ) {
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
// components, strokes, lemma-rules, theme, font), then name, then pack id. Built-in theme
// packs live in the binary and are not listed (GET /api/themes credits
// them).
func List(ctx context.Context, sqlDB *sql.DB) ([]Installed, error) {
	var out []Installed
	for _, d := range pack.All {
		rows, err := sqlDB.QueryContext(ctx, `SELECT pack_id, name, version, `+d.LanguageColumn()+`, license, attribution, notice, updated_at
			FROM `+d.Registry+` WHERE deleted_at IS NULL`)
		if err != nil {
			return nil, fmt.Errorf("packs: list %s: %w", d.Type, err)
		}
		for rows.Next() {
			p := Installed{Type: d.Type}
			var language string
			if err := rows.Scan(&p.PackID, &p.Name, &p.Version, &language, &p.License, &p.Attribution, &p.Notice, &p.UpdatedAt); err != nil {
				rows.Close()
				return nil, fmt.Errorf("packs: list %s: %w", d.Type, err)
			}
			if d.Languages == pack.Many {
				if err := json.Unmarshal([]byte(language), &p.Languages); err != nil {
					rows.Close()
					return nil, fmt.Errorf("packs: list %s: pack %s: languages: %w", d.Type, p.PackID, err)
				}
			} else {
				p.Language = language
			}
			out = append(out, p)
		}
		if err := errors.Join(rows.Err(), rows.Close()); err != nil {
			return nil, fmt.Errorf("packs: list %s: %w", d.Type, err)
		}
	}

	sort.SliceStable(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Type != b.Type {
			return typeIndex(a.Type) < typeIndex(b.Type)
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.PackID < b.PackID
	})
	return out, nil
}
