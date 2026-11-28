package packs

import (
	"context"
	"database/sql"
	"fmt"
	"slices"

	"qinqin/internal/audio"
	"qinqin/internal/components"
	"qinqin/internal/courses"
	"qinqin/internal/dict"
	"qinqin/internal/fonts"
	"qinqin/internal/freq"
	"qinqin/internal/grammar"
	"qinqin/internal/images"
	"qinqin/internal/lemmapack"
	"qinqin/internal/levels"
	"qinqin/internal/pack"
	"qinqin/internal/sentences"
	"qinqin/internal/strokes"
	"qinqin/internal/themes"
)

// handler is the behaviour of one pack type: the half of its row that the
// pack-type table (pack.All, the data half) cannot hold, because pack sits
// below the type packages. handlers has one per row of pack.All, in the same
// order (TestEveryPackTypeHasItsHandler); every function of this package
// that acts on a pack finds its type's handler here
// (docs/architecture/0008-pack-types.md).
type handler struct {
	// typ is the manifest type, the row of pack.All.
	typ string
	// importPack imports the pack in the type package's own transaction and
	// returns the summary line the seed CLI prints.
	importPack func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, o options) (string, error)
	// uninstall removes the live pack with the registry id; a pack that is
	// not installed is an error that is a pack.ErrNotFound.
	uninstall func(ctx context.Context, sqlDB *sql.DB, packID string, o options) error
	// terms, if set, is the registry row's pack id, licence and attribution
	// for a manifest, where they differ from the manifest's own (the
	// built-in kanjidic2 and unihan dictionaries); nil: the manifest's.
	terms func(m pack.Manifest) (packID, license, attribution string)
}

// handlerOf returns the handler of typ.
func handlerOf(typ string) (handler, bool) {
	i := slices.IndexFunc(handlers, func(h handler) bool { return h.typ == typ })
	if i < 0 {
		return handler{}, false
	}
	return handlers[i], true
}

// RegistryTerms returns the pack id, licence and attribution of the
// registry row an import of manifest m writes: the manifest's own, unless
// the type's handler says otherwise (dict.RegistryTerms for the built-in
// dictionaries). The upload review and the licence check compare these.
func RegistryTerms(m pack.Manifest) (packID, license, attribution string) {
	if h, ok := handlerOf(m.Type); ok && h.terms != nil {
		return h.terms(m)
	}
	return m.ID, m.License, m.Attribution
}

// handlers is the behaviour of every pack type, in the order of pack.All.
var handlers = []handler{
	{
		typ:   pack.TypeDictionary,
		terms: dict.RegistryTerms,
		importPack: func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, _ options) (string, error) {
			r, err := dict.ImportLexicon(ctx, sqlDB, &pk)
			if err != nil {
				return "", err
			}
			line := fmt.Sprintf("%d entries, %d senses", r.Entries, r.Senses)
			if r.Skipped > 0 || r.Unconverted > 0 {
				line += fmt.Sprintf(" (skipped %d malformed lines, %d pinyin unconverted)", r.Skipped, r.Unconverted)
			}
			return line, nil
		},
		uninstall: func(ctx context.Context, sqlDB *sql.DB, packID string, _ options) error {
			id, err := rowID(ctx, sqlDB, `SELECT id FROM dictionaries WHERE pack_id = ? AND deleted_at IS NULL`, packID)
			if err != nil {
				return err
			}
			return dict.Uninstall(ctx, sqlDB, id)
		},
	},
	{
		typ: pack.TypeFrequency,
		importPack: func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, _ options) (string, error) {
			r, err := freq.Import(ctx, sqlDB, &pk)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("%d rows", r.Entries), nil
		},
		uninstall: func(ctx context.Context, sqlDB *sql.DB, packID string, _ options) error {
			return freq.Uninstall(ctx, sqlDB, packID)
		},
	},
	{
		typ: pack.TypeLevels,
		importPack: func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, _ options) (string, error) {
			r, err := levels.Import(ctx, sqlDB, pk)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("%d unknown forms skipped", len(r.Skipped)), nil
		},
		uninstall: func(ctx context.Context, sqlDB *sql.DB, packID string, _ options) error {
			id, err := rowID(ctx, sqlDB, `SELECT id FROM schemes WHERE pack_id = ? AND deleted_at IS NULL`, packID)
			if err != nil {
				return err
			}
			return levels.Uninstall(ctx, sqlDB, id)
		},
	},
	{
		typ: pack.TypeSentences,
		importPack: func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, _ options) (string, error) {
			r, err := sentences.ImportPack(ctx, sqlDB, pk)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("%d unknown words skipped", len(r.Skipped)), nil
		},
		uninstall: func(ctx context.Context, sqlDB *sql.DB, packID string, _ options) error {
			return sentences.Uninstall(ctx, sqlDB, packID)
		},
	},
	{
		typ: pack.TypeGrammar,
		importPack: func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, _ options) (string, error) {
			r, err := grammar.Import(ctx, sqlDB, pk)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("%d lessons", r.Lessons), nil
		},
		uninstall: func(ctx context.Context, sqlDB *sql.DB, packID string, _ options) error {
			return grammar.Uninstall(ctx, sqlDB, packID)
		},
	},
	{
		typ: pack.TypeAudio,
		importPack: func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, o options) (string, error) {
			if o.audioStore == "" {
				return "", errNoAudioStore
			}
			r, err := audio.Import(ctx, sqlDB, pk, o.audioStore)
			if err != nil {
				return "", err
			}
			line := fmt.Sprintf("%d clips", r.Clips)
			if r.Skipped > 0 {
				line += fmt.Sprintf(" (skipped %d with no usable reading)", r.Skipped)
			}
			return line, nil
		},
		uninstall: func(ctx context.Context, sqlDB *sql.DB, packID string, o options) error {
			if o.audioStore == "" {
				return errNoAudioStore
			}
			_, err := audio.Uninstall(ctx, sqlDB, packID, o.audioStore)
			return err
		},
	},
	{
		typ: pack.TypeComponents,
		importPack: func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, _ options) (string, error) {
			r, err := components.Import(ctx, sqlDB, pk)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("%d characters, %d parts", r.Chars, r.Parts), nil
		},
		uninstall: func(ctx context.Context, sqlDB *sql.DB, packID string, _ options) error {
			return components.Uninstall(ctx, sqlDB, packID)
		},
	},
	{
		typ: pack.TypeStrokes,
		importPack: func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, _ options) (string, error) {
			r, err := strokes.Import(ctx, sqlDB, pk)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("%d characters", r.Chars), nil
		},
		uninstall: func(ctx context.Context, sqlDB *sql.DB, packID string, _ options) error {
			return strokes.Uninstall(ctx, sqlDB, packID)
		},
	},
	{
		typ: pack.TypeLemmaRules,
		importPack: func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, _ options) (string, error) {
			r, err := lemmapack.Import(ctx, sqlDB, pk)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("%d rules (%s)", r.Rules, r.Language), nil
		},
		uninstall: func(ctx context.Context, sqlDB *sql.DB, packID string, _ options) error {
			return lemmapack.Uninstall(ctx, sqlDB, packID)
		},
	},
	{
		typ: pack.TypeTheme,
		importPack: func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, _ options) (string, error) {
			r, err := themes.Import(ctx, sqlDB, pk)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("%d themes", r.Themes), nil
		},
		uninstall: func(ctx context.Context, sqlDB *sql.DB, packID string, _ options) error {
			return themes.Uninstall(ctx, sqlDB, packID)
		},
	},
	{
		typ: pack.TypeFont,
		importPack: func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, o options) (string, error) {
			if o.fontStore == "" {
				return "", errNoFontStore
			}
			r, err := fonts.Import(ctx, sqlDB, pk, o.fontStore)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("%d faces, %d slices", r.Faces, r.Slices), nil
		},
		uninstall: func(ctx context.Context, sqlDB *sql.DB, packID string, o options) error {
			if o.fontStore == "" {
				return errNoFontStore
			}
			return fonts.Uninstall(ctx, sqlDB, packID, o.fontStore)
		},
	},
	{
		typ: pack.TypeImages,
		importPack: func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, _ options) (string, error) {
			r, err := images.Import(ctx, sqlDB, pk)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("%d pictures, %d word mappings", r.Pictures, r.Mappings), nil
		},
		uninstall: func(ctx context.Context, sqlDB *sql.DB, packID string, _ options) error {
			return images.Uninstall(ctx, sqlDB, packID)
		},
	},
	{
		typ: pack.TypeCourse,
		importPack: func(ctx context.Context, sqlDB *sql.DB, pk pack.Pack, _ options) (string, error) {
			r, err := courses.Import(ctx, sqlDB, pk)
			if err != nil {
				return "", err
			}
			return fmt.Sprintf("%d sections, %d units", r.Sections, r.Units), nil
		},
		uninstall: func(ctx context.Context, sqlDB *sql.DB, packID string, _ options) error {
			return courses.Uninstall(ctx, sqlDB, packID)
		},
	},
}
