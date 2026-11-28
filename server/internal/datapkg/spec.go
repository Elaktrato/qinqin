// Package datapkg builds the server's data packages: versioned, checksummed
// zip files holding a SQLite snapshot of one language's lexicon or of one
// installed pack, with the source packs' licences inside
// (docs/contracts/packages/). This file decides which packages should exist
// (Plan) and what an id means (ParseID); write.go and the per-type files
// write the package database, hash.go its content hash, zip.go the file.
package datapkg

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

// Type is a package type.
type Type string

// The package types (docs/contracts/packages/README.md, Ids and types).
const (
	TypeLexicon    Type = "lexicon"
	TypeLevels     Type = "levels"
	TypeSentences  Type = "sentences"
	TypeFrequency  Type = "frequency"
	TypeComponents Type = "components"
	TypeAudio      Type = "audio"
	TypeGrammar    Type = "grammar"
	TypeStrokes    Type = "strokes"
	TypeLemmaRules Type = "lemma-rules"
	TypeImages     Type = "images"
)

// FormatVersion is the data.sqlite schema version of a type that has not
// changed since the first format; FormatVersionOf gives a type's own.
const FormatVersion = 1

// FormatVersionOf is the data.sqlite schema version of a type: 1 for every type
// except sentences, which is 2 (every sentence carries its credit: Tatoeba id
// and owner, and its translation's id and owner). There is no reading of the
// older shape: a package of an old format version is rebuilt at the next
// reconcile and a client that knows only format 1 meets "unsupported".
func FormatVersionOf(t Type) int {
	if t == TypeSentences {
		return 2
	}
	return FormatVersion
}

// Types returns every package type in contract order.
func Types() []Type {
	return []Type{TypeLexicon, TypeLevels, TypeSentences, TypeFrequency, TypeComponents, TypeAudio, TypeGrammar, TypeStrokes, TypeLemmaRules, TypeImages}
}

// idPattern is the package id grammar (catalogue.json idPattern): the
// lexicon by language, every other type of Types() by pack id.
var idPattern = func() *regexp.Regexp {
	var perPack []string
	for _, t := range Types() {
		if t != TypeLexicon {
			perPack = append(perPack, string(t))
		}
	}
	return regexp.MustCompile(`^(lexicon\.[a-z]{2,3}(-[a-z0-9]+)*|(` + strings.Join(perPack, "|") + `)\.[a-z][a-z0-9]*(-[a-z0-9]+)*)$`)
}()

// ErrBadID reports a string that is not a package id.
var ErrBadID = errors.New("datapkg: not a package id")

// ParseID splits a package id into its type and the rest: the language of a
// lexicon package, the pack id of every other. Anything that does not match
// the id grammar is ErrBadID, so an id that parses is safe in a file name.
func ParseID(id string) (Type, string, error) {
	if !idPattern.MatchString(id) {
		return "", "", fmt.Errorf("%w: %q", ErrBadID, id)
	}
	typ, rest, _ := strings.Cut(id, ".")
	return Type(typ), rest, nil
}

// Source is one source pack of a package with its stored licence texts.
// TextsStored is false for a pack imported before the server kept licence
// files (packs.TextsStored); Texts is then empty.
type Source struct {
	Type, PackID, Name, Version, License, Attribution, Notice string
	Texts                                                     []packs.Text
	TextsStored                                               bool
}

// Spec is a package that should exist: its id, type, sorted languages, the
// packages it references (Requires), whether clients ask before
// downloading it (Optional, audio) and its source packs.
type Spec struct {
	ID        string
	Type      Type
	Languages []string
	Requires  []string
	Optional  bool
	Sources   []Source
}

// LicenseTexts reports whether every source's licence texts were collected
// (the catalogue's licenseTexts).
func (s Spec) LicenseTexts() bool {
	for _, src := range s.Sources {
		if !src.TextsStored {
			return false
		}
	}
	return true
}

// Querier is what Plan reads through (*sql.DB or *sql.Tx).
type Querier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// registry is where Plan finds the live packs of one package type.
type registry struct {
	typ             Type
	packType        string // the manifest type of its source packs
	query           string // pack_id, name, version, language, license, attribution, notice of live packs
	manyLanguages   bool   // the language column is a JSON array (strokes)
	optional        bool   // clients ask before downloading (audio)
	requiresLexicon bool   // the package requires lexicon.<language>
}

// registries are the package types built per pack: every row of the
// pack-type table (internal/pack) with a package, except the
// dictionaries' lexicon, which Plan builds per language.
var registries = func() []registry {
	var out []registry
	for _, d := range pack.All {
		if d.Package == "" || d.Package == pack.LexiconPackage {
			continue
		}
		lang := d.LanguageColumn()
		out = append(out, registry{
			typ:             Type(d.Package),
			packType:        d.Type,
			query:           `SELECT pack_id, name, version, ` + lang + `, license, attribution, notice FROM ` + d.Registry + ` WHERE deleted_at IS NULL`,
			manyLanguages:   d.Languages == pack.Many,
			optional:        d.OptionalPackage,
			requiresLexicon: d.RequiresLexicon,
		})
	}
	return out
}()

// Plan returns the packages that should exist now, sorted by id: one
// lexicon package per language with at least one live dictionary (its
// sources are those dictionaries, by pack id), and one package per live
// pack of every other type. Levels and sentences packages require their
// language's lexicon; audio packages are optional. A pack whose id or
// language does not fit the package id grammar gets no package (no pack
// imported through the manifest rules has one).
func Plan(ctx context.Context, q Querier) ([]Spec, error) {
	var specs []Spec
	lexicons := map[string]*Spec{}
	lex := pack.Lexicon()
	err := scanPacks(ctx, q, `SELECT pack_id, name, version, language, license, attribution, notice FROM `+lex.Registry+` WHERE deleted_at IS NULL`,
		func(packID, name, version, language, license, attribution, notice string) error {
			id := string(TypeLexicon) + "." + language
			if _, _, err := ParseID(id); err != nil {
				return nil
			}
			s := lexicons[language]
			if s == nil {
				s = &Spec{ID: id, Type: TypeLexicon, Languages: []string{language}}
				lexicons[language] = s
			}
			s.Sources = append(s.Sources, Source{Type: lex.Type, PackID: packID, Name: name, Version: version,
				License: license, Attribution: attribution, Notice: notice})
			return nil
		})
	if err != nil {
		return nil, err
	}
	for _, s := range lexicons {
		slices.SortFunc(s.Sources, func(a, b Source) int { return strings.Compare(a.PackID, b.PackID) })
		specs = append(specs, *s)
	}
	for _, r := range registries {
		err := scanPacks(ctx, q, r.query, func(packID, name, version, language, license, attribution, notice string) error {
			id := string(r.typ) + "." + packID
			if _, _, err := ParseID(id); err != nil {
				return nil
			}
			s := Spec{ID: id, Type: r.typ, Optional: r.optional,
				Sources: []Source{{Type: r.packType, PackID: packID, Name: name, Version: version,
					License: license, Attribution: attribution, Notice: notice}}}
			if r.manyLanguages {
				if err := json.Unmarshal([]byte(language), &s.Languages); err != nil {
					return fmt.Errorf("datapkg: %s pack %s: languages: %w", r.packType, packID, err)
				}
				slices.Sort(s.Languages)
			} else {
				s.Languages = []string{language}
			}
			if r.requiresLexicon {
				s.Requires = []string{string(TypeLexicon) + "." + language}
			}
			specs = append(specs, s)
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	for i := range specs {
		for j := range specs[i].Sources {
			src := &specs[i].Sources[j]
			stored, err := packs.TextsStored(ctx, q, src.Type, src.PackID)
			if err != nil {
				return nil, fmt.Errorf("datapkg: plan %s: %w", specs[i].ID, err)
			}
			src.TextsStored = stored
			if stored {
				if src.Texts, err = packs.Texts(ctx, q, src.Type, src.PackID); err != nil {
					return nil, fmt.Errorf("datapkg: plan %s: %w", specs[i].ID, err)
				}
			}
		}
	}
	slices.SortFunc(specs, func(a, b Spec) int { return strings.Compare(a.ID, b.ID) })
	return specs, nil
}

func scanPacks(ctx context.Context, q Querier, query string, fn func(packID, name, version, language, license, attribution, notice string) error) error {
	rows, err := q.QueryContext(ctx, query)
	if err != nil {
		return fmt.Errorf("datapkg: plan: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var packID, name, version, language, license, attribution, notice string
		if err := rows.Scan(&packID, &name, &version, &language, &license, &attribution, &notice); err != nil {
			return fmt.Errorf("datapkg: plan: %w", err)
		}
		if err := fn(packID, name, version, language, license, attribution, notice); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("datapkg: plan: %w", err)
	}
	return nil
}
