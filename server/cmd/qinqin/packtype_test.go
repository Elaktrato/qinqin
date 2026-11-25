package main

import (
	"testing"

	"qinqin/internal/pack"
)

// The licence check reads every pack type's registry (#172: sentences were
// missing), and seed imports in the table's order.
func TestLicenceCheckAndSeedCoverEveryPackType(t *testing.T) {
	tables := staleCheckTables()
	if len(tables) != len(pack.All) {
		t.Errorf("licence check reads %d registries, the table has %d types", len(tables), len(pack.All))
	}
	for i, d := range pack.All {
		if tables[d.Type] != d.Registry {
			t.Errorf("%s: licence check reads %q, want %q", d.Type, tables[d.Type], d.Registry)
		}
		if importRank(d.Type) != i {
			t.Errorf("%s: import rank %d, want %d", d.Type, importRank(d.Type), i)
		}
	}
}
