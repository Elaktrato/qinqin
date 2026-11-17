package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/strokes"
)

// writeStrokesPack writes a two-character strokes pack under root.
func writeStrokesPack(t *testing.T, root string) string {
	t.Helper()
	dir := filepath.Join(root, "strokes")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	m, _ := json.Marshal(map[string]any{
		"id": "hw-strokes", "name": "Stroke data", "version": "1", "type": "strokes", "languages": []string{"zh", "ja"},
		"license": "Arphic Public License", "attribution": "Make Me a Hanzi via hanzi-writer-data",
		"notice": "Used unmodified.", "format": "hanzi-writer-jsonl-gz",
	})
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	zw.Write([]byte(`{"char":"好","data":{"strokes":["M 1 2"]}}` + "\n" + `{"char":"一","data":{"strokes":["M 3 4"]}}` + "\n"))
	zw.Close()
	for name, body := range map[string][]byte{"manifest.json": m, strokes.DataFile: gz.Bytes(), "LICENSE": []byte("licence\n")} {
		if err := os.WriteFile(filepath.Join(dir, name), body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestSeedImportsStrokesPacksLast(t *testing.T) {
	if importOrder[dict.TypeStrokes] <= importOrder[dict.TypeComponents] {
		t.Errorf("importOrder[strokes] = %d, want after components %d", importOrder[dict.TypeStrokes], importOrder[dict.TypeComponents])
	}
	sqlDB, _ := openTestDB(t)
	root := t.TempDir()
	dir := writeStrokesPack(t, root)
	var out strings.Builder
	if err := seed(context.Background(), sqlDB, t.TempDir(), []string{root}, &out); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if !strings.Contains(out.String(), "2 characters") {
		t.Errorf("seed output %q lacks the strokes summary", out.String())
	}
	if _, ok, err := strokes.Lookup(context.Background(), sqlDB, "好"); !ok || err != nil {
		t.Errorf("Lookup after seed = %v, %v", ok, err)
	}

	// The stale-terms check knows stroke packs too.
	var rec logRecorder
	warnStalePackTerms(context.Background(), sqlDB, []string{root}, rec.logf)
	if len(rec.lines) != 0 {
		t.Errorf("fresh seed: %q, want no lines", rec.lines)
	}
	editManifest(t, dir, "notice", "Changed.")
	warnStalePackTerms(context.Background(), sqlDB, []string{root}, rec.logf)
	if len(rec.lines) != 1 || !strings.Contains(rec.lines[0], "hw-strokes") {
		t.Errorf("changed notice: %q, want one line naming hw-strokes", rec.lines)
	}
}
