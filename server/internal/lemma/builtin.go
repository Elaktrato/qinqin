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
	mu       sync.RWMutex
	byLang   map[string]*Table
	loadOnce sync.Once
)

// load parses every built-in table once; a broken built-in table is a
// programming error caught by the package tests.
func load() {
	byLang = map[string]*Table{}
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
	}
}

// BuiltinFile returns the raw bytes of the built-in table of language.
func BuiltinFile(language string) ([]byte, error) {
	return tables.ReadFile(path.Join("tables", strings.ToLower(language)+".json"))
}

// For returns the rule table of language — a registered one, else the
// built-in one — or nil when the language has none.
func For(language string) *Table {
	loadOnce.Do(load)
	mu.RLock()
	defer mu.RUnlock()
	return byLang[strings.ToLower(language)]
}

// Register installs t for its language, replacing the built-in or an
// earlier registered table (tests; later, a rule-table data pack).
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
	out := make([]string, 0, len(byLang))
	for l := range byLang {
		out = append(out, l)
	}
	sort.Strings(out)
	return out
}
