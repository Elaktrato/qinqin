package dict_test

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/model"
)

func TestInstalledDictionaries(t *testing.T) {
	ctx, sqlDB := context.Background(), dbtest.Open(t)
	if list, err := dict.List(ctx, sqlDB); err != nil || list == nil || len(list) != 0 {
		t.Fatalf("empty = %#v, %v", list, err)
	}
	importFixture(t, ctx, sqlDB)
	if _, err := sqlDB.Exec(`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, notice, language, updated_at)
		VALUES (7, 'other', 'Other', '2', 'CC0', 'Ann', 'A notice.', 'ja', 't')`); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO dictionaries (id, pack_id, name, version, license, attribution, updated_at, deleted_at)
		VALUES (8, 'gone', 'Gone', '1', 'CC0', 'Bob', 't', 't')`); err != nil {
		t.Fatal(err)
	}
	mk := dict.Installed{ID: 1, Name: "Mkgloss demo dictionary", Version: "1.0", License: "CC BY-SA 4.0",
		Attribution: "Qinqin test fixtures", PackID: "mkgloss", Language: "zh"}
	other := dict.Installed{ID: 7, Name: "Other", Version: "2", License: "CC0", Attribution: "Ann", Notice: "A notice.", PackID: "other", Language: "ja"}
	list, err := dict.List(ctx, sqlDB)
	if err != nil || !reflect.DeepEqual(list, []dict.Installed{mk, other}) {
		t.Errorf("List = %+v, %v", list, err)
	}
	if got, err := dict.ByPack(ctx, sqlDB, "other"); err != nil || got != other {
		t.Errorf("ByPack = %+v, %v", got, err)
	}
	for _, id := range []string{"gone", "nope"} {
		if _, err := dict.ByPack(ctx, sqlDB, id); !errors.Is(err, dict.ErrNotFound) {
			t.Errorf("ByPack(%s) = %v, want ErrNotFound", id, err)
		}
	}
	for id, want := range map[int64]string{1: "mkgloss", 8: "gone", 99: ""} {
		if got, err := dict.PackOf(ctx, sqlDB, id); err != nil || got != want {
			t.Errorf("PackOf(%d) = %q, %v; want %q", id, got, err, want)
		}
	}
	credits, err := dict.Credits(ctx, sqlDB, []int64{7, 1, 7})
	want := map[int64]model.Dictionary{
		1: {ID: 1, PackID: "mkgloss", Name: "Mkgloss demo dictionary", License: "CC BY-SA 4.0", Attribution: "Qinqin test fixtures"},
		7: {ID: 7, PackID: "other", Name: "Other", License: "CC0", Attribution: "Ann"},
	}
	if err != nil || !reflect.DeepEqual(credits, want) {
		t.Errorf("Credits = %+v, %v", credits, err)
	}
	if _, err := dict.Credits(ctx, sqlDB, []int64{99}); err == nil {
		t.Error("Credits of an unknown dictionary did not fail")
	}
}
