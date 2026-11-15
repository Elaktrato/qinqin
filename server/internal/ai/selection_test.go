package ai

import (
	"context"
	"errors"
	"testing"
	"time"
)

func newSelection(t *testing.T) (*Selection, *KeyStore) {
	t.Helper()
	sqlDB, _ := openTestDB(t)
	return &Selection{DB: sqlDB, Now: time.Now}, newStore(sqlDB, 1, 0)
}

func TestSelectionRequiresKey(t *testing.T) {
	sel, ks := newSelection(t)
	ctx := context.Background()
	if _, err := sel.Active(ctx, 1); !errors.Is(err, ErrNoSelection) {
		t.Fatalf("Active with nothing = %v, want ErrNoSelection", err)
	}
	if err := sel.SetActive(ctx, 1, "openai"); !errors.Is(err, ErrNoKey) {
		t.Fatalf("SetActive without key = %v, want ErrNoKey", err)
	}
	if err := ks.Put(ctx, 1, "openai", "sk-fake-openai-key-0001", "gpt-6-astra", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	// User 2 has no key: user 1's key does not count.
	if err := sel.SetActive(ctx, 2, "openai"); !errors.Is(err, ErrNoKey) {
		t.Fatalf("SetActive for another user = %v, want ErrNoKey", err)
	}
	if err := sel.SetActive(ctx, 1, "openai"); err != nil {
		t.Fatal(err)
	}
	if p, err := sel.Active(ctx, 1); err != nil || p != "openai" {
		t.Fatalf("Active = %q, %v", p, err)
	}
	if err := ks.Put(ctx, 1, "gemini", "sk-fake-gemini-key-0001", "gemini-3.8-flash", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := sel.SetActive(ctx, 1, "gemini"); err != nil {
		t.Fatal(err)
	}
	if p, _ := sel.Active(ctx, 1); p != "gemini" {
		t.Errorf("Active after switch = %q", p)
	}
}

func TestSelectionClear(t *testing.T) {
	sel, ks := newSelection(t)
	ctx := context.Background()
	for _, u := range []int64{1, 2} {
		if err := ks.Put(ctx, u, "custom-abcdefghij", "sk-fake-custom-key-0001", "m", PutOptions{}); err != nil {
			t.Fatal(err)
		}
		if err := sel.SetActive(ctx, u, "custom-abcdefghij"); err != nil {
			t.Fatal(err)
		}
	}
	if err := sel.Clear(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := sel.Active(ctx, 1); !errors.Is(err, ErrNoSelection) {
		t.Errorf("user 1 after Clear = %v", err)
	}
	if p, err := sel.Active(ctx, 2); err != nil || p != "custom-abcdefghij" {
		t.Errorf("user 2 changed: %q, %v", p, err)
	}
	if err := sel.Clear(ctx, 1); err != nil {
		t.Errorf("Clear twice: %v", err)
	}
	if err := sel.ClearProvider(ctx, "custom-abcdefghij"); err != nil {
		t.Fatal(err)
	}
	if _, err := sel.Active(ctx, 2); !errors.Is(err, ErrNoSelection) {
		t.Errorf("user 2 after ClearProvider = %v", err)
	}
}
