package packs_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

func strokesPack(t *testing.T) pack.Pack {
	t.Helper()
	dir := t.TempDir()
	m, _ := json.Marshal(map[string]any{
		"id": "hanzi-writer-strokes", "name": "Hanzi Writer stroke data", "version": "2.0.1", "type": "strokes",
		"languages": []string{"zh", "ja"}, "license": "Arphic Public License",
		"attribution": "Make Me a Hanzi via hanzi-writer-data", "format": "hanzi-writer-jsonl-gz",
	})
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	zw.Write([]byte(`{"char":"好","data":{"strokes":["M 1 2"],"medians":[[[1,2]]]}}` + "\n" +
		`{"char":"一","data":{"strokes":["M 3 4"],"medians":[[[3,4]]]}}` + "\n"))
	zw.Close()
	for name, body := range map[string][]byte{
		"manifest.json":    m,
		"strokes.jsonl.gz": gz.Bytes(),
		"LICENSE":          []byte("ARPHIC PUBLIC LICENSE (test stand-in)\n"),
	} {
		if err := os.WriteFile(filepath.Join(dir, name), body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := pack.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	return p
}

func TestStrokesPacks(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	importAll(t, sqlDB)
	got, err := packs.Import(ctx, sqlDB, strokesPack(t))
	if err != nil || got != "2 characters" {
		t.Fatalf("Import = %q, %v", got, err)
	}
	if !packs.Supported("strokes") || !packs.Installable("strokes") {
		t.Errorf("strokes must be supported and installable (admin upload)")
	}
	list, _ := packs.List(ctx, sqlDB)
	last := list[len(list)-1]
	if last.Type != "strokes" || last.PackID != "hanzi-writer-strokes" || last.License != "Arphic Public License" ||
		last.Version != "2.0.1" || last.UpdatedAt == "" || last.Language != "" ||
		!slices.Equal(last.Languages, []string{"ja", "zh"}) {
		t.Fatalf("strokes row = %+v", last)
	}
	// Other types carry no languages list.
	if list[0].Languages != nil {
		t.Errorf("dictionary row has languages: %+v", list[0])
	}
	if _, err := packs.Find(ctx, sqlDB, "strokes", "hanzi-writer-strokes"); err != nil {
		t.Errorf("Find = %v", err)
	}
	texts, err := packs.Texts(ctx, sqlDB, "strokes", "hanzi-writer-strokes")
	if err != nil || len(texts) != 1 || texts[0].Name != "LICENSE" {
		t.Errorf("Texts = %+v, %v", texts, err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "strokes", "hanzi-writer-strokes"); err != nil {
		t.Fatal(err)
	}
	if err := packs.Uninstall(ctx, sqlDB, "strokes", "hanzi-writer-strokes"); !errors.Is(err, packs.ErrNotFound) {
		t.Errorf("second uninstall = %v", err)
	}
	var rows int
	sqlDB.QueryRow(`SELECT COUNT(*) FROM strokes`).Scan(&rows)
	if rows != 0 {
		t.Errorf("stroke rows after uninstall = %d", rows)
	}
	if texts, _ := packs.Texts(ctx, sqlDB, "strokes", "hanzi-writer-strokes"); len(texts) != 0 {
		t.Errorf("texts after uninstall = %+v", texts)
	}
}
