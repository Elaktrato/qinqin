package datapkg_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/datapkg"
	"qinqin/internal/packtype"
)

// The package types are the pack-type table's (#172): every pack type with
// a package is planned, has a schema, and is in the id grammar the contract
// states; a new type with a package fails here until all of that exists.
func TestPackageTypesFollowThePackTypeTable(t *testing.T) {
	var want []string
	for _, d := range packtype.All {
		if d.Package != "" {
			want = append(want, d.Package)
		}
	}
	var got []string
	for _, typ := range datapkg.Types() {
		got = append(got, string(typ))
		if tables, _ := datapkg.Schema(typ); len(tables) == 0 {
			t.Errorf("%s: no package schema", typ)
		}
	}
	slices.Sort(want)
	slices.Sort(got)
	if !slices.Equal(got, want) {
		t.Errorf("Types() %v, table packages %v", got, want)
	}

	plan := datapkg.PlanSourceForTest()
	for _, d := range packtype.All {
		if d.Package == "" || d.Package == packtype.LexiconPackage {
			continue
		}
		src, ok := plan[datapkg.Type(d.Package)]
		if !ok || src.PackType != d.Type || src.Optional != d.OptionalPackage || src.RequiresLexicon != d.RequiresLexicon {
			t.Errorf("%s: planned as %+v (%v)", d.Type, src, ok)
		}
	}
	if len(plan) != len(want)-1 {
		t.Errorf("planned package types %v", plan)
	}

	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "packages", "catalogue.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		IDPattern string `json:"idPattern"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if datapkg.IDPatternForTest() != fx.IDPattern {
		t.Errorf("id pattern\n%s\nwant (catalogue.json)\n%s", datapkg.IDPatternForTest(), fx.IDPattern)
	}
}
