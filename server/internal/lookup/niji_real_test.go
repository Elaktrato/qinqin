package lookup_test

import (
	"context"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/lexicon"
	"qinqin/internal/realdict"
)

// #347 on the shipped JMdict: 虹 (にじ) is the rainbow (j:1463740), not 二次
// (j:1461870), which lists 虹 only as a search-only form and has the higher
// priority. The word resolver and the lookup popup agree.
func TestNijiResolvesToTheRainbow(t *testing.T) {
	sqlDB := dbtest.Open(t)
	realdict.Import(t, sqlDB, "ja", "虹", "にじ")
	st := lexicon.Store{DB: sqlDB}
	ctx := context.Background()
	for _, reading := range []string{"にじ", ""} {
		e, err := st.BestWordReading(ctx, "ja", "虹", reading)
		if err != nil {
			t.Fatal(err)
		}
		if e.Key != "j:1463740" {
			t.Errorf("BestWordReading(虹, %q) = %s, want j:1463740", reading, e.Key)
		}
	}
	if rs := run(t, service(sqlDB), "ja", "虹が出た", 0); len(rs) == 0 || rs[0].Term != "虹" || rs[0].Senses[0].Glosses[0] != "rainbow" {
		t.Errorf("lookup of 虹: %v", terms(rs))
	}
}
