package lemma

import (
	"embed"
	"fmt"
	"path"
	"sort"
	"strings"
	"sync"
)

// tables holds the built-in rule tables, one tables/<language>.json each.
// docs/contracts/lemma/<language>.rules.json is a byte-identical copy.
//
//go:embed tables/*.json
var tables embed.FS

var (
	mu sync.RWMutex
	// byLang holds the built-in tables and those registered by Register.
	byLang map[string]*Table
	// builtin holds only the built-in tables.
	builtin map[string]*Table
	// installed is the overlay of installed rule-table packs
	// (SetInstalled); it wins over byLang.
	installed map[string]*Table
	loadOnce  sync.Once
)

// load parses every built-in table once; a broken built-in table is a
// programming error caught by the package tests.
func load() {
	byLang = map[string]*Table{}
	builtin = map[string]*Table{}
	files, err := tables.ReadDir("tables")
	if err != nil {
		panic(err)
	}
	for _, f := range files {
		raw, err := tables.ReadFile(path.Join("tables", f.Name()))
		if err != nil {
			panic(err)
		}
		t, err := Parse(raw)
		if err != nil {
			panic(err)
		}
		if want := strings.TrimSuffix(f.Name(), ".json"); t.Language != want {
			panic(fmt.Sprintf("lemma: tables/%s declares language %q", f.Name(), t.Language))
		}
		byLang[t.Language] = t
		builtin[t.Language] = t
	}
}

// BuiltinFile returns the raw bytes of the built-in table of language.
func BuiltinFile(language string) ([]byte, error) {
	return tables.ReadFile(path.Join("tables", strings.ToLower(language)+".json"))
}

// For returns the rule table of language in effect: the installed one
// (SetInstalled), else a registered one, else the built-in one; nil when
// the language has none.
func For(language string) *Table {
	loadOnce.Do(load)
	language = strings.ToLower(language)
	mu.RLock()
	defer mu.RUnlock()
	if t, ok := installed[language]; ok {
		return t
	}
	return byLang[language]
}

// Builtin returns the built-in table of language, nil when there is none.
func Builtin(language string) *Table {
	loadOnce.Do(load)
	mu.RLock()
	defer mu.RUnlock()
	return builtin[strings.ToLower(language)]
}

// SetInstalled replaces the overlay of installed tables (the live
// lemma-rules packs, keyed by language) in one step; nil clears it. The
// tables are never changed afterwards, so a caller that got one from For
// keeps a consistent table for as long as it holds it.
func SetInstalled(tables map[string]*Table) {
	loadOnce.Do(load)
	next := make(map[string]*Table, len(tables))
	for lang, t := range tables {
		next[strings.ToLower(lang)] = t
	}
	mu.Lock()
	defer mu.Unlock()
	installed = next
}

// Register installs t for its language, replacing the built-in or an
// earlier registered table (tests); an installed table still wins.
func Register(t *Table) {
	loadOnce.Do(load)
	mu.Lock()
	defer mu.Unlock()
	byLang[strings.ToLower(t.Language)] = t
}

// Languages lists the languages with a table, sorted.
func Languages() []string {
	loadOnce.Do(load)
	mu.RLock()
	defer mu.RUnlock()
	out := make([]string, 0, len(byLang)+len(installed))
	for l := range byLang {
		out = append(out, l)
	}
	for l := range installed {
		if _, ok := byLang[l]; !ok {
			out = append(out, l)
		}
	}
	sort.Strings(out)
	return out
}
