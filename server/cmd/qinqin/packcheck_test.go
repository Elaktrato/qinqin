package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// logRecorder collects the lines warnStalePackTerms logs.
type logRecorder struct{ lines []string }

func (r *logRecorder) logf(format string, args ...any) {
	r.lines = append(r.lines, fmt.Sprintf(format, args...))
}

// seededPacks seeds the small sample packs into a fresh database and
// returns it with the packs root.
func seededPacks(t *testing.T) (*sql.DB, string) {
	t.Helper()
	sqlDB, _ := openTestDB(t)
	root := smallPacks(t)
	if err := seed(context.Background(), sqlDB, t.TempDir(), []string{root}, &strings.Builder{}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return sqlDB, root
}

// editManifest rewrites one field of the manifest in dir.
func editManifest(t *testing.T, dir, field, value string) {
	t.Helper()
	file := filepath.Join(dir, "manifest.json")
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatal(err)
	}
	m[field] = value
	if data, err = json.Marshal(m); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestStalePackTermsSilentWhenStoredMatches(t *testing.T) {
	sqlDB, root := seededPacks(t)
	var rec logRecorder
	warnStalePackTerms(context.Background(), sqlDB, []string{root}, rec.logf)
	if len(rec.lines) != 0 {
		t.Errorf("freshly seeded database: got %q, want no lines", rec.lines)
	}
}

func TestStalePackTermsWarnsPerDifferingPack(t *testing.T) {
	sqlDB, root := seededPacks(t)
	// A level pack whose manifest gained a notice after the seed (the
	// upgrade case: migration 024 left the stored notice ''), and a
	// dictionary whose licence changed.
	editManifest(t, filepath.Join(root, "hsk-mini"), "notice", "Compiled by hand.")
	editManifest(t, filepath.Join(root, "es-demo"), "license", "CC BY 4.0")

	var rec logRecorder
	warnStalePackTerms(context.Background(), sqlDB, []string{root}, rec.logf)
	want := []string{
		fmt.Sprintf(`pack es-demo: stored license/attribution/notice differs from %s; run "qinqin seed" to refresh`, filepath.Join(root, "es-demo", "manifest.json")),
		fmt.Sprintf(`pack hsk-mini: stored license/attribution/notice differs from %s; run "qinqin seed" to refresh`, filepath.Join(root, "hsk-mini", "manifest.json")),
	}
	if strings.Join(rec.lines, "\n") != strings.Join(want, "\n") {
		t.Errorf("got\n%s\nwant\n%s", strings.Join(rec.lines, "\n"), strings.Join(want, "\n"))
	}
}

func TestStalePackTermsBlankedNotice(t *testing.T) {
	// A pre-024 database: the stored notice is '' while the manifest
	// carries one. A frequency pack is checked too.
	sqlDB, root := seededPacks(t)
	freqDir := filepath.Join(root, "freq-x")
	if err := os.MkdirAll(freqDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(freqDir, "manifest.json"), []byte(`{
		"id": "freq-x", "name": "X", "version": "1", "type": "frequency", "language": "ja",
		"license": "CC0-1.0", "attribution": "someone", "notice": "Ranks unmodified.", "format": "freq-csv"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`
		INSERT INTO frequency_packs (pack_id, name, version, language, license, attribution, ord, content_hash, updated_at)
		VALUES ('freq-x', 'X', '1', 'ja', 'CC0-1.0', 'someone', 1, '', '2026-01-01T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	var rec logRecorder
	warnStalePackTerms(context.Background(), sqlDB, []string{root}, rec.logf)
	if len(rec.lines) != 1 || !strings.HasPrefix(rec.lines[0], "pack freq-x: stored license/attribution/notice differs from ") {
		t.Errorf("got %q, want one warning for freq-x", rec.lines)
	}
}

func TestStalePackTermsMissingRootIsSilent(t *testing.T) {
	sqlDB, _ := seededPacks(t)
	var rec logRecorder
	warnStalePackTerms(context.Background(), sqlDB, []string{filepath.Join(t.TempDir(), "nope")}, rec.logf)
	warnStalePackTerms(context.Background(), sqlDB, nil, rec.logf)
	if len(rec.lines) != 0 {
		t.Errorf("missing packs root: got %q, want no lines", rec.lines)
	}
}

func TestStalePackTermsSkipsInvalidManifest(t *testing.T) {
	sqlDB, root := seededPacks(t)
	bad := filepath.Join(root, "broken")
	if err := os.MkdirAll(bad, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bad, "manifest.json"), []byte(`{not json`), 0o644); err != nil {
		t.Fatal(err)
	}
	editManifest(t, filepath.Join(root, "hsk-mini"), "attribution", "someone else")

	var rec logRecorder
	warnStalePackTerms(context.Background(), sqlDB, []string{root}, rec.logf)
	if len(rec.lines) != 2 {
		t.Fatalf("got %q, want a skip line for broken and a warning for hsk-mini", rec.lines)
	}
	if !strings.Contains(rec.lines[0], bad) || !strings.Contains(rec.lines[0], "skipped") {
		t.Errorf("first line %q: want the broken pack skipped, naming its path", rec.lines[0])
	}
	if !strings.HasPrefix(rec.lines[1], "pack hsk-mini: ") {
		t.Errorf("second line %q: want the hsk-mini warning", rec.lines[1])
	}
}

func TestStalePackTermsIgnoresUninstalledAndSentencePacks(t *testing.T) {
	sqlDB, root := seededPacks(t)
	// Uninstalled: a soft-deleted scheme is not compared.
	if _, err := sqlDB.Exec(`UPDATE schemes SET deleted_at = '2026-01-01T00:00:00Z' WHERE pack_id = 'hsk-mini'`); err != nil {
		t.Fatal(err)
	}
	editManifest(t, filepath.Join(root, "hsk-mini"), "notice", "Changed.")
	var rec logRecorder
	warnStalePackTerms(context.Background(), sqlDB, []string{root}, rec.logf)
	if len(rec.lines) != 0 {
		t.Errorf("uninstalled pack: got %q, want no lines", rec.lines)
	}
}
