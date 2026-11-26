package starter_test

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"testing"

	_ "modernc.org/sqlite"

	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/starter"
)

// TestRealDictionaries resolves the shipped sets against a database seeded with the real JMdict and
// CC-CEDICT (`qinqin seed`), when QINQIN_STARTER_DB names its qinqin.db. Every word must resolve to an
// entry that carries the form (or its kana) and, when the set names a reading, that reading, and no
// two words may resolve to the same entry. It logs each word's first gloss so a person can review the
// set. Skipped without the variable (the dictionaries are not repository content).
func TestRealDictionaries(t *testing.T) {
	path := os.Getenv("QINQIN_STARTER_DB")
	if path == "" {
		t.Skip("QINQIN_STARTER_DB is not set")
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
	store := lexicon.Store{DB: db}
	sets, err := starter.Sets()
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for _, set := range sets {
		got, err := starter.Resolve(ctx, starter.Lexicon{Store: store}, set)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != len(set.Words) {
			have := map[string]bool{}
			for _, g := range got {
				have[g.Word.Form+"|"+g.Word.Reading] = true
			}
			for _, w := range set.Words {
				if !have[w.Form+"|"+w.Reading] {
					t.Errorf("%s: %s %s did not resolve (or repeats an earlier entry)", set.ID, w.Form, w.Reading)
				}
			}
		}
		for _, g := range got {
			e, err := store.Get(ctx, g.EntryID)
			if err != nil {
				t.Fatal(err)
			}
			gloss := ""
			if len(e.Senses) > 0 && len(e.Senses[0].Glosses) > 0 {
				gloss = e.Senses[0].Glosses[0]
			}
			if g.Word.Picture.Target != "" && g.Word.Picture.Target != e.Key {
				t.Errorf("%s: %s resolves to %s, but its picture is mapped to %s", set.ID, g.Word.Form, e.Key, g.Word.Picture.Target)
			}
			var readings []string
			for _, r := range e.Readings {
				readings = append(readings, r.Type+":"+r.Value)
			}
			t.Logf("%s %s -> %d key=%s shown=%s readings=%s gloss=%q (want %q)", set.ID, g.Word.Form, e.ID, e.Key, e.DisplayForm(g.Word.Form), strings.Join(readings, ","), gloss, g.Word.Gloss)
		}
	}
}
