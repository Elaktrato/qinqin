package features

import (
	"context"
	"errors"
	"testing"

	"qinqin/internal/dbtest"
)

func TestSwitchesPerUser(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	alice, bob := dbtest.User(t, sqlDB, "alice"), dbtest.User(t, sqlDB, "bob")
	list, err := List(ctx, sqlDB, alice)
	if err != nil || len(list) != len(IDs) {
		t.Fatalf("list = %+v (%v)", list, err)
	}
	for i, s := range list {
		if s.ID != IDs[i] || !s.Enabled || s.UpdatedAt != nil {
			t.Errorf("default %d = %+v, want %s on without a stamp", i, s, IDs[i])
		}
	}
	got, err := Set(ctx, sqlDB, alice, "journal", false)
	if err != nil || got.ID != "journal" || got.Enabled || got.UpdatedAt == nil {
		t.Fatalf("set = %+v (%v)", got, err)
	}
	if _, err := Set(ctx, sqlDB, alice, "qinqin-journal", false); !errors.Is(err, ErrUnknown) {
		t.Errorf("an unknown id: %v", err)
	}
	list, _ = List(ctx, sqlDB, alice)
	if list[2].ID != "journal" || list[2].Enabled {
		t.Errorf("alice's journal = %+v", list[2])
	}
	bobs, _ := List(ctx, sqlDB, bob)
	if !bobs[2].Enabled {
		t.Error("alice's switch reached bob")
	}
	if _, err := Set(ctx, sqlDB, alice, "journal", true); err != nil {
		t.Fatal(err)
	}
	if list, _ = List(ctx, sqlDB, alice); !list[2].Enabled {
		t.Error("switching back on did not stick")
	}
}
