package sentences_test

import (
	"context"
	"reflect"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/sentences"
)

func TestListPacks(t *testing.T) {
	ctx, sqlDB := context.Background(), dbtest.Open(t)
	if list, err := sentences.ListPacks(ctx, sqlDB); err != nil || list == nil || len(list) != 0 {
		t.Fatalf("empty = %#v, %v", list, err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO sentence_packs (pack_id, name, version, language, license, attribution, notice, updated_at, deleted_at) VALUES
		('b', 'B', '1', 'zh', 'l', 'a', 'n', 't', NULL), ('a', 'B', '2', 'ja', 'l2', 'a2', '', 't', NULL),
		('c', 'A', '1', 'zh', 'l', 'a', '', 't', NULL), ('gone', 'A', '1', 'zh', 'l', 'a', '', 't', 't')`); err != nil {
		t.Fatal(err)
	}
	list, err := sentences.ListPacks(ctx, sqlDB)
	want := []sentences.PackInfo{
		{PackID: "c", Name: "A", Version: "1", Language: "zh", License: "l", Attribution: "a"},
		{PackID: "a", Name: "B", Version: "2", Language: "ja", License: "l2", Attribution: "a2"},
		{PackID: "b", Name: "B", Version: "1", Language: "zh", License: "l", Attribution: "a", Notice: "n"},
	}
	if err != nil || !reflect.DeepEqual(list, want) {
		t.Errorf("ListPacks = %+v, %v", list, err)
	}
}
