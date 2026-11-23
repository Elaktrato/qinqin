package plugins

import (
	"slices"
	"testing"

	"qinqin/internal/packtype"
)

// GET /api/plugins lists hidden rows for exactly the pack types the
// pack-type table marks LegacyPluginRow (#169, #172), and Exists accepts
// the same types: a new pack type is declared with or without one.
func TestLegacyRowsFollowThePackTypeTable(t *testing.T) {
	var want, got []string
	for _, d := range packtype.All {
		if d.LegacyPluginRow {
			want = append(want, d.Type)
		}
	}
	for typ, row := range legacyRows {
		got = append(got, typ)
		if row.list == nil || row.exists == "" {
			t.Errorf("%s: incomplete legacy row %+v", typ, row)
		}
	}
	slices.Sort(want)
	slices.Sort(got)
	if !slices.Equal(got, want) {
		t.Errorf("legacy plugin rows for %v, table says %v", got, want)
	}
}
