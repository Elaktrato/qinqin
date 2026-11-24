package packs_test

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/datapkg"
	"qinqin/internal/dbtest"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
)

// phrasebook is a pack type that exists only in this test: a table entry,
// its handler and its registry table are all it takes (#192,
// docs/architecture/0008-pack-types.md).
var phrasebook = pack.Descriptor{Type: "phrasebook", Registry: "phrasebook_packs", Languages: pack.One, Uploadable: true}

var errPhrasebookNotFound = pack.NotFound("phrasebook: pack not found")

func importPhrasebook(ctx context.Context, sqlDB *sql.DB, pk pack.Pack) (string, error) {
	data, err := os.ReadFile(filepath.Join(pk.Dir, "phrases.txt"))
	if err != nil {
		return "", fmt.Errorf("%w: phrases.txt: %v", pack.ErrInvalidPack, err)
	}
	phrases := strings.Split(strings.TrimSpace(string(data)), "\n")
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	_, changed, err := pack.UpsertRegistry(ctx, tx, pack.Registry{Table: phrasebook.Registry, PackID: pk.ID, Stamp: pack.Now(),
		Columns: pack.ManifestColumns(pk.Manifest, pack.Column{Name: "language", Value: pk.Language},
			pack.Column{Name: "phrases", Value: strings.Join(phrases, "\n")})})
	if err != nil {
		return "", err
	}
	if changed {
		if err := tx.Commit(); err != nil {
			return "", err
		}
	}
	return fmt.Sprintf("%d phrases", len(phrases)), nil
}

func uninstallPhrasebook(ctx context.Context, sqlDB *sql.DB, packID string) error {
	res, err := sqlDB.ExecContext(ctx, `UPDATE phrasebook_packs SET deleted_at = ?, updated_at = ? WHERE pack_id = ? AND deleted_at IS NULL`,
		pack.Now(), pack.Now(), packID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return errPhrasebookNotFound
	}
	return nil
}

// phrasebookZip is an uploaded phrasebook pack: a zip of one folder.
func phrasebookZip(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range map[string]string{
		"es-phrases/manifest.json": `{"id":"es-phrases","name":"Spanish phrases","version":"1","type":"phrasebook","language":"es",
			"license":"CC0-1.0","attribution":"Qinqin test fixtures","notice":"Made up.","format":"json"}`,
		"es-phrases/phrases.txt": "hola\ngracias\n",
		"es-phrases/LICENSE":     "CC0 (test)\n",
	} {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(body))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// A new pack type needs only its table entry and handler: it is staged
// (the upload's unzip, load and checks), imported, listed, found,
// re-imported without a write, uninstalled, and its data package plan is
// consistent, with no other code knowing it.
func TestAFakePackTypeNeedsOnlyItsTableEntry(t *testing.T) {
	ctx := context.Background()
	sqlDB := dbtest.Open(t)
	sqlDB.SetMaxOpenConns(1)
	if _, err := sqlDB.Exec(`CREATE TABLE phrasebook_packs (id INTEGER PRIMARY KEY, pack_id TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL, version TEXT NOT NULL, language TEXT NOT NULL, license TEXT NOT NULL, attribution TEXT NOT NULL,
		notice TEXT NOT NULL DEFAULT '', phrases TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`); err != nil {
		t.Fatal(err)
	}
	// Stage: what POST /api/admin/packs/stage does before the review.
	stage := func() (pack.Pack, error) {
		dir := t.TempDir()
		z := phrasebookZip(t)
		if err := pack.ExtractZipAt(bytes.NewReader(z), int64(len(z)), dir, pack.DefaultZipLimits); err != nil {
			t.Fatal(err)
		}
		return pack.LoadExtracted(dir)
	}
	if _, err := stage(); err == nil || !strings.Contains(err.Error(), `unknown type "phrasebook"`) {
		t.Fatalf("before the table entry: %v", err)
	}

	packs.AddTypeForTest(t, phrasebook, importPhrasebook, uninstallPhrasebook)

	pk, err := stage()
	if err != nil {
		t.Fatalf("stage: %v", err)
	}
	if !packs.Supported("phrasebook") || !packs.Installable("phrasebook") {
		t.Error("not supported or not installable")
	}
	if id, lic, _ := packs.RegistryTerms(pk.Manifest); id != "es-phrases" || lic != "CC0-1.0" {
		t.Errorf("registry terms %q, %q", id, lic)
	}
	if _, err := packs.Find(ctx, sqlDB, "phrasebook", "es-phrases"); !errors.Is(err, packs.ErrNotFound) {
		t.Errorf("Find before the import: %v", err)
	}

	// Import, with the change hook the data packages hang off.
	var changes []string
	onChange := packs.WithOnChange(func(typ, id, lang string) { changes = append(changes, typ+"/"+id+"/"+lang) })
	line, err := packs.Import(ctx, sqlDB, pk, onChange)
	if err != nil || line != "2 phrases" {
		t.Fatalf("Import = %q, %v", line, err)
	}
	if !slices.Equal(changes, []string{"phrasebook/es-phrases/es"}) {
		t.Errorf("onChange %v", changes)
	}
	if ok, err := packs.TextsStored(ctx, sqlDB, "phrasebook", "es-phrases"); !ok || err != nil {
		t.Errorf("licence texts stored %v, %v", ok, err)
	}

	// List: after every built-in type (its table position), as any type.
	list, err := packs.List(ctx, sqlDB)
	if err != nil || len(list) != 1 {
		t.Fatalf("List = %+v, %v", list, err)
	}
	if got := list[0]; got.Type != "phrasebook" || got.PackID != "es-phrases" || got.Language != "es" || got.Notice != "Made up." || got.UpdatedAt == "" {
		t.Errorf("listed %+v", got)
	}
	if _, err := packs.Import(ctx, sqlDB, dictPack(t)); err != nil {
		t.Fatal(err)
	}
	if list, _ := packs.List(ctx, sqlDB); len(list) != 2 || list[0].Type != pack.TypeDictionary || list[1].Type != "phrasebook" {
		t.Errorf("order %+v", list)
	}

	// An unchanged re-import writes nothing.
	var before, after int64
	sqlDB.QueryRow(`SELECT total_changes()`).Scan(&before)
	if _, err := packs.Import(ctx, sqlDB, pk); err != nil {
		t.Fatal(err)
	}
	sqlDB.QueryRow(`SELECT total_changes()`).Scan(&after)
	if after != before {
		t.Errorf("re-import changed %d rows", after-before)
	}

	// The data package plan: the type builds no package (Package ""), and
	// the plan still reads.
	specs, err := datapkg.Plan(ctx, sqlDB)
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range specs {
		for _, src := range s.Sources {
			if src.Type == "phrasebook" {
				t.Errorf("a package from a type without one: %+v", s)
			}
		}
	}
	if ids := datapkg.AffectedIDs(ctx, sqlDB, "phrasebook", "es-phrases", "es"); len(ids) != 0 {
		t.Errorf("affected packages %v", ids)
	}

	// Uninstall, then not found.
	changes = nil
	if err := packs.Uninstall(ctx, sqlDB, "phrasebook", "es-phrases", onChange); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(changes, []string{"phrasebook/es-phrases/es"}) {
		t.Errorf("onChange on uninstall %v", changes)
	}
	if ok, _ := packs.TextsStored(ctx, sqlDB, "phrasebook", "es-phrases"); ok {
		t.Error("licence texts kept after the uninstall")
	}
	if err := packs.Uninstall(ctx, sqlDB, "phrasebook", "es-phrases"); !errors.Is(err, packs.ErrNotFound) {
		t.Errorf("second uninstall: %v", err)
	}
	if list, _ := packs.List(ctx, sqlDB); len(list) != 1 {
		t.Errorf("after the uninstall %+v", list)
	}
}
