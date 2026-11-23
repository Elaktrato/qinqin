package packs_test

import (
	"context"
	"slices"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/packs"
	"qinqin/internal/packtype"
)

// Every pack type of the table has an importer and an uninstaller here,
// and nothing else does (#172): a new type fails this test until both exist.
func TestEveryPackTypeHasItsOperations(t *testing.T) {
	got := packs.OperationTypes()
	slices.Sort(got)
	want := packtype.Types()
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Errorf("import/uninstall operations for %v, pack types %v", got, want)
	}
	for _, typ := range packtype.Types() {
		if !packs.Supported(typ) {
			t.Errorf("%s not supported", typ)
		}
		d, _ := packtype.Lookup(typ)
		if packs.Installable(typ) != d.Uploadable {
			t.Errorf("%s: Installable %v, table says %v", typ, packs.Installable(typ), d.Uploadable)
		}
	}
	if packs.Supported("lexicon") {
		t.Error("a package type is not a pack type")
	}
}

// Every registry table of the table exists in a migrated database with the
// columns the generic queries read (List, the licence check, the package
// plan): a new type needs its migration.
func TestEveryRegistryTableHasTheStandardColumns(t *testing.T) {
	sqlDB := dbtest.Open(t)
	for _, d := range packtype.All {
		rows, err := sqlDB.QueryContext(context.Background(), `SELECT name FROM pragma_table_info(?)`, d.Registry)
		if err != nil {
			t.Fatal(err)
		}
		cols := map[string]bool{}
		for rows.Next() {
			var c string
			rows.Scan(&c)
			cols[c] = true
		}
		rows.Close()
		want := []string{"pack_id", "name", "version", "license", "attribution", "notice", "updated_at", "deleted_at"}
		switch d.Languages {
		case packtype.One:
			want = append(want, "language")
		case packtype.Many:
			want = append(want, "languages")
		}
		for _, c := range want {
			if !cols[c] {
				t.Errorf("%s: registry %s lacks column %s", d.Type, d.Registry, c)
			}
		}
	}
}

// List orders the types as the table does.
func TestListOrderIsTheTableOrder(t *testing.T) {
	for i := 1; i < len(packtype.All); i++ {
		if !packs.TypeBefore(packtype.All[i-1].Type, packtype.All[i].Type) {
			t.Errorf("%s does not list before %s", packtype.All[i-1].Type, packtype.All[i].Type)
		}
	}
}
