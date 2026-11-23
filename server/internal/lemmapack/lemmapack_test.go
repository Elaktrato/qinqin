package lemmapack_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/lang"
	"qinqin/internal/lemma"
	"qinqin/internal/lemmapack"
)

func newDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB := dbtest.Open(t)
	// The overlay is process-wide: every test leaves it empty.
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	return sqlDB
}

// table is a toy rule table of language: -aba is the past of -ar.
func table(language, version string) string {
	return `{"format": 2, "language": "` + language + `", "version": "` + version + `", "maxDepth": 2,
 "classes": {"ar": {"tags": ["v"]}}, "hints": {},
 "rules": [{"from": "aba", "to": "ar", "reason": "past", "out": "ar"}]}`
}

// pack writes a lemma-rules pack directory and loads it.
func pack(t *testing.T, id, language, rules string) dict.Pack {
	t.Helper()
	dir := t.TempDir()
	m, _ := json.Marshal(map[string]string{"id": id, "name": "Rules " + id, "version": "1.0", "type": "lemma-rules",
		"language": language, "license": "CC0-1.0", "attribution": "Qinqin test fixtures", "format": "rules-json"})
	for name, body := range map[string]string{"manifest.json": string(m), "rules.json": rules, "LICENSE": "CC0 (test)\n"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	return p
}

func TestImportInstallsAndReloads(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	rules := table("xa", "1")
	r, err := lemmapack.Import(ctx, sqlDB, pack(t, "xa-rules", "xa", rules))
	if err != nil || r.Rules != 1 {
		t.Fatalf("Import = %+v, %v", r, err)
	}
	tb := lemma.For("xa")
	if tb == nil || tb.Version != "1" {
		t.Fatalf("For(xa) after import = %+v", tb)
	}
	if got := tb.Deinflect("hablaba"); len(got) != 1 || got[0].Form != "hablar" {
		t.Errorf("Deinflect = %+v", got)
	}
	var raw, hash string
	if err := sqlDB.QueryRow(`SELECT rules_json, content_hash FROM lemma_rule_packs WHERE pack_id = 'xa-rules'`).Scan(&raw, &hash); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(rules))
	if raw != rules || hash != hex.EncodeToString(sum[:]) {
		t.Errorf("stored %q / %s, want the raw bytes and their sha256", raw, hash)
	}

	list, err := lemmapack.List(ctx, sqlDB)
	if err != nil || len(list) != 1 || list[0].PackID != "xa-rules" || list[0].Language != "xa" || list[0].License != "CC0-1.0" {
		t.Fatalf("List = %+v, %v", list, err)
	}

	// The same pack again writes nothing; a new table replaces the old.
	var stamp string
	sqlDB.QueryRow(`SELECT updated_at FROM lemma_rule_packs`).Scan(&stamp)
	sqlDB.Exec(`UPDATE lemma_rule_packs SET updated_at = 'x'`)
	if _, err := lemmapack.Import(ctx, sqlDB, pack(t, "xa-rules", "xa", rules)); err != nil {
		t.Fatal(err)
	}
	sqlDB.QueryRow(`SELECT updated_at FROM lemma_rule_packs`).Scan(&stamp)
	if stamp != "x" {
		t.Errorf("an identical re-import wrote the row (updated_at %q)", stamp)
	}
	if _, err := lemmapack.Import(ctx, sqlDB, pack(t, "xa-rules", "xa", table("xa", "2"))); err != nil {
		t.Fatal(err)
	}
	if lemma.For("xa").Version != "2" {
		t.Errorf("re-import did not replace the table: %+v", lemma.For("xa"))
	}

	// Uninstall: the language has no table again; Japanese keeps its built-in.
	if err := lemmapack.Uninstall(ctx, sqlDB, "xa-rules"); err != nil {
		t.Fatal(err)
	}
	if lemma.For("xa") != nil {
		t.Error("table still in effect after the uninstall")
	}
	if err := lemmapack.Uninstall(ctx, sqlDB, "xa-rules"); !errors.Is(err, lemmapack.ErrNotFound) {
		t.Errorf("second uninstall = %v", err)
	}
	if list, _ := lemmapack.List(ctx, sqlDB); len(list) != 0 {
		t.Errorf("List after uninstall = %+v", list)
	}
	// A re-import revives the uninstalled row.
	if _, err := lemmapack.Import(ctx, sqlDB, pack(t, "xa-rules", "xa", rules)); err != nil || lemma.For("xa") == nil {
		t.Errorf("re-import after uninstall: %v", err)
	}
}

// An installed Japanese table replaces the built-in one; the uninstall
// brings the built-in back.
func TestInstalledTableReplacesTheBuiltin(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	builtin := lemma.Builtin("ja")
	if _, err := lemmapack.Import(ctx, sqlDB, pack(t, "ja-custom", "ja", table("ja", "custom"))); err != nil {
		t.Fatal(err)
	}
	if got := (lang.Ja{}).Rules(); got.Version != "custom" {
		t.Fatalf("Ja rules = %q, want the installed table", got.Version)
	}
	if err := lemmapack.Uninstall(ctx, sqlDB, "ja-custom"); err != nil {
		t.Fatal(err)
	}
	if lemma.For("ja") != builtin {
		t.Error("the built-in table did not come back")
	}
}

func TestCheckPackRefuses(t *testing.T) {
	lang.Register(lang.Zh{})
	big := table("xa", "1")
	big = strings.Replace(big, `"hints": {}`, `"hints": {}, "compounds": [], "version2": "`+strings.Repeat("x", lemmapack.MaxFileBytes)+`"`, 1)
	for name, tc := range map[string]struct {
		p    func(t *testing.T) dict.Pack
		want string
	}{
		"bad json": {func(t *testing.T) dict.Pack { return pack(t, "x", "xa", `{"format": 2,`) }, "rules.json"},
		"unknown key": {func(t *testing.T) dict.Pack {
			return pack(t, "x", "xa", strings.Replace(table("xa", "1"), `"hints"`, `"hint2": 1, "hints"`, 1))
		}, "hint2"},
		"over a limit": {func(t *testing.T) dict.Pack {
			return pack(t, "x", "xa", strings.Replace(table("xa", "1"), `"maxDepth": 2`, `"maxDepth": 9`, 1))
		}, "maxDepth"},
		"language mismatch": {func(t *testing.T) dict.Pack { return pack(t, "x", "xb", table("xa", "1")) }, "xa"},
		"too large":         {func(t *testing.T) dict.Pack { return pack(t, "x", "xa", big) }, "1 MiB"},
		"no deinflector":    {func(t *testing.T) dict.Pack { return pack(t, "x", "zh", table("zh", "1")) }, "zh"},
		"missing rules.json": {func(t *testing.T) dict.Pack {
			p := pack(t, "x", "xa", table("xa", "1"))
			os.Remove(filepath.Join(p.Dir, "rules.json"))
			return p
		}, "rules.json"},
	} {
		_, _, err := lemmapack.CheckPack(tc.p(t))
		if !errors.Is(err, dict.ErrInvalidPack) || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: CheckPack = %v, want an invalid-pack error naming %q", name, err, tc.want)
		}
	}
	// Another pack type's manifest is not a lemma-rules pack.
	p := pack(t, "x", "xa", table("xa", "1"))
	p.Type, p.Format = dict.TypeGrammar, dict.FormatJSON
	if _, _, err := lemmapack.CheckPack(p); !errors.Is(err, dict.ErrInvalidPack) {
		t.Errorf("grammar manifest: %v", err)
	}
}

// One live pack per language: a second pack id for it is refused, naming
// the installed one, until that one is uninstalled.
func TestOnePackPerLanguage(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	if _, err := lemmapack.Import(ctx, sqlDB, pack(t, "xa-one", "xa", table("xa", "1"))); err != nil {
		t.Fatal(err)
	}
	if err := lemmapack.CheckLanguage(ctx, sqlDB, "xa-two", "xa"); !errors.Is(err, dict.ErrInvalidPack) || !strings.Contains(err.Error(), "xa-one") {
		t.Errorf("CheckLanguage = %v", err)
	}
	if err := lemmapack.CheckLanguage(ctx, sqlDB, "xa-one", "xa"); err != nil {
		t.Errorf("CheckLanguage of the installed pack itself = %v", err)
	}
	_, err := lemmapack.Import(ctx, sqlDB, pack(t, "xa-two", "xa", table("xa", "2")))
	if !errors.Is(err, dict.ErrInvalidPack) || !strings.Contains(err.Error(), "xa-one") {
		t.Fatalf("second pack for xa: %v", err)
	}
	if lemma.For("xa").Version != "1" {
		t.Error("the refused pack changed the table")
	}
	if err := lemmapack.Uninstall(ctx, sqlDB, "xa-one"); err != nil {
		t.Fatal(err)
	}
	if _, err := lemmapack.Import(ctx, sqlDB, pack(t, "xa-two", "xa", table("xa", "2"))); err != nil {
		t.Fatalf("after the uninstall: %v", err)
	}
}

// Reload reads the live rows; one that no longer parses is skipped and the
// language falls back to its built-in table.
func TestReloadSkipsBrokenRows(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	for _, id := range []string{"xa-rules", "ja-rules"} {
		language := id[:2]
		if _, err := lemmapack.Import(ctx, sqlDB, pack(t, id, language, table(language, "1"))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := sqlDB.Exec(`UPDATE lemma_rule_packs SET rules_json = '{"format": 99}' WHERE pack_id = 'ja-rules'`); err != nil {
		t.Fatal(err)
	}
	lemma.SetInstalled(nil)
	if err := lemmapack.Reload(ctx, sqlDB); err != nil {
		t.Fatal(err)
	}
	if lemma.For("xa") == nil || lemma.For("ja") != lemma.Builtin("ja") {
		t.Errorf("after reload: xa %v, ja built-in %v", lemma.For("xa") != nil, lemma.For("ja") == lemma.Builtin("ja"))
	}
	// A database error keeps the overlay in effect.
	sqlDB.Close()
	if err := lemmapack.Reload(ctx, sqlDB); err == nil || lemma.For("xa") == nil {
		t.Errorf("Reload on a closed database = %v, xa kept %v", err, lemma.For("xa") != nil)
	}
}

// Stored reports what the bundled-pack sync compares: the stored hash and
// whether the row is live; a missing row is found false.
func TestStored(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	if _, found, _, err := lemmapack.Stored(ctx, sqlDB, "xa-rules"); err != nil || found {
		t.Fatalf("Stored before import: found %v, %v", found, err)
	}
	rules := table("xa", "1")
	lemmapack.Import(ctx, sqlDB, pack(t, "xa-rules", "xa", rules))
	hash, found, live, err := lemmapack.Stored(ctx, sqlDB, "xa-rules")
	if err != nil || !found || !live || hash != lemmapack.Hash([]byte(rules)) {
		t.Errorf("Stored = %s %v %v %v", hash, found, live, err)
	}
	lemmapack.Uninstall(ctx, sqlDB, "xa-rules")
	if _, found, live, _ := lemmapack.Stored(ctx, sqlDB, "xa-rules"); !found || live {
		t.Errorf("Stored after uninstall: found %v live %v", found, live)
	}
	if !bytes.Equal([]byte(lemmapack.Hash(nil)), []byte(lemmapack.Hash([]byte{}))) {
		t.Error("Hash differs for nil and empty")
	}
}

// Watch reloads when another process (`qinqin seed` while the server runs)
// changed the live packs, and only then.
func TestWatchReloadsOnOutsideChanges(t *testing.T) {
	sqlDB := newDB(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reloads := make(chan struct{}, 8)
	done := make(chan struct{})
	go func() {
		lemmapack.Watch(ctx, sqlDB, 5*time.Millisecond, func() { reloads <- struct{}{} })
		close(done)
	}()
	// Another process writes the row; this one's overlay knows nothing of it.
	if _, err := sqlDB.Exec(`INSERT INTO lemma_rule_packs (pack_id, name, version, language, license, attribution, rules_json, content_hash, updated_at)
		VALUES ('xa-rules', 'X', '1', 'xa', 'CC0-1.0', 'a', ?, 'h', 't')`, table("xa", "1")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-reloads:
	case <-time.After(5 * time.Second):
		t.Fatal("no reload after an outside change")
	}
	if lemma.For("xa") == nil {
		t.Fatal("the watcher did not install the table")
	}
	select {
	case <-reloads:
		t.Fatal("reloaded without a change")
	case <-time.After(50 * time.Millisecond):
	}
	cancel()
	<-done
}

// Reload keeps the first live pack of a language (by pack id) should two
// ever be live (the unique index makes it impossible; Reload does not rely
// on it).
func TestReloadSkipsASecondPackOfALanguage(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	if _, err := sqlDB.Exec(`DROP INDEX idx_lemma_rule_packs_live_language`); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"xa-b", "xa-a"} {
		if _, err := sqlDB.Exec(`INSERT INTO lemma_rule_packs (pack_id, name, version, language, license, attribution, rules_json, content_hash, updated_at)
			VALUES (?, 'X', '1', 'xa', 'CC0-1.0', 'a', ?, 'h', 't')`, id, table("xa", id)); err != nil {
			t.Fatal(err)
		}
	}
	if err := lemmapack.Reload(ctx, sqlDB); err != nil {
		t.Fatal(err)
	}
	if tb := lemma.For("xa"); tb == nil || tb.Version != "xa-a" {
		t.Errorf("For(xa) = %+v, want the table of xa-a (first by pack id)", tb)
	}
}

// A reload that fails after the commit does not fail the import or the
// uninstall: the pack is installed (or gone), the error is logged, and the
// watcher retries.
func TestReloadFailureAfterTheCommitIsLogged(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	defer lemmapack.SetReloadForTest(func(context.Context, lemmapack.Querier) error { return errors.New("boom") })()
	if _, err := lemmapack.Import(ctx, sqlDB, pack(t, "xa-rules", "xa", table("xa", "1"))); err != nil {
		t.Errorf("Import = %v, want nil (committed)", err)
	}
	if _, found, live, _ := lemmapack.Stored(ctx, sqlDB, "xa-rules"); !found || !live {
		t.Error("pack not installed")
	}
	if err := lemmapack.Uninstall(ctx, sqlDB, "xa-rules"); err != nil {
		t.Errorf("Uninstall = %v, want nil (committed)", err)
	}
}
