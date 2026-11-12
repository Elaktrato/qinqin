package main

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/auth"
	"qinqin/internal/db"
	"qinqin/internal/levels"
	"qinqin/internal/lexicon"
)

// committedPacks is the repo's committed seed pack directory, relative
// to this package's test working directory.
const committedPacks = "../../../plugins/data"

// openTestDB opens a fresh migrated database in a temp data directory
// and returns it with the directory.
func openTestDB(t *testing.T) (*sql.DB, string) {
	t.Helper()
	registerLanguages()
	dir := t.TempDir()
	sqlDB, err := db.Open(filepath.Join(dir, "qinqin.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB, dir
}

// smallPacks copies the hand-written sample packs from the committed
// packs directory into a temp dir. Seed tests exercise the committed
// acceptance paths (zh/ja/es dictionaries plus zh/ja level packs) without
// importing the full bundled dictionaries, which would add minutes to
// every run.
func smallPacks(t *testing.T) string {
	t.Helper()
	dest := t.TempDir()
	for _, name := range []string{"es-demo", "hsk-mini", "ja-mini", "jlpt-mini", "zh-mini"} {
		copyTree(t, filepath.Join(committedPacks, name), filepath.Join(dest, name))
	}
	return dest
}

// copyTree copies a directory tree into dst, creating parents.
func copyTree(t *testing.T, src, dst string) {
	t.Helper()
	err := filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
	if err != nil {
		t.Fatalf("copy %s: %v", src, err)
	}
}

// counts are the active row counts the seed writes.
type counts struct{ entries, senses, members, languages int }

func countRows(t *testing.T, sqlDB *sql.DB) counts {
	t.Helper()
	var c counts
	for q, dst := range map[string]*int{
		`SELECT COUNT(*) FROM entries WHERE deleted_at IS NULL`:       &c.entries,
		`SELECT COUNT(*) FROM senses WHERE deleted_at IS NULL`:        &c.senses,
		`SELECT COUNT(*) FROM level_members WHERE deleted_at IS NULL`: &c.members,
		`SELECT COUNT(*) FROM languages`:                              &c.languages,
	} {
		if err := sqlDB.QueryRow(q).Scan(dst); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	return c
}

func TestSeedIdempotent(t *testing.T) {
	ctx := context.Background()
	sqlDB, _ := openTestDB(t)

	var out bytes.Buffer
	packs := smallPacks(t)
	if err := seed(ctx, sqlDB, []string{packs}, &out); err != nil {
		t.Fatalf("first seed: %v", err)
	}
	first := countRows(t, sqlDB)
	if first.entries == 0 || first.senses == 0 || first.members == 0 {
		t.Fatalf("first seed counts = %+v, want entries, senses, and level members", first)
	}
	for _, pack := range []string{"hsk-mini", "jlpt-mini", "es-demo"} {
		if !strings.Contains(out.String(), pack) {
			t.Errorf("seed output does not mention committed pack %s:\n%s", pack, out.String())
		}
	}

	if err := seed(ctx, sqlDB, []string{packs}, io.Discard); err != nil {
		t.Fatalf("second seed: %v", err)
	}
	if second := countRows(t, sqlDB); second != first {
		t.Errorf("counts after second seed = %+v, want identical to first %+v", second, first)
	}
}

// Each pack prints exactly one line, and a dictionary's line carries its
// lexicon counts (one summary, not a legacy and a lexicon half).
func TestSeedPrintsEachPackOnce(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	var out bytes.Buffer
	if err := seed(context.Background(), sqlDB, []string{smallPacks(t)}, &out); err != nil {
		t.Fatalf("seed: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 5 {
		t.Fatalf("seed printed %d lines, want one per pack (5):\n%s", len(lines), out.String())
	}
	for _, line := range lines {
		fields := strings.Fields(line)
		switch fields[1] {
		case "dictionary":
			if !strings.Contains(line, " entries, ") || !strings.Contains(line, " senses") || strings.Contains(line, "lexicon") {
				t.Errorf("dictionary line = %q, want \"N entries, N senses\" without a lexicon suffix", line)
			}
		}
	}
	// The counts are the lexicon's: the zh-mini pack's entries are the
	// lexicon entries the pack wrote.
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM lx_entries`).Scan(&n); err != nil || n == 0 {
		t.Fatalf("lexicon entries = %d, %v", n, err)
	}
}

// The committed packs prove all three acceptance paths end to end:
// zh (levels resolve against the dictionary seeded before them), ja
// (romaji search through the ja pack), and es (an unknown language code
// auto-registers as a data-only language, Review Focus #6).
func TestSeedCommittedPacksEndToEnd(t *testing.T) {
	ctx := context.Background()
	sqlDB, _ := openTestDB(t)
	if err := seed(ctx, sqlDB, []string{smallPacks(t)}, io.Discard); err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Temporary dual import: every dictionary pack also fills the lexicon.
	lx := lexicon.Store{DB: sqlDB}
	byForm, err := lx.ByForm(ctx, "zh", []string{"你好"})
	if err != nil || len(byForm["你好"]) == 0 {
		t.Errorf("lexicon ByForm(你好) = %+v, %v; want the seeded entry", byForm, err)
	}
	if byForm, err = lx.ByForm(ctx, "es", []string{"hola"}); err != nil || len(byForm["hola"]) == 0 {
		t.Errorf("lexicon ByForm(hola) = %+v, %v; want the seeded es entry", byForm, err)
	}

	hits, err := lx.Search(ctx, lexicon.SearchQuery{Text: "nihao", Lang: "zh"})
	if err != nil || len(hits) == 0 || hits[0].Entry.Headword() != "你好" {
		t.Fatalf("zh search nihao = %+v, %v; want 你好 first", hits, err)
	}
	badges, err := levels.ForEntry(ctx, sqlDB, hits[0].Entry.ID)
	if err != nil || len(badges) == 0 {
		t.Errorf("你好 badges = %+v, %v; want an hsk-mini level — levels must seed after dictionaries", badges, err)
	}

	hits, err = lx.Search(ctx, lexicon.SearchQuery{Text: "gakkou", Lang: "ja"})
	if err != nil || len(hits) == 0 || hits[0].Entry.Headword() != "学校" {
		t.Errorf("ja search gakkou = %+v, %v; want 学校 first", hits, err)
	}
	if len(hits) > 0 {
		if badges, err := levels.ForEntry(ctx, sqlDB, hits[0].Entry.ID); err != nil || len(badges) == 0 {
			t.Errorf("学校 badges = %+v, %v; want a jlpt-mini level", badges, err)
		}
	}

	var code string
	if err := sqlDB.QueryRow(`SELECT code FROM languages WHERE code = 'es'`).Scan(&code); err != nil {
		t.Errorf("es not auto-registered as a data-only language: %v", err)
	}
	hits, err = lx.Search(ctx, lexicon.SearchQuery{Text: "hello", Lang: "es"})
	if err != nil || len(hits) == 0 || hits[0].Entry.Headword() != "hola" {
		t.Errorf("es search hello = %+v, %v; want hola first", hits, err)
	}
}

func TestSeedNamesTheBadPack(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	packs := t.TempDir()
	bad := filepath.Join(packs, "no-license")
	if err := os.MkdirAll(bad, 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := `{"id":"no-license","name":"x","version":"1","type":"dictionary","language":"es","format":"json"}`
	if err := os.WriteFile(filepath.Join(bad, "manifest.json"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	err := seed(context.Background(), sqlDB, []string{packs}, io.Discard)
	if err == nil || !strings.Contains(err.Error(), "no-license") {
		t.Fatalf("seed(bad pack) err = %v, want an error naming no-license", err)
	}
}

func TestAddUser(t *testing.T) {
	ctx := context.Background()
	registerLanguages()
	dir := t.TempDir()
	args := []string{"--data", dir, "--admin", "--username", "erik"}

	if err := adduserCmd(args, strings.NewReader("s3cret-pw\n"), io.Discard); err != nil {
		t.Fatalf("adduser: %v", err)
	}
	sqlDB, err := db.Open(filepath.Join(dir, "qinqin.db"))
	if err != nil {
		t.Fatalf("reopen db: %v", err)
	}
	defer sqlDB.Close()
	if _, err := auth.Login(ctx, sqlDB, "erik", "s3cret-pw"); err != nil {
		t.Errorf("login as the new user: %v", err)
	}
	var admin bool
	if err := sqlDB.QueryRow(`SELECT admin FROM users WHERE username = 'erik'`).Scan(&admin); err != nil || !admin {
		t.Errorf("admin = %v, %v; want true with --admin", admin, err)
	}

	if err := adduserCmd(args, strings.NewReader("other-pw\n"), io.Discard); err == nil {
		t.Error("adduser for an existing username succeeded, want an error")
	}
	if err := adduserCmd([]string{"--data", dir, "--username", "bob"}, strings.NewReader("\n"), io.Discard); err == nil {
		t.Error("adduser with an empty password succeeded, want an error")
	}
	if err := adduserCmd([]string{"--data", dir}, strings.NewReader("pw\n"), io.Discard); !errors.Is(err, errUsage) {
		t.Errorf("adduser without --username err = %v, want usage error", err)
	}
}
