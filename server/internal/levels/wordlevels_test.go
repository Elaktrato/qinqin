package levels_test

import (
	"context"
	"maps"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/levels"
)

// WordLevels (#349): the lowest level index of each direct member of a
// live word scheme of the language; a character only derived from a
// listed word, a character scheme's member and an unlisted entry map to
// nothing; two word schemes give the lower index.
func TestWordLevels(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	fe := seedFixture(t, sqlDB)
	if _, err := levels.Import(ctx, sqlDB, buildPack(t, "words-a", `{"unit":"word","levels":[
		{"name":"1","entries":["你好"]},
		{"name":"2","entries":["谢谢","你"]}]}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := levels.Import(ctx, sqlDB, buildPack(t, "words-b", `{"unit":"word","levels":[
		{"name":"A","entries":["谢谢"]}]}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := levels.Import(ctx, sqlDB, buildPack(t, "chars", `{"unit":"hanzi","levels":[
		{"name":"A","entries":["发"]}]}`)); err != nil {
		t.Fatal(err)
	}
	ids := []int64{fe.nihao, fe.xiexie, fe.yinhang, fe.chars["你"], fe.chars["好"], fe.chars["发"]}
	got, err := levels.WordLevels(ctx, sqlDB, "zh", ids)
	if err != nil {
		t.Fatal(err)
	}
	// 你 is listed at 2 but derived at 1 from 你好: one membership, derived,
	// so it is not a listed word. 好 is only derived.
	want := map[int64]int{fe.nihao: 0, fe.xiexie: 0}
	if !maps.Equal(got, want) {
		t.Errorf("WordLevels = %v, want %v", got, want)
	}
	if got, err := levels.WordLevels(ctx, sqlDB, "ja", ids); err != nil || len(got) != 0 {
		t.Errorf("WordLevels(ja) = %v, %v; want none", got, err)
	}
	if got, err := levels.WordLevels(ctx, sqlDB, "zh", nil); err != nil || len(got) != 0 {
		t.Errorf("WordLevels(no ids) = %v, %v", got, err)
	}
}
