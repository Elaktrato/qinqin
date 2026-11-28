package levels_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/lang"
	"qinqin/internal/levels"
)

// SchemeWords returns a word scheme's levels in order with their listed (not derived) members in membership order,
// and the scheme's version; an unknown, uninstalled or other-language scheme is ErrNotFound.
func TestSchemeWords(t *testing.T) {
	lang.Register(lang.Zh{})
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	fe := seedFixture(t, sqlDB)
	pk := buildPack(t, "words-test", `{"unit":"word","levels":[
		{"name":"1","entries":["谢谢","你好"]},
		{"name":"2","entries":["你好","银行"]}]}`)
	if _, err := levels.Import(ctx, sqlDB, pk); err != nil {
		t.Fatal(err)
	}
	got, err := levels.SchemeWords(ctx, sqlDB, "words-test", "zh")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Levels) != 2 || got.Levels[0].Name != "1" || got.Levels[1].Name != "2" || got.Version == "" {
		t.Fatalf("SchemeWords = %+v", got)
	}
	if !slices.Equal(got.Levels[0].EntryIDs, []int64{fe.xiexie, fe.nihao}) || !slices.Equal(got.Levels[1].EntryIDs, []int64{fe.yinhang}) {
		t.Fatalf("members %v / %v, want 谢谢 你好 / 银行 (你好 keeps its lowest level; no derived characters)", got.Levels[0].EntryIDs, got.Levels[1].EntryIDs)
	}
	for _, c := range []struct{ id, language string }{{"words-test", "ja"}, {"nope", "zh"}} {
		if _, err := levels.SchemeWords(ctx, sqlDB, c.id, c.language); !errors.Is(err, levels.ErrNotFound) {
			t.Errorf("%s/%s: %v, want ErrNotFound", c.id, c.language, err)
		}
	}
}
