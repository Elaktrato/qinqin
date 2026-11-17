package datapkg_test

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"qinqin/internal/datapkg"
	"qinqin/internal/packs"
)

const instanceID = "01JD8Z3Q4M5N6P7R8S9T0V1W2X"

var builtAt = time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)

func build(t *testing.T, s seeded, id string, revision int) datapkg.Built {
	t.Helper()
	specs, err := datapkg.Plan(context.Background(), s.db)
	if err != nil {
		t.Fatal(err)
	}
	b, err := datapkg.Build(context.Background(), s.db, specByID(t, specs, id),
		datapkg.BuildMeta{InstanceID: instanceID, Revision: revision, Now: builtAt, AudioDir: s.audioDir}, t.TempDir())
	if err != nil {
		t.Fatalf("Build %s: %v", id, err)
	}
	return b
}

// pkgFile is one opened package: its zip members and data.sqlite opened read-only.
type pkgFile struct {
	members map[string][]byte
	methods map[string]uint16
	order   []string
	db      *sql.DB
}

func openPackage(t *testing.T, path string) pkgFile {
	t.Helper()
	zr, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	p := pkgFile{members: map[string][]byte{}, methods: map[string]uint16{}}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatal(err)
		}
		if _, dup := p.members[f.Name]; dup {
			t.Fatalf("duplicate zip member %s", f.Name)
		}
		p.members[f.Name] = data
		p.methods[f.Name] = f.Method
		p.order = append(p.order, f.Name)
	}
	dbPath := filepath.Join(t.TempDir(), "data.sqlite")
	if err := os.WriteFile(dbPath, p.members["data.sqlite"], 0o644); err != nil {
		t.Fatal(err)
	}
	p.db, err = sql.Open("sqlite", "file:"+dbPath+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { p.db.Close() })
	return p
}

func (p pkgFile) count(t *testing.T, query string, args ...any) int {
	t.Helper()
	var n int
	if err := p.db.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

func (p pkgFile) strings(t *testing.T, query string, args ...any) []string {
	t.Helper()
	rows, err := p.db.Query(query, args...)
	if err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

func sha(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// schemaFixture reads docs/contracts/packages/schemas.json.
type schemaFixture struct {
	Common           []string            `json:"common"`
	PackageKeys      []string            `json:"packageKeys"`
	ExtraPackageKeys map[string][]string `json:"extraPackageKeys"`
	Cases            []struct {
		Type   string `json:"type"`
		Tables []struct {
			Name  string   `json:"name"`
			SQL   string   `json:"sql"`
			Order []string `json:"order"`
		} `json:"tables"`
		Indexes []string `json:"indexes"`
	} `json:"cases"`
}

func readSchemas(t *testing.T) schemaFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "packages", "schemas.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx schemaFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	return fx
}

func (fx schemaFixture) statements(typ string) []string {
	out := slices.Clone(fx.Common)
	for _, c := range fx.Cases {
		if c.Type == typ {
			for _, tb := range c.Tables {
				out = append(out, tb.SQL)
			}
			out = append(out, c.Indexes...)
		}
	}
	return out
}

// TestBuildEveryType: each package's data.sqlite holds exactly the
// schemas.json statements; the zip holds manifest.json, NOTICE.md, the
// licence files and data.sqlite (+ clips for audio), each listed with its
// size and hash; qq_package and qq_sources are filled.
func TestBuildEveryType(t *testing.T) {
	s := seedAll(t)
	fx := readSchemas(t)
	specs, err := datapkg.Plan(context.Background(), s.db)
	if err != nil {
		t.Fatal(err)
	}
	for _, spec := range specs {
		t.Run(spec.ID, func(t *testing.T) {
			b := build(t, s, spec.ID, 3)
			file, err := os.ReadFile(b.Path)
			if err != nil {
				t.Fatal(err)
			}
			if b.SHA256 != sha(file) || b.Bytes != int64(len(file)) {
				t.Errorf("Built sha256/bytes = %s/%d, file %s/%d", b.SHA256, b.Bytes, sha(file), len(file))
			}
			if !strings.HasPrefix(b.ContentHash, "sha256:") || len(b.ContentHash) != len("sha256:")+64 {
				t.Errorf("ContentHash = %q", b.ContentHash)
			}
			p := openPackage(t, b.Path)

			if got, want := p.strings(t, `SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid`), fx.statements(string(spec.Type)); !slices.Equal(got, want) {
				t.Errorf("sqlite_master =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
			}

			var m datapkg.Manifest
			if err := json.Unmarshal(p.members["manifest.json"], &m); err != nil {
				t.Fatal(err)
			}
			if _, err := datapkg.ParseManifest(p.members["manifest.json"]); err != nil {
				t.Errorf("ParseManifest of the built manifest: %v", err)
			}
			if m.Format != "qinqin-package" || m.FormatVersion != 1 || m.ID != spec.ID || m.Type != spec.Type || m.Revision != 3 ||
				m.ContentHash != b.ContentHash || m.InstanceID != instanceID || m.BuiltAt != "2026-11-16T10:00:00Z" ||
				!slices.Equal(m.Languages, spec.Languages) || !slices.Equal(m.Requires, append([]string{}, spec.Requires...)) {
				t.Errorf("manifest = %+v", m)
			}
			if len(m.Sources) != len(spec.Sources) || m.Sources[0].PackID != spec.Sources[0].PackID || m.Sources[0].License != spec.Sources[0].License {
				t.Errorf("manifest sources = %+v", m.Sources)
			}
			// Every member but manifest.json is listed with its size and hash, and nothing else is.
			listed := map[string]bool{}
			for _, f := range m.Files {
				data, ok := p.members[f.Name]
				if !ok {
					t.Errorf("listed file %s not in the zip", f.Name)
					continue
				}
				listed[f.Name] = true
				if f.Bytes != int64(len(data)) || f.SHA256 != sha(data) {
					t.Errorf("%s: listed %d/%s, actual %d/%s", f.Name, f.Bytes, f.SHA256, len(data), sha(data))
				}
			}
			for name := range p.members {
				if name != "manifest.json" && !listed[name] {
					t.Errorf("zip member %s not listed in the manifest", name)
				}
			}
			if p.methods["data.sqlite"] != zip.Deflate {
				t.Errorf("data.sqlite method %d, want Deflate", p.methods["data.sqlite"])
			}

			keys := map[string]string{}
			rows, err := p.db.Query(`SELECT key, value FROM qq_package`)
			if err != nil {
				t.Fatal(err)
			}
			for rows.Next() {
				var k, v string
				rows.Scan(&k, &v)
				keys[k] = v
			}
			rows.Close()
			wantKeys := slices.Clone(fx.PackageKeys)
			wantKeys = append(wantKeys, fx.ExtraPackageKeys[string(spec.Type)]...)
			gotKeys := make([]string, 0, len(keys))
			for k := range keys {
				gotKeys = append(gotKeys, k)
			}
			slices.Sort(gotKeys)
			slices.Sort(wantKeys)
			if !slices.Equal(gotKeys, wantKeys) {
				t.Errorf("qq_package keys = %v, want %v", gotKeys, wantKeys)
			}
			langs, _ := json.Marshal(spec.Languages)
			if keys["id"] != spec.ID || keys["type"] != string(spec.Type) || keys["formatVersion"] != "1" || keys["revision"] != "3" ||
				keys["contentHash"] != b.ContentHash || keys["instanceId"] != instanceID || keys["builtAt"] != "2026-11-16T10:00:00Z" ||
				keys["languages"] != string(langs) {
				t.Errorf("qq_package = %v", keys)
			}
			if n := p.count(t, `SELECT COUNT(*) FROM qq_sources`); n != len(spec.Sources) {
				t.Errorf("qq_sources rows = %d, want %d", n, len(spec.Sources))
			}
			notice := string(p.members["NOTICE.md"])
			for _, src := range spec.Sources {
				if !strings.Contains(notice, src.Name) || !strings.Contains(notice, src.License) || !strings.Contains(notice, src.Attribution) {
					t.Errorf("NOTICE.md lacks %s's name, licence or attribution:\n%s", src.PackID, notice)
				}
				for _, text := range src.Texts {
					if got := string(p.members["LICENSES/"+src.PackID+"/"+text.Name]); got != text.Text {
						t.Errorf("LICENSES/%s/%s = %q, want the stored text", src.PackID, text.Name, got)
					}
				}
			}
			// Every table holds rows.
			for _, c := range fx.Cases {
				if c.Type != string(spec.Type) {
					continue
				}
				for _, tb := range c.Tables {
					if n := p.count(t, `SELECT COUNT(*) FROM `+tb.Name); n == 0 {
						t.Errorf("table %s is empty", tb.Name)
					}
				}
			}
		})
	}
}

func TestBuildLexiconCarriesLicences(t *testing.T) {
	s := seedAll(t)
	p := openPackage(t, build(t, s, "lexicon.zh", 1).Path)
	if got := string(p.members["LICENSES/zh-a/LICENSE"]); got != zhALicense {
		t.Errorf("LICENSES/zh-a/LICENSE = %q", got)
	}
	if got := string(p.members["LICENSES/zh-a/ATTRIBUTION.md"]); got != zhAAttribution {
		t.Errorf("LICENSES/zh-a/ATTRIBUTION.md = %q", got)
	}
	files := p.strings(t, `SELECT license_files FROM qq_sources WHERE pack_id = 'zh-a'`)
	if len(files) != 1 || files[0] != `["ATTRIBUTION.md","LICENSE"]` {
		t.Errorf("qq_sources license_files of zh-a = %v", files)
	}
	if got := p.strings(t, `SELECT license_files FROM qq_sources WHERE pack_id = 'zh-b'`); len(got) != 1 || got[0] != `[]` {
		t.Errorf("qq_sources license_files of zh-b = %v", got)
	}
	notice := string(p.members["NOTICE.md"])
	for _, want := range []string{"Zh A", "CC0-1.0", "Zh A notice.", "LICENSES/zh-a/LICENSE", "Zh B", "MIT"} {
		if !strings.Contains(notice, want) {
			t.Errorf("NOTICE.md lacks %q:\n%s", want, notice)
		}
	}
}

func TestBuildWithoutStoredTexts(t *testing.T) {
	s := seedAll(t)
	if _, err := s.db.Exec(`DELETE FROM pack_texts`); err != nil {
		t.Fatal(err)
	}
	p := openPackage(t, build(t, s, "lexicon.zh", 1).Path)
	for name := range p.members {
		if strings.HasPrefix(name, "LICENSES/") {
			t.Errorf("package of packs without stored texts has %s", name)
		}
	}
	if !strings.Contains(string(p.members["NOTICE.md"]), "no licence files stored") {
		t.Errorf("NOTICE.md does not say that no licence files are stored:\n%s", p.members["NOTICE.md"])
	}
}

func TestBuildCopiesLiveRowsOnly(t *testing.T) {
	s := seedAll(t)
	ctx := context.Background()
	if err := packs.Uninstall(ctx, s.db, "dictionary", "zh-b"); err != nil {
		t.Fatal(err)
	}
	// A retired pack sentence and a user's own sentence stay out.
	if _, err := s.db.Exec(`UPDATE sentences SET deleted_at = '2026-01-01T00:00:00Z' WHERE hanzi = '你好吗？'`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO users (id, username, hash, admin, updated_at) VALUES (1, 'u', 'h', 0, 't')`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO sentences (entry_id, source_pack, user_id, hanzi, pinyin, translation, updated_at)
		SELECT entry_id, 'zh-sent', 1, 'mine', 'mine', 'mine', 't' FROM sentences LIMIT 1`); err != nil {
		t.Fatal(err)
	}
	// A tombstoned form of a live entry.
	if _, err := s.db.Exec(`INSERT INTO forms (entry_id, text, ord, updated_at, deleted_at)
		SELECT id, 'gone', 9, 't', 't' FROM entries WHERE language = 'zh' LIMIT 1`); err != nil {
		t.Fatal(err)
	}

	p := openPackage(t, build(t, s, "lexicon.zh", 1).Path)
	if got := p.strings(t, `SELECT pack_id FROM dictionaries`); !slices.Equal(got, []string{"zh-a"}) {
		t.Errorf("dictionaries = %v, want [zh-a]", got)
	}
	if n := p.count(t, `SELECT COUNT(*) FROM senses WHERE dictionary_id NOT IN (SELECT id FROM dictionaries)`); n != 0 {
		t.Errorf("%d senses of an uninstalled dictionary", n)
	}
	if n := p.count(t, `SELECT COUNT(*) FROM links`); n != 1 {
		t.Errorf("links = %d, want the one between two zh entries", n)
	}
	if got := p.strings(t, `SELECT DISTINCT language FROM entries`); !slices.Equal(got, []string{"zh"}) {
		t.Errorf("entry languages = %v, want [zh]", got)
	}
	if n := p.count(t, `SELECT COUNT(*) FROM forms WHERE text = 'gone'`); n != 0 {
		t.Error("a tombstoned form is in the package")
	}
	var live int
	s.db.QueryRow(`SELECT COUNT(*) FROM senses s JOIN dictionaries d ON d.id = s.dictionary_id
		WHERE s.deleted_at IS NULL AND d.deleted_at IS NULL AND d.language = 'zh'`).Scan(&live)
	if n := p.count(t, `SELECT COUNT(*) FROM senses`); n != live || n == 0 {
		t.Errorf("senses = %d, want the %d live ones", n, live)
	}
	for _, q := range []string{
		`SELECT COUNT(*) FROM forms WHERE entry_id NOT IN (SELECT id FROM entries)`,
		`SELECT COUNT(*) FROM readings WHERE entry_id NOT IN (SELECT id FROM entries)`,
		`SELECT COUNT(*) FROM links WHERE from_id NOT IN (SELECT id FROM entries) OR to_id NOT IN (SELECT id FROM entries)`,
	} {
		if n := p.count(t, q); n != 0 {
			t.Errorf("%s = %d, want 0 (no dangling ids)", q, n)
		}
	}

	sp := openPackage(t, build(t, s, "sentences.zh-sent", 1).Path)
	if got := sp.strings(t, `SELECT hanzi FROM sentences`); !slices.Equal(got, []string{"你好！"}) {
		t.Errorf("sentences = %v, want only the live pack sentence", got)
	}
}

func TestContentHashStableAndSensitive(t *testing.T) {
	s := seedAll(t)
	a := build(t, s, "lexicon.zh", 1)
	b := build(t, s, "lexicon.zh", 2) // another revision and the same content
	if a.ContentHash != b.ContentHash {
		t.Errorf("two builds of the same DB: %s != %s", a.ContentHash, b.ContentHash)
	}
	if _, err := s.db.Exec(`UPDATE senses SET glosses = '["very good"]' WHERE rowid = (SELECT MIN(rowid) FROM senses)`); err != nil {
		t.Fatal(err)
	}
	if c := build(t, s, "lexicon.zh", 3); c.ContentHash == a.ContentHash {
		t.Error("contentHash unchanged after a gloss change")
	}
	// A changed licence text changes it too.
	if _, err := s.db.Exec(`UPDATE pack_texts SET text = 'changed' WHERE pack_id = 'zh-a' AND name = 'LICENSE'`); err != nil {
		t.Fatal(err)
	}
	d := build(t, s, "lexicon.zh", 4)
	if _, err := s.db.Exec(`UPDATE pack_texts SET text = ? WHERE pack_id = 'zh-a' AND name = 'LICENSE'`, zhALicense); err != nil {
		t.Fatal(err)
	}
	if e := build(t, s, "lexicon.zh", 5); d.ContentHash == e.ContentHash {
		t.Error("contentHash unchanged after a licence text change")
	}
}

// synthLexicon fills a fresh database with one zh dictionary and n entries,
// each with a form, a reading and a sense whose gloss is glossLen bytes.
// reverse inserts every table in the opposite order, with other form,
// reading and sense row ids (they are not in the package) that rise while the
// entry ids fall, so the server's row order differs from the forward copy.
func synthLexicon(t *testing.T, n, glossLen int, reverse bool) seeded {
	t.Helper()
	s := seeded{db: newDB(t), audioDir: t.TempDir()}
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	exec := func(q string, args ...any) {
		if _, err := tx.Exec(q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	exec(`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, notice, language, updated_at)
		VALUES (1, 'synth', 'Synthetic', '1', 'CC0-1.0', 'tests', '', 'zh', 't')`)
	pad := strings.Repeat("x", glossLen)
	for k := 0; k < n; k++ {
		i := k
		rowID := i + 1
		if reverse { // entries from the last; form, reading and sense ids rise against them
			i = n - 1 - k
			rowID = n + k + 1
		}
		id := i + 1
		exec(`INSERT INTO entries (id, language, kind, ext_key, updated_at) VALUES (?, 'zh', 'word', ?, 't')`, id, fmt.Sprintf("w%d", i))
		exec(`INSERT INTO forms (id, entry_id, text, ord, updated_at) VALUES (?, ?, ?, 0, 't')`, rowID, id, fmt.Sprintf("词%d", i))
		exec(`INSERT INTO readings (id, entry_id, type, value, plain, ord, updated_at) VALUES (?, ?, 'pinyin', ?, ?, 0, 't')`,
			rowID, id, fmt.Sprintf("cí%d", i), fmt.Sprintf("ci%d", i))
		exec(`INSERT INTO senses (id, entry_id, dictionary_id, ord, glosses, updated_at) VALUES (?, ?, 1, 0, ?, 't')`,
			rowID, id, fmt.Sprintf(`["%d %s"]`, i, pad))
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestContentHashIgnoresInsertionOrder(t *testing.T) {
	a := build(t, synthLexicon(t, 200, 10, false), "lexicon.zh", 1)
	b := build(t, synthLexicon(t, 200, 10, true), "lexicon.zh", 1)
	if a.ContentHash != b.ContentHash {
		t.Errorf("same content inserted in another order: %s != %s", a.ContentHash, b.ContentHash)
	}
}

// TestBuildMemoryIsBounded: a 60,000-entry lexicon with ~40 MB of glosses
// builds with HeapAlloc under 32 MiB at every batch (rows stream through).
func TestBuildMemoryIsBounded(t *testing.T) {
	if testing.Short() {
		t.Skip("builds a 60,000-entry lexicon")
	}
	s := synthLexicon(t, 60_000, 640, false)
	runtime.GC()
	var peak uint64
	batches := 0
	restore := datapkg.SetBatchHookForTest(func() {
		batches++
		var ms runtime.MemStats
		runtime.ReadMemStats(&ms)
		peak = max(peak, ms.HeapAlloc)
	})
	defer restore()
	b := build(t, s, "lexicon.zh", 1)
	if batches < 4*60 {
		t.Errorf("%d batches, want at least 240 (60 per table of 60,000 rows)", batches)
	}
	if peak > 32<<20 {
		t.Errorf("HeapAlloc peaked at %d MiB, want under 32 MiB", peak>>20)
	}
	t.Logf("peak HeapAlloc %d MiB over %d batches; package %d bytes", peak>>20, batches, b.Bytes)
}

func TestBuildWritesOnlyIntoTmpDir(t *testing.T) {
	s := seedAll(t)
	sysTmp := t.TempDir()
	t.Setenv("TMPDIR", sysTmp)
	tmp := t.TempDir()
	specs, _ := datapkg.Plan(context.Background(), s.db)
	for _, spec := range specs {
		b, err := datapkg.Build(context.Background(), s.db, spec,
			datapkg.BuildMeta{InstanceID: instanceID, Revision: 1, Now: builtAt, AudioDir: s.audioDir}, tmp)
		if err != nil {
			t.Fatal(err)
		}
		if filepath.Dir(b.Path) != tmp {
			t.Errorf("%s built at %s, outside %s", spec.ID, b.Path, tmp)
		}
	}
	entries, _ := os.ReadDir(tmp)
	if len(entries) != len(specs) {
		var names []string
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Errorf("tmpDir holds %v, want one file per package (%d)", names, len(specs))
	}
	if left, _ := os.ReadDir(sysTmp); len(left) != 0 {
		t.Errorf("TMPDIR holds %d files after the builds", len(left))
	}

	// A spec whose id is not a package id writes nothing.
	bad := specs[0]
	bad.ID = "../lexicon.zh"
	empty := t.TempDir()
	if _, err := datapkg.Build(context.Background(), s.db, bad,
		datapkg.BuildMeta{InstanceID: instanceID, Revision: 1, Now: builtAt, AudioDir: s.audioDir}, empty); err == nil {
		t.Error("Build accepted the id ../lexicon.zh")
	}
	if left, _ := os.ReadDir(empty); len(left) != 0 {
		t.Errorf("a refused build left %d files", len(left))
	}
}

func TestBuildAudioCarriesClips(t *testing.T) {
	s := seedAll(t)
	p := openPackage(t, build(t, s, "audio.ja-audio", 1).Path)
	clips := 0
	for name, data := range p.members {
		if !strings.HasPrefix(name, "clips/") {
			continue
		}
		clips++
		if p.methods[name] != zip.Store {
			t.Errorf("%s method %d, want Store", name, p.methods[name])
		}
		base := strings.TrimPrefix(name, "clips/")
		if hash, _, _ := strings.Cut(base, "."); hash != sha(data) {
			t.Errorf("%s holds bytes with sha256 %s", name, sha(data))
		}
	}
	if clips != 2 || p.count(t, `SELECT COUNT(*) FROM clips`) != 2 {
		t.Errorf("%d clip files, want 2", clips)
	}
	// A missing clip file fails the build.
	if err := os.RemoveAll(s.audioDir); err != nil {
		t.Fatal(err)
	}
	specs, _ := datapkg.Plan(context.Background(), s.db)
	if _, err := datapkg.Build(context.Background(), s.db, specByID(t, specs, "audio.ja-audio"),
		datapkg.BuildMeta{InstanceID: instanceID, Revision: 2, Now: builtAt, AudioDir: s.audioDir}, t.TempDir()); err == nil {
		t.Error("Build of an audio package without its clip files succeeded")
	}
}
