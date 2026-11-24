package lang

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"
)

// The language registry: which languages the server knows and has data
// for, kept in the languages table and read from the installed packs.
// Code packs (Register) are the built-in languages; every other known
// language is data-only. The functions take a *sql.DB or *sql.Tx (record
// 0003: domain packages own their SQL).

// Kinds of a known language.
const (
	KindCode = "code" // a registered code pack (zh, ja)
	KindData = "data" // a data-only language (the es demo)
)

// Info is one known language. Installed is true when live dictionary
// data of the language exists. Kind is KindCode or KindData; Installed
// lists it empty.
type Info struct {
	Code      string
	Name      string
	Installed bool
	Kind      string
}

// Queryer is what the registry reads through: *sql.DB or *sql.Tx.
type Queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// Execer is what the registry writes through: *sql.DB or *sql.Tx.
type Execer interface {
	Queryer
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

var (
	// ErrInvalidCode: the code is not shaped like es or pt-br (ValidCode).
	ErrInvalidCode = errors.New("lang: not a language code")
	// ErrNotFound: no languages row has the code.
	ErrNotFound = errors.New("lang: no such language")
)

// BuiltInError refuses a change to a code-pack language.
type BuiltInError struct{ Code string }

func (e *BuiltInError) Error() string { return e.Code + " is built in." }

// InUseError refuses removing a language something still uses.
type InUseError struct{ Use Usage }

func (e *InUseError) Error() string {
	return "The language is still used by: " + e.Use.Blockers() + "."
}

// installedSQL lists the languages with at least one live sense in a live
// dictionary on a live entry, sorted by code. The recursive CTE walks the
// distinct entry languages through the (language, kind, ext_key) unique
// index one seek per language instead of scanning every entry; the EXISTS
// then stops at the first live sense of each. The name comes from the
// languages row of a data-only language, else the code (code packs have no
// row).
const installedSQL = `
	WITH RECURSIVE langs(code) AS (
		SELECT MIN(language) FROM entries
		UNION ALL
		SELECT (SELECT MIN(language) FROM entries WHERE language > langs.code)
		FROM langs WHERE langs.code IS NOT NULL
	)
	SELECT langs.code, COALESCE(l.name, langs.code)
	FROM langs
	LEFT JOIN languages l ON l.code = langs.code
	WHERE langs.code IS NOT NULL AND EXISTS (
		SELECT 1 FROM entries e
		JOIN senses s ON s.entry_id = e.id AND s.deleted_at IS NULL
		JOIN dictionaries d ON d.id = s.dictionary_id AND d.deleted_at IS NULL
		WHERE e.language = langs.code AND e.deleted_at IS NULL
	)
	ORDER BY langs.code`

// Installed returns the languages with installed dictionary data
// (entries, senses and dictionaries all live), sorted by code, never nil.
func Installed(ctx context.Context, q Queryer) ([]Info, error) {
	rows, err := q.QueryContext(ctx, installedSQL)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]Info, 0)
	for rows.Next() {
		li := Info{Installed: true}
		if err := rows.Scan(&li.Code, &li.Name); err != nil {
			return nil, err
		}
		list = append(list, li)
	}
	return list, rows.Err()
}

// Known returns every known language sorted by code: the code packs, the
// languages rows and the installed languages.
func Known(ctx context.Context, q Queryer) ([]Info, error) {
	byCode := map[string]*Info{}
	for _, code := range Codes() {
		byCode[code] = &Info{Code: code, Name: code, Kind: KindCode}
	}
	rows, err := q.QueryContext(ctx, `SELECT code, name FROM languages`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var code, name string
		if err := rows.Scan(&code, &name); err != nil {
			rows.Close()
			return nil, err
		}
		if _, ok := byCode[code]; !ok {
			byCode[code] = &Info{Code: code, Name: name, Kind: KindData}
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()
	installed, err := Installed(ctx, q)
	if err != nil {
		return nil, err
	}
	for _, li := range installed {
		if cur, ok := byCode[li.Code]; ok {
			cur.Installed = true
			continue
		}
		li.Kind = KindData
		byCode[li.Code] = &li
	}
	list := make([]Info, 0, len(byCode))
	for _, li := range byCode {
		list = append(list, *li)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].Code < list[j].Code })
	return list, nil
}

// Exists reports whether code (compared exactly) is known through the
// database: a languages row, installed dictionary data, or any live
// dictionary, level, frequency, sentence, grammar or audio pack of that
// language. Code packs are not consulted (Registered).
func Exists(ctx context.Context, q Queryer, code string) (bool, error) {
	var known bool
	err := q.QueryRowContext(ctx, `
		SELECT EXISTS (SELECT 1 FROM languages WHERE code = ?1)
			OR EXISTS (SELECT 1 FROM dictionaries WHERE language = ?1 AND deleted_at IS NULL)
			OR EXISTS (SELECT 1 FROM schemes WHERE language = ?1 AND deleted_at IS NULL)
			OR EXISTS (SELECT 1 FROM frequency_packs WHERE language = ?1 AND deleted_at IS NULL)
			OR EXISTS (SELECT 1 FROM sentence_packs WHERE language = ?1 AND deleted_at IS NULL)
			OR EXISTS (SELECT 1 FROM grammar_packs WHERE language = ?1 AND deleted_at IS NULL)
			OR EXISTS (SELECT 1 FROM audio_packs WHERE language = ?1 AND deleted_at IS NULL)`, code).Scan(&known)
	if err != nil || known {
		return known, err
	}
	installed, err := Installed(ctx, q)
	if err != nil {
		return false, err
	}
	for _, li := range installed {
		if li.Code == code {
			return true, nil
		}
	}
	return false, nil
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

// AddDataRow stores a languages row for code (name = code) unless one
// exists. The caller has checked the code.
func AddDataRow(ctx context.Context, ex Execer, code string) error {
	_, err := addRow(ctx, ex, code)
	return err
}

func addRow(ctx context.Context, ex Execer, code string) (bool, error) {
	res, err := ex.ExecContext(ctx, `
		INSERT INTO languages (code, name, updated_at) VALUES (?, ?, ?)
		ON CONFLICT (code) DO NOTHING`, code, code, now())
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// AddData adds the data-only language raw (normalised by ValidCode) on
// purpose, as an administrator does, and returns it with whether the row
// is new. ErrInvalidCode for a malformed code, a BuiltInError for a
// code-pack language.
func AddData(ctx context.Context, ex Execer, raw string) (Info, bool, error) {
	code, valid := ValidCode(raw)
	if !valid {
		return Info{}, false, ErrInvalidCode
	}
	if Registered(code) {
		return Info{}, false, &BuiltInError{Code: code}
	}
	created, err := addRow(ctx, ex, code)
	if err != nil {
		return Info{}, false, err
	}
	list, err := Known(ctx, ex)
	if err != nil {
		return Info{}, false, err
	}
	for _, li := range list {
		if li.Code == code {
			return li, created, nil
		}
	}
	return Info{}, false, errors.New("lang: added language " + code + " is not listed")
}

// usageSQL counts what depends on language ?1 (compared exactly), one
// column each, in the order scanned by Use. Entries orphaned by an
// uninstall do not count.
const usageSQL = `
	SELECT
		(SELECT COUNT(*) FROM workspaces WHERE language = ?1) AS workspaces,
		EXISTS (
			SELECT 1 FROM entries e
			JOIN senses s ON s.entry_id = e.id AND s.deleted_at IS NULL
			JOIN dictionaries d ON d.id = s.dictionary_id AND d.deleted_at IS NULL
			WHERE e.language = ?1 AND e.deleted_at IS NULL) AS installed,
		(SELECT COUNT(*) FROM schemes WHERE language = ?1 AND deleted_at IS NULL) AS levels,
		(SELECT COUNT(*) FROM frequency_packs WHERE language = ?1 AND deleted_at IS NULL) AS freq,
		(SELECT COUNT(*) FROM sentence_packs WHERE language = ?1 AND deleted_at IS NULL) AS sentences,
		(SELECT COUNT(*) FROM grammar_packs WHERE language = ?1 AND deleted_at IS NULL) AS grammar,
		(SELECT COUNT(*) FROM audio_packs WHERE language = ?1 AND deleted_at IS NULL) AS audio,
		EXISTS (
			SELECT 1 FROM sentences st JOIN entries e ON e.id = st.entry_id
			WHERE e.language = ?1 AND st.deleted_at IS NULL AND st.source_pack != ''
			AND st.source_pack NOT IN (SELECT pack_id FROM sentence_packs)) AS legacy`

// olderPacksSQL names the source packs of legacy (usageSQL): shared
// sentences without a registry row, imported before v0.2.0. GET
// /api/admin/packs does not list them (#198), so the blockers name them
// with their removal route, DELETE /api/admin/sentences/{pack}.
const olderPacksSQL = `
	SELECT DISTINCT st.source_pack FROM sentences st JOIN entries e ON e.id = st.entry_id
	WHERE e.language = ?1 AND st.deleted_at IS NULL AND st.source_pack != ''
	AND st.source_pack NOT IN (SELECT pack_id FROM sentence_packs)
	ORDER BY 1 LIMIT 10`

// Usage is what depends on one language: numbers only, never who.
type Usage struct {
	Workspaces, Levels, Freq, Sentences, Grammar, Audio int
	Installed, Legacy                                   bool
	OlderPacks                                          []string // the packs of Legacy, at most 10
}

// InUse reports whether anything depends on the language.
func (u Usage) InUse() bool {
	return u.Workspaces+u.Levels+u.Freq+u.Sentences+u.Grammar+u.Audio > 0 || u.Installed || u.Legacy
}

// Counts is the use as numbers by name (the usage member of a 409
// language_in_use, docs/contracts/auth/errors.json).
func (u Usage) Counts() map[string]int {
	b := func(v bool) int {
		if v {
			return 1
		}
		return 0
	}
	return map[string]int{"workspaces": u.Workspaces, "dictionaries": b(u.Installed), "levelLists": u.Levels,
		"frequencyPacks": u.Freq, "sentencePacks": u.Sentences, "grammarPacks": u.Grammar, "audioPacks": u.Audio,
		"legacySentences": b(u.Legacy)}
}

func plural(n int, one, many string) string {
	if n == 1 {
		return "a " + one
	}
	return strconv.Itoa(n) + " " + many
}

// Blockers names what keeps the language in use, "" when nothing does.
func (u Usage) Blockers() string {
	var parts []string
	if u.Workspaces > 0 {
		if u.Workspaces == 1 {
			parts = append(parts, "1 workspace")
		} else {
			parts = append(parts, strconv.Itoa(u.Workspaces)+" workspaces")
		}
	}
	if u.Installed {
		parts = append(parts, "installed dictionary data")
	}
	for _, c := range []struct {
		n         int
		one, many string
	}{
		{u.Levels, "level list", "level lists"},
		{u.Freq, "frequency pack", "frequency packs"},
		{u.Sentences, "sentence pack", "sentence packs"},
		{u.Grammar, "grammar pack", "grammar packs"},
		{u.Audio, "audio pack", "audio packs"},
	} {
		if c.n > 0 {
			parts = append(parts, plural(c.n, c.one, c.many))
		}
	}
	if u.Legacy {
		older := "sentences from an older pack without a registry row"
		if len(u.OlderPacks) > 0 {
			var routes []string
			for _, p := range u.OlderPacks {
				routes = append(routes, "DELETE /api/admin/sentences/"+p)
			}
			older += " (remove with " + strings.Join(routes, ", ") + ")"
		}
		parts = append(parts, older)
	}
	return strings.Join(parts, ", ")
}

// Use counts what depends on code (compared exactly).
func Use(ctx context.Context, q Queryer, code string) (Usage, error) {
	var u Usage
	err := q.QueryRowContext(ctx, usageSQL, code).Scan(
		&u.Workspaces, &u.Installed, &u.Levels, &u.Freq, &u.Sentences, &u.Grammar, &u.Audio, &u.Legacy)
	if err != nil || !u.Legacy {
		return u, err
	}
	rs, err := q.QueryContext(ctx, olderPacksSQL, code)
	if err != nil {
		return u, err
	}
	defer rs.Close()
	for rs.Next() {
		var p string
		if err := rs.Scan(&p); err != nil {
			return u, err
		}
		u.OlderPacks = append(u.OlderPacks, p)
	}
	return u, rs.Err()
}

// Remove deletes the languages row of an unused data-only language. The
// stored code is matched by code exactly first, then lowercased, with no
// "_" rewriting, so legacy odd codes stay removable. The row is deleted by
// one statement that re-checks every dependency, so a concurrent pack
// install or workspace creation cannot slip in between check and delete.
// Errors: ErrNotFound, a BuiltInError (a code pack, with or without a
// row), an InUseError naming what blocks it.
//
// The caller serialises Remove with workspaces.Create (the server holds its
// language lock, langMu, around both): the create checks the language, may
// add its row and adds the workspace in three statements.
func Remove(ctx context.Context, ex Execer, code string) error {
	var stored string
	err := ex.QueryRowContext(ctx, `
		SELECT code FROM languages WHERE code = ?1
		UNION ALL SELECT code FROM languages WHERE code = lower(?1)
		LIMIT 1`, code).Scan(&stored)
	if errors.Is(err, sql.ErrNoRows) {
		if Registered(code) {
			return &BuiltInError{Code: strings.ToLower(code)}
		}
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if Registered(stored) {
		return &BuiltInError{Code: stored}
	}
	res, err := ex.ExecContext(ctx, `
		DELETE FROM languages WHERE code = ?1 AND (
			SELECT workspaces + installed + levels + freq + sentences + grammar + audio + legacy
			FROM (`+usageSQL+`)) = 0`, stored)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		return nil
	}
	use, err := Use(ctx, ex, stored)
	if err != nil {
		return err
	}
	if use.InUse() {
		return &InUseError{Use: use}
	}
	// Removed by someone else in between.
	return ErrNotFound
}

// WorkspaceCount is the number of workspaces of all users in one language.
type WorkspaceCount struct {
	Code       string
	Workspaces int
}

// WorkspaceCounts returns the workspaces per language, sorted by code,
// never nil.
func WorkspaceCounts(ctx context.Context, q Queryer) ([]WorkspaceCount, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT language, COUNT(*) FROM workspaces GROUP BY language ORDER BY language`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]WorkspaceCount, 0)
	for rows.Next() {
		var c WorkspaceCount
		if err := rows.Scan(&c.Code, &c.Workspaces); err != nil {
			return nil, err
		}
		list = append(list, c)
	}
	return list, rows.Err()
}
