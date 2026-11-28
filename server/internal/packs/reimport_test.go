package packs_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"qinqin/internal/dbtest"
	"qinqin/internal/lemma"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

// totalChanges is SQLite's count of rows the connection inserted, updated
// or deleted (the handle has one connection).
func totalChanges(t *testing.T, sqlDB *sql.DB) int64 {
	t.Helper()
	var n int64
	if err := sqlDB.QueryRow(`SELECT total_changes()`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// typeCases builds a small valid pack of every type of the table.
var typeCases = map[string]func(t *testing.T) pack.Pack{
	pack.TypeDictionary: dictPack,
	pack.TypeFrequency:  freqPack,
	pack.TypeLevels:     levelsPack,
	pack.TypeSentences:  sentencesPack,
	pack.TypeGrammar:    grammarPack,
	pack.TypeAudio:      func(t *testing.T) pack.Pack { return audioPack(t, "es-audio") },
	pack.TypeComponents: componentsPack,
	pack.TypeStrokes:    strokesPack,
	pack.TypeLemmaRules: func(t *testing.T) pack.Pack {
		return buildPack(t, "lemma-rules", "es-rules", "Spanish rules", "CC0-1.0", "rules-json", map[string]string{"rules.json": xaRules})
	},
	pack.TypeImages: imagesPack,
	pack.TypeCourse: coursePack,
	pack.TypeTheme:  themePack,
	pack.TypeFont:   func(t *testing.T) pack.Pack { p, _ := fontPack(t); return p },
}

// Re-importing a pack that did not change writes no row, for every pack
// type (#192): not its registry row, not its data rows, not its licence
// texts. Before #192 components, audio and fonts rewrote theirs.
func TestReimportOfAnUnchangedPackWritesNothing(t *testing.T) {
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	cases := typeCases
	for _, typ := range pack.Types() {
		build, ok := cases[typ]
		if !ok {
			t.Errorf("%s: no re-import case", typ)
			continue
		}
		t.Run(typ, func(t *testing.T) {
			sqlDB := dbtest.Open(t)
			sqlDB.SetMaxOpenConns(1)
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			stores := t.TempDir()
			opts := []packs.Option{packs.WithAudioStore(filepath.Join(stores, "audio")), packs.WithFontStore(filepath.Join(stores, "fonts"))}
			if typ != pack.TypeDictionary {
				// The entries the other types refer to.
				if _, err := packs.Import(ctx, sqlDB, dictPack(t), opts...); err != nil {
					t.Fatal(err)
				}
			}
			p := build(t)
			first, err := packs.Import(ctx, sqlDB, p, opts...)
			if err != nil {
				t.Fatalf("first import: %v", err)
			}
			before := totalChanges(t, sqlDB)
			again, err := packs.Import(ctx, sqlDB, p, opts...)
			if err != nil {
				t.Fatalf("second import: %v", err)
			}
			if n := totalChanges(t, sqlDB) - before; n != 0 {
				t.Errorf("an unchanged re-import changed %d rows", n)
			}
			if again != first {
				t.Errorf("summary %q, first %q", again, first)
			}
			list, err := packs.List(ctx, sqlDB)
			if err != nil || !slices.ContainsFunc(list, func(i packs.Installed) bool { return i.Type == typ }) {
				t.Errorf("not listed: %+v, %v", list, err)
			}
		})
	}
}
