package sentences_test

import (
	"context"
	"database/sql"
	"testing"

	"qinqin/internal/sentences"
)

type regRow struct {
	name, version, language, license, attribution, notice string
	deleted                                               bool
}

func registryRow(t *testing.T, sqlDB *sql.DB, packID string) (regRow, bool) {
	t.Helper()
	var r regRow
	err := sqlDB.QueryRow(`SELECT name, version, language, license, attribution, notice, deleted_at IS NOT NULL
		FROM sentence_packs WHERE pack_id = ?`, packID).
		Scan(&r.name, &r.version, &r.language, &r.license, &r.attribution, &r.notice, &r.deleted)
	if err == sql.ErrNoRows {
		return r, false
	}
	if err != nil {
		t.Fatal(err)
	}
	return r, true
}

func TestSentencePackRegistry(t *testing.T) {
	sqlDB := newDB(t)
	ctx := context.Background()
	seedWords(t, sqlDB)
	pack := buildPack(t, "reg-pack", `{"entries":[{"word":"你好","sentences":[{"hanzi":"你好。","pinyin":"nǐ hǎo.","translation":"Hello."}]}]}`)
	pack.Notice = "Mind the licence."
	if _, err := sentences.ImportPack(ctx, sqlDB, pack); err != nil {
		t.Fatal(err)
	}
	r, ok := registryRow(t, sqlDB, "reg-pack")
	want := regRow{"Test sentences", "1.0", "zh", "CC BY-SA 4.0", "Qinqin test fixtures", "Mind the licence.", false}
	if !ok || r != want {
		t.Fatalf("row = %+v ok=%v, want %+v", r, ok, want)
	}

	pack.Version = "2.0"
	pack.License = "CC0-1.0"
	if _, err := sentences.ImportPack(ctx, sqlDB, pack); err != nil {
		t.Fatal(err)
	}
	if r, _ := registryRow(t, sqlDB, "reg-pack"); r.version != "2.0" || r.license != "CC0-1.0" {
		t.Errorf("re-import row = %+v", r)
	}

	if err := sentences.Uninstall(ctx, sqlDB, "reg-pack"); err != nil {
		t.Fatal(err)
	}
	if r, _ := registryRow(t, sqlDB, "reg-pack"); !r.deleted {
		t.Errorf("uninstall left the registry row live: %+v", r)
	}

	if _, err := sentences.ImportPack(ctx, sqlDB, pack); err != nil {
		t.Fatal(err)
	}
	if r, _ := registryRow(t, sqlDB, "reg-pack"); r.deleted {
		t.Errorf("re-import after uninstall kept deleted_at: %+v", r)
	}
}
