package datapkg_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/datapkg"
	"qinqin/internal/db"
	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/packs"
)

// versioningCase is one server case of docs/contracts/packages/versioning.json.
type versioningCase struct {
	Kind  string `json:"kind"`
	Name  string `json:"name"`
	Steps []struct {
		Do struct {
			Op        string `json:"op"`
			Type      string `json:"type"`
			Pack      string `json:"pack"`
			Language  string `json:"language"`
			Data      string `json:"data"`
			FailBuild bool   `json:"failBuild"`
		} `json:"do"`
		Expect []struct {
			ID       string   `json:"id"`
			State    string   `json:"state"`
			Revision int      `json:"revision"`
			Hash     *string  `json:"hash"`
			Files    []int    `json:"files"`
			Sources  []string `json:"sources"`
			Requires []string `json:"requires"`
			Error    *bool    `json:"error"`
		} `json:"expect"`
	} `json:"steps"`
}

// pkgEnv is a test database with a registry and a running builder.
type pkgEnv struct {
	t     *testing.T
	db    *sql.DB
	reg   datapkg.Registry
	b     *datapkg.Builder
	stop  func()
	clock *testClock
}

type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *testClock) Add(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

func newPkgEnv(t *testing.T, sqlDB *sql.DB, clock *testClock) *pkgEnv {
	return newPkgEnvIn(t, sqlDB, clock, t.TempDir())
}

func newPkgEnvIn(t *testing.T, sqlDB *sql.DB, clock *testClock, audioDir string) *pkgEnv {
	t.Helper()
	e := &pkgEnv{t: t, db: sqlDB, clock: clock}
	e.reg = datapkg.Registry{DB: sqlDB, Dir: filepath.Join(t.TempDir(), "packages"), AudioDir: audioDir, Now: clock.Now}
	e.b = datapkg.NewBuilder(e.reg, t.Logf)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { e.b.Run(ctx); close(done) }()
	e.stop = func() { cancel(); <-done }
	t.Cleanup(e.stop)
	return e
}

func (e *pkgEnv) drain() {
	e.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := e.b.Wait(ctx); err != nil {
		e.t.Fatalf("builder did not drain: %v", err)
	}
}

func (e *pkgEnv) onChange() packs.Option { return packs.WithOnChange(e.b.PackChanged) }

// versionPack is the test pack named by (type, pack, data): the same names
// give the same content.
func versionPack(t *testing.T, typ, pack, language, data string) dict.Pack {
	t.Helper()
	switch typ {
	case "dictionary":
		gloss := map[string]string{"cedict/v1": "good", "cedict/v2": "good; fine", "unihan/v1": "water"}[pack+"/"+data]
		written := map[string]string{"cedict": "好", "unihan": "水"}[pack]
		if gloss == "" || written == "" {
			t.Fatalf("no test pack %s/%s", pack, data)
		}
		body := `{"entries":[{"written":"` + written + `","kind":"character","readings":[{"type":"pinyin","value":"x"}],"glosses":["` + gloss + `"]},
 {"written":"你好","kind":"word","readings":[{"type":"pinyin","value":"nǐ hǎo"}],"glosses":["hello"]}]}`
		return writePack(t, map[string]any{"id": pack, "name": pack, "type": typ, "language": language, "license": "CC0-1.0", "format": "json"},
			map[string][]byte{"dictionary.json": []byte(body), "LICENSE": []byte("licence of " + pack + "\n")})
	case "levels":
		return writePack(t, map[string]any{"id": pack, "name": pack, "type": typ, "language": language, "license": "CC0-1.0", "format": "json"},
			map[string][]byte{"levels.json": []byte(`{"unit":"word","levels":[{"name":"1","entries":["你好"]}]}`)})
	}
	t.Fatalf("no test pack of type %s", typ)
	return dict.Pack{}
}

func TestVersioningServerCases(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/packages/versioning.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Cases []json.RawMessage `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, rc := range fx.Cases {
		var c versioningCase
		if err := json.Unmarshal(rc, &c); err != nil {
			t.Fatal(err)
		}
		if c.Kind != "server" {
			continue
		}
		n++
		t.Run(c.Name, func(t *testing.T) { runVersioningCase(t, c) })
	}
	if n < 7 {
		t.Fatalf("%d server cases, want at least 7", n)
	}
}

func runVersioningCase(t *testing.T, c versioningCase) {
	ctx := context.Background()
	clock := &testClock{now: time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)}
	e := newPkgEnv(t, dbtest.Open(t), clock)
	labels := map[string]string{"": ""}
	for i, st := range c.Steps {
		clock.Add(time.Minute)
		if st.Do.FailBuild {
			restore := datapkg.SetBuildHookForTest(func(string) error { return errors.New("injected writer failure") })
			defer restore()
		}
		switch st.Do.Op {
		case "import":
			if _, err := packs.Import(ctx, e.db, versionPack(t, st.Do.Type, st.Do.Pack, st.Do.Language, st.Do.Data), e.onChange()); err != nil {
				t.Fatalf("step %d: import: %v", i, err)
			}
		case "uninstall":
			if err := packs.Uninstall(ctx, e.db, st.Do.Type, st.Do.Pack, e.onChange()); err != nil {
				t.Fatalf("step %d: uninstall: %v", i, err)
			}
		case "reconcile":
			e.b.KickReconcile()
		case "restoreCopy":
			e.drain()
			copyPath := filepath.Join(t.TempDir(), "restored.db")
			if _, err := e.db.Exec(`VACUUM INTO ?`, copyPath); err != nil {
				t.Fatal(err)
			}
			restored, err := db.Open(copyPath)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { restored.Close() })
			e.stop()
			e = newPkgEnv(t, restored, clock) // a new data directory: no package files
			e.b.KickReconcile()
		default:
			t.Fatalf("step %d: unknown op %q", i, st.Do.Op)
		}
		e.drain()
		if st.Do.FailBuild {
			datapkg.SetBuildHookForTest(nil)
		}

		cat, err := e.reg.Catalogue(ctx, []string{"all"}, true)
		if err != nil {
			t.Fatalf("step %d: catalogue: %v", i, err)
		}
		for _, want := range st.Expect {
			k := slices.IndexFunc(cat.Packages, func(r datapkg.Row) bool { return r.ID == want.ID })
			if k < 0 {
				t.Fatalf("step %d: no row %s in %+v", i, want.ID, cat.Packages)
			}
			got := cat.Packages[k]
			if got.State != want.State || got.Revision != want.Revision {
				t.Errorf("step %d %s: state %s revision %d, want %s %d (error %q)", i, want.ID, got.State, got.Revision, want.State, want.Revision, got.Error)
			}
			if want.Hash != nil {
				if h, ok := labels[*want.Hash]; ok {
					if h != got.ContentHash {
						t.Errorf("step %d %s: hash %s, want label %q = %s", i, want.ID, got.ContentHash, *want.Hash, h)
					}
				} else {
					for l, h := range labels {
						if h == got.ContentHash {
							t.Errorf("step %d %s: hash of label %q equals that of label %q", i, want.ID, *want.Hash, l)
						}
					}
					labels[*want.Hash] = got.ContentHash
				}
			}
			if want.Files != nil {
				if files := revisionFiles(t, e.reg.Dir, want.ID); !slices.Equal(files, want.Files) {
					t.Errorf("step %d %s: files %v, want %v", i, want.ID, files, want.Files)
				}
			}
			if want.Sources != nil {
				var ids []string
				for _, s := range got.Sources {
					ids = append(ids, s.PackID)
				}
				if !slices.Equal(ids, want.Sources) {
					t.Errorf("step %d %s: sources %v, want %v", i, want.ID, ids, want.Sources)
				}
			}
			if want.Requires != nil && !slices.Equal(got.Requires, want.Requires) {
				t.Errorf("step %d %s: requires %v, want %v", i, want.ID, got.Requires, want.Requires)
			}
			if want.Error != nil && (got.Error != "") != *want.Error {
				t.Errorf("step %d %s: error %q, want present=%v", i, want.ID, got.Error, *want.Error)
			}
		}
	}
}

// revisionFiles lists the revisions whose files exist under <dir>/<id>/.
func revisionFiles(t *testing.T, dir, id string) []int {
	t.Helper()
	ents, err := os.ReadDir(filepath.Join(dir, id))
	if errors.Is(err, os.ErrNotExist) {
		return []int{}
	}
	if err != nil {
		t.Fatal(err)
	}
	revs := []int{}
	for _, e := range ents {
		name := e.Name()
		if !strings.HasPrefix(name, "r") || !strings.HasSuffix(name, ".qqpkg") {
			t.Errorf("stray file %s/%s", id, name)
			continue
		}
		n, err := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(name, "r"), ".qqpkg"))
		if err != nil {
			t.Errorf("stray file %s/%s", id, name)
			continue
		}
		revs = append(revs, n)
	}
	slices.Sort(revs)
	return revs
}
