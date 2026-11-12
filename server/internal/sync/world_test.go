package sync_test

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/levels"
	"qinqin/internal/lexicon"
	"qinqin/internal/sentences"
)

// gakkouXML is a one-word JMdict: 学校 with a part of speech and an xref.
const gakkouXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY n "noun (common)">
]>
<JMdict>
<entry>
<ent_seq>1412300</ent_seq>
<k_ele><keb>学校</keb></k_ele>
<r_ele><reb>がっこう</reb></r_ele>
<sense>
<pos>&n;</pos>
<xref>学園</xref>
<gloss>school</gloss>
</sense>
</entry>
</JMdict>
`

// jmdictPack writes a JMdict pack with xml as its data and loads it.
func jmdictPack(t *testing.T, xml string) dict.Pack {
	t.Helper()
	dir := t.TempDir()
	manifest := `{"id":"jm-mini","name":"JMdict mini","version":"1","type":"dictionary","language":"ja","license":"CC BY-SA 4.0","attribution":"test","format":"jmdict"}`
	for name, content := range map[string]string{"manifest.json": manifest, "jmdict.xml": xml} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("load jmdict fixture: %v", err)
	}
	return p
}

// seedWorld installs the shared fixtures through the real importers: the
// zh dictionary mkgloss (好, 你好), a one-word ja JMdict (学校, with POS
// and an xref), a variant link, the hsk-mini levels and the zh-mini
// sentences. Every level member and sentence references a lexicon id.
func seedWorld(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	ctx := context.Background()
	zh, err := dict.LoadPack("../dict/testdata/mkgloss")
	if err != nil {
		t.Fatalf("load dictionary fixture: %v", err)
	}
	if _, err := dict.ImportLexicon(ctx, sqlDB, &zh); err != nil {
		t.Fatalf("import dictionary fixture: %v", err)
	}
	ja := jmdictPack(t, gakkouXML)
	if _, err := dict.ImportLexicon(ctx, sqlDB, &ja); err != nil {
		t.Fatalf("import jmdict fixture: %v", err)
	}
	if err := (lexicon.Store{DB: sqlDB}).Link(ctx, lexID(t, sqlDB, "zh", "word", "你好"), lexID(t, sqlDB, "zh", "character", "好"), lexicon.LinkVariant); err != nil {
		t.Fatalf("link: %v", err)
	}
	levelsPack, err := dict.LoadPack("../levels/testdata/hsk-mini")
	if err != nil {
		t.Fatalf("load levels fixture: %v", err)
	}
	if _, err := levels.Import(ctx, sqlDB, levelsPack); err != nil {
		t.Fatalf("import levels fixture: %v", err)
	}
	sentencePack, err := dict.LoadPack("../sentences/testdata/zh-mini")
	if err != nil {
		t.Fatalf("load sentences fixture: %v", err)
	}
	if _, err := sentences.ImportPack(ctx, sqlDB, sentencePack); err != nil {
		t.Fatalf("import sentences fixture: %v", err)
	}
}

// lexID returns the id of the lexicon entry of (language, kind) that has
// form as one of its forms.
func lexID(t *testing.T, sqlDB *sql.DB, language, kind, form string) int64 {
	t.Helper()
	var id int64
	err := sqlDB.QueryRow(`
		SELECT e.id FROM entries e JOIN forms f ON f.entry_id = e.id
		WHERE e.language = ? AND e.kind = ? AND f.text = ? AND f.deleted_at IS NULL
		ORDER BY e.id LIMIT 1`, language, kind, form).Scan(&id)
	if err != nil {
		t.Fatalf("find lexicon entry %s/%s/%s: %v", language, kind, form, err)
	}
	return id
}

// backdate rewrites every synced table's updated_at to long ago, so a
// later pull sees only rows changed after this call regardless of the
// second-truncated clock.
func backdate(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	for _, table := range []string{"entries", "forms", "readings", "senses", "entry_links",
		"level_members", "sentences", "plugin_data", "plugin_states", "dictionaries", "schemes", "levels"} {
		if _, err := sqlDB.Exec(`UPDATE ` + table + ` SET updated_at = '2020-01-01T00:00:00Z'`); err != nil {
			t.Fatalf("backdate %s: %v", table, err)
		}
	}
}
