package datapkg

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite" // the package database is written with the server's SQLite driver
)

// TableDef is one table of a package database: its name, its exact CREATE
// statement and the columns its rows are ordered by in the content hash
// (docs/contracts/packages/schemas.json).
type TableDef struct {
	Name  string
	SQL   string
	Order []string

	cols  []string // in table order
	query string   // reads the rows from the server database; one argument (the language or pack id)
}

// extraKey is a qq_package value a type adds, read from the server database
// with the same argument as the tables.
type extraKey struct{ key, query string }

type typeDef struct {
	tables    []TableDef
	indexes   []string
	extraKeys []extraKey
}

// Aliases so the per-type files read as declarations.
type tableDef = TableDef

var typeDefs = map[Type]typeDef{
	TypeLexicon:    lexiconDef,
	TypeLevels:     levelsDef,
	TypeSentences:  sentencesDef,
	TypeFrequency:  frequencyDef,
	TypeComponents: componentsDef,
	TypeAudio:      audioDef,
	TypeGrammar:    grammarDef,
	TypeStrokes:    strokesDef,
	TypeLemmaRules: lemmaRulesDef,
}

var commonStatements = []string{
	"CREATE TABLE qq_package (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
	"CREATE TABLE qq_sources (type TEXT NOT NULL, pack_id TEXT NOT NULL, name TEXT NOT NULL, version TEXT NOT NULL, license TEXT NOT NULL, attribution TEXT NOT NULL, notice TEXT NOT NULL, license_files TEXT NOT NULL, PRIMARY KEY (type, pack_id))",
}

var packageKeys = []string{"id", "type", "formatVersion", "revision", "contentHash", "instanceId", "builtAt", "languages"}

// CommonStatements returns the statements every package database starts with.
func CommonStatements() []string { return append([]string(nil), commonStatements...) }

// Schema returns the tables and indexes of a type's package database.
func Schema(t Type) ([]TableDef, []string) {
	d := typeDefs[t]
	tables := make([]TableDef, len(d.tables))
	copy(tables, d.tables)
	return tables, append([]string(nil), d.indexes...)
}

// PackageKeys returns the qq_package keys of a type's package database.
func PackageKeys(t Type) []string {
	keys := append([]string(nil), packageKeys...)
	for _, k := range typeDefs[t].extraKeys {
		keys = append(keys, k.key)
	}
	return keys
}

// batchRows is the rows per INSERT into a package table: at most 1,000 and
// at most 30,000 bound values (SQLite allows 32,766).
const batchRows = 1000

// batchHook runs after every batch a build writes; tests sample memory.
var batchHook func()

// BuildMeta is what a build stamps into the package besides its content.
type BuildMeta struct {
	InstanceID string
	Revision   int
	Now        time.Time
	AudioDir   string // <data>/audio; audio packages read their clips here
}

// Built is a written package file.
type Built struct {
	ContentHash string // sha256:<hex> of the content (hash.go)
	SHA256      string // hex of the file
	Bytes       int64
	Path        string // in the build's tmpDir: <id>-r<revision>.qqpkg.tmp
	Manifest    Manifest
}

// Build writes the package of spec into tmpDir and returns it. It reads
// the server database under one transaction (a consistent snapshot) and
// streams the rows into a fresh package database in batches of batchRows
// inside one write transaction, so memory is one batch, never the package.
// Then it creates the indexes, computes the content hash, fills qq_package,
// compacts the database (VACUUM INTO) and zips it with the manifest,
// NOTICE.md, the licence texts and, for audio, the clip files.
//
// Every file name is built from the validated id and integers; nothing is
// written outside tmpDir, and only the returned file remains there.
func Build(ctx context.Context, sqlDB *sql.DB, spec Spec, meta BuildMeta, tmpDir string) (Built, error) {
	typ, arg, err := ParseID(spec.ID)
	if err != nil {
		return Built{}, err
	}
	def, known := typeDefs[typ]
	switch {
	case !known || typ != spec.Type:
		return Built{}, fmt.Errorf("datapkg: %s: type %q does not match the id", spec.ID, spec.Type)
	case meta.Revision < 1:
		return Built{}, fmt.Errorf("datapkg: %s: revision %d", spec.ID, meta.Revision)
	case meta.InstanceID == "":
		return Built{}, fmt.Errorf("datapkg: %s: no instance id", spec.ID)
	case len(spec.Sources) == 0 || len(spec.Languages) == 0:
		return Built{}, fmt.Errorf("datapkg: %s: no sources or languages", spec.ID)
	case typ == TypeAudio && meta.AudioDir == "":
		return Built{}, fmt.Errorf("datapkg: %s: audio packages need the audio directory", spec.ID)
	}
	for _, src := range spec.Sources {
		if _, _, err := ParseID("levels." + src.PackID); err != nil {
			return Built{}, fmt.Errorf("datapkg: %s: source pack id %q", spec.ID, src.PackID)
		}
	}

	base := filepath.Join(tmpDir, spec.ID+"-r"+strconv.Itoa(meta.Revision))
	work, data, out := base+".work.tmp", base+".sqlite.tmp", base+".qqpkg.tmp"
	for _, p := range []string{work, data, out} {
		if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
			return Built{}, fmt.Errorf("datapkg: %s: %w", spec.ID, err)
		}
	}
	done := false
	defer func() {
		os.Remove(work)
		os.Remove(work + "-journal")
		os.Remove(data)
		if !done {
			os.Remove(out)
		}
	}()

	hash, err := writeDatabase(ctx, sqlDB, spec, def, arg, meta, work, data)
	if err != nil {
		return Built{}, fmt.Errorf("datapkg: build %s: %w", spec.ID, err)
	}
	built, err := writeZip(spec, meta, hash, data, out)
	if err != nil {
		return Built{}, fmt.Errorf("datapkg: build %s: %w", spec.ID, err)
	}
	done = true
	return built, nil
}

// writeDatabase writes the package database to work, then compacts it into
// data, and returns the content hash.
func writeDatabase(ctx context.Context, sqlDB *sql.DB, spec Spec, def typeDef, arg string, meta BuildMeta, work, data string) (string, error) {
	pkg, err := sql.Open("sqlite", work+"?_pragma=journal_mode(OFF)&_pragma=synchronous(OFF)")
	if err != nil {
		return "", err
	}
	defer pkg.Close()
	pkg.SetMaxOpenConns(1)

	for _, stmt := range commonStatements {
		if _, err := pkg.ExecContext(ctx, stmt); err != nil {
			return "", err
		}
	}
	for _, tb := range def.tables {
		if _, err := pkg.ExecContext(ctx, tb.SQL); err != nil {
			return "", err
		}
	}

	src, err := sqlDB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return "", err
	}
	defer src.Rollback()
	dst, err := pkg.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer dst.Rollback()
	for _, tb := range def.tables {
		if err := copyTable(ctx, src, dst, tb, arg); err != nil {
			return "", fmt.Errorf("table %s: %w", tb.Name, err)
		}
	}
	for _, s := range spec.Sources {
		files := make([]string, 0, len(s.Texts))
		for _, t := range s.Texts {
			files = append(files, t.Name)
		}
		names, _ := json.Marshal(files)
		if _, err := dst.ExecContext(ctx, `INSERT INTO qq_sources (type, pack_id, name, version, license, attribution, notice, license_files)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, s.Type, s.PackID, s.Name, s.Version, s.License, s.Attribution, s.Notice, string(names)); err != nil {
			return "", fmt.Errorf("qq_sources: %w", err)
		}
	}
	extras := make([][2]string, 0, len(def.extraKeys))
	for _, k := range def.extraKeys {
		var v string
		if err := src.QueryRowContext(ctx, k.query, arg).Scan(&v); err != nil {
			return "", fmt.Errorf("%s: %w", k.key, err)
		}
		extras = append(extras, [2]string{k.key, v})
	}
	if err := src.Rollback(); err != nil {
		return "", err
	}
	if err := dst.Commit(); err != nil {
		return "", err
	}
	for _, stmt := range def.indexes {
		if _, err := pkg.ExecContext(ctx, stmt); err != nil {
			return "", err
		}
	}

	hash, err := contentHash(ctx, pkg, spec, def, extras)
	if err != nil {
		return "", fmt.Errorf("content hash: %w", err)
	}
	langs, _ := json.Marshal(spec.Languages)
	values := [][2]string{
		{"id", spec.ID},
		{"type", string(spec.Type)},
		{"formatVersion", strconv.Itoa(FormatVersionOf(spec.Type))},
		{"revision", strconv.Itoa(meta.Revision)},
		{"contentHash", hash},
		{"instanceId", meta.InstanceID},
		{"builtAt", meta.Now.UTC().Format(time.RFC3339)},
		{"languages", string(langs)},
	}
	for _, kv := range append(values, extras...) {
		if _, err := pkg.ExecContext(ctx, `INSERT INTO qq_package (key, value) VALUES (?, ?)`, kv[0], kv[1]); err != nil {
			return "", fmt.Errorf("qq_package: %w", err)
		}
	}
	if _, err := pkg.ExecContext(ctx, `VACUUM INTO ?`, data); err != nil {
		return "", fmt.Errorf("vacuum: %w", err)
	}
	return hash, pkg.Close()
}

// copyTable streams the rows of tb from the server database into the
// package database in batches of batchRows.
func copyTable(ctx context.Context, src *sql.Tx, dst *sql.Tx, tb TableDef, arg string) error {
	n := len(tb.cols)
	per := min(batchRows, 30000/n)
	insert := func(rows int) string {
		row := "(" + strings.TrimSuffix(strings.Repeat("?, ", n), ", ") + ")"
		return "INSERT INTO " + tb.Name + " (" + strings.Join(tb.cols, ", ") + ") VALUES " +
			strings.TrimSuffix(strings.Repeat(row+", ", rows), ", ")
	}
	full, err := dst.PrepareContext(ctx, insert(per))
	if err != nil {
		return err
	}
	defer full.Close()

	rows, err := src.QueryContext(ctx, tb.query, arg)
	if err != nil {
		return err
	}
	defer rows.Close()
	args := make([]any, 0, per*n)
	flush := func() error {
		if len(args) == 0 {
			return nil
		}
		var err error
		if len(args) == per*n {
			_, err = full.ExecContext(ctx, args...)
		} else {
			_, err = dst.ExecContext(ctx, insert(len(args)/n), args...)
		}
		args = args[:0]
		if batchHook != nil {
			batchHook()
		}
		return err
	}
	vals := make([]any, n)
	ptrs := make([]any, n)
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}
		args = append(args, vals...)
		if len(args) == per*n {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return flush()
}
