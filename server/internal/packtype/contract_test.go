package packtype_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"qinqin/internal/packtype"
)

// docs/contracts/packages/pack-types.json is the clients' copy of the
// table: the same types in the same order with the same fields.
func TestTableMatchesTheContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "packages", "pack-types.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Types []struct {
			Type            string  `json:"type"`
			Registry        string  `json:"registry"`
			Languages       string  `json:"languages"`
			Uploadable      bool    `json:"uploadable"`
			Package         *string `json:"package"`
			RequiresLexicon bool    `json:"requiresLexicon"`
			OptionalPackage bool    `json:"optionalPackage"`
			LegacyPluginRow bool    `json:"legacyPluginRow"`
		} `json:"types"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(fx.Types) != len(packtype.All) {
		t.Fatalf("fixture has %d types, the table %d", len(fx.Types), len(packtype.All))
	}
	shape := map[packtype.Languages]string{packtype.One: "one", packtype.Many: "many", packtype.None: "none"}
	for i, d := range packtype.All {
		c := fx.Types[i]
		pkg := ""
		if c.Package != nil {
			pkg = *c.Package
		}
		if c.Type != d.Type || c.Registry != d.Registry || c.Languages != shape[d.Languages] || c.Uploadable != d.Uploadable ||
			pkg != d.Package || c.RequiresLexicon != d.RequiresLexicon || c.OptionalPackage != d.OptionalPackage ||
			c.LegacyPluginRow != d.LegacyPluginRow {
			t.Errorf("row %d: fixture %+v (package %q), table %+v", i, c, pkg, d)
		}
	}
}
