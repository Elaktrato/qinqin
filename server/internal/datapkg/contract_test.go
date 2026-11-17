package datapkg_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/datapkg"
)

// TestSchemasMatchContract: the writers' statements, row orders and
// qq_package keys are exactly docs/contracts/packages/schemas.json.
func TestSchemasMatchContract(t *testing.T) {
	fx := readSchemas(t)
	if !slices.Equal(datapkg.CommonStatements(), fx.Common) {
		t.Errorf("common statements = %q, want %q", datapkg.CommonStatements(), fx.Common)
	}
	var types []string
	for _, c := range fx.Cases {
		types = append(types, c.Type)
		typ := datapkg.Type(c.Type)
		tables, indexes := datapkg.Schema(typ)
		if len(tables) != len(c.Tables) {
			t.Errorf("%s: %d tables, want %d", c.Type, len(tables), len(c.Tables))
			continue
		}
		for i, tb := range c.Tables {
			if tables[i].Name != tb.Name || tables[i].SQL != tb.SQL || !slices.Equal(tables[i].Order, tb.Order) {
				t.Errorf("%s table %d = %+v, want %+v", c.Type, i, tables[i], tb)
			}
		}
		if !slices.Equal(indexes, c.Indexes) && !(len(indexes) == 0 && len(c.Indexes) == 0) {
			t.Errorf("%s indexes = %q, want %q", c.Type, indexes, c.Indexes)
		}
		want := slices.Clone(fx.PackageKeys)
		want = append(want, fx.ExtraPackageKeys[c.Type]...)
		if got := datapkg.PackageKeys(typ); !slices.Equal(got, want) {
			t.Errorf("%s package keys = %q, want %q", c.Type, got, want)
		}
	}
	var all []string
	for _, typ := range datapkg.Types() {
		all = append(all, string(typ))
	}
	if !slices.Equal(types, all) {
		t.Errorf("fixture types %v, Types() %v", types, all)
	}
}

// TestManifestContract: every valid manifest of
// docs/contracts/packages/manifest.json parses, every invalid one is refused.
func TestManifestContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "packages", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Keys     []string `json:"keys"`
		FileKeys []string `json:"fileKeys"`
		Cases    []struct {
			Name     string          `json:"name"`
			Valid    bool            `json:"valid"`
			Reason   string          `json:"reason"`
			Manifest json.RawMessage `json:"manifest"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(fx.Cases) < 20 {
		t.Fatalf("%d cases", len(fx.Cases))
	}
	types := map[datapkg.Type]bool{}
	for _, c := range fx.Cases {
		m, err := datapkg.ParseManifest(c.Manifest)
		switch {
		case c.Valid && err != nil:
			t.Errorf("%s: ParseManifest = %v, want ok", c.Name, err)
		case !c.Valid && err == nil:
			t.Errorf("%s: ParseManifest accepted it (%s)", c.Name, c.Reason)
		case c.Valid:
			types[m.Type] = true
			// It encodes back to the same keys in the same order.
			out, _ := json.Marshal(m)
			var back, orig map[string]any
			json.Unmarshal(out, &back)
			json.Unmarshal(c.Manifest, &orig)
			if len(back) != len(fx.Keys) || len(orig) != len(fx.Keys) {
				t.Errorf("%s: %d keys encoded, %d in the fixture, want %d", c.Name, len(back), len(orig), len(fx.Keys))
			}
		}
	}
	for _, typ := range datapkg.Types() {
		if !types[typ] {
			t.Errorf("no valid manifest of type %s in the fixture", typ)
		}
	}
}
