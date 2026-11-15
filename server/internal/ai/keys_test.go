package ai

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"qinqin/internal/db"
)

const testKey = "sk-ant-test-ABCD1234"

func openTestDB(t *testing.T) (*sql.DB, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "qinqin.db")
	sqlDB, err := db.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB, path
}

func newStore(sqlDB *sql.DB, current, previous byte) *KeyStore {
	k := &KeyStore{DB: sqlDB, Current: NewSealer(secretBytes(current, 32)), Now: time.Now}
	if previous != 0 {
		k.Previous = NewSealer(secretBytes(previous, 32))
	}
	return k
}

func TestKeyStorePutInfoCredentials(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	ks := newStore(sqlDB, 1, 0)
	ctx := context.Background()
	if err := ks.Put(ctx, 1, "anthropic", testKey, "claude-sonnet-5-5"); err != nil {
		t.Fatal(err)
	}
	info, err := ks.Info(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if info.Hint != "…1234" || info.State != KeyOK || info.Model != "claude-sonnet-5-5" || info.Provider != "anthropic" {
		t.Errorf("info = %+v", info)
	}
	if info.LastUsedAt != nil {
		t.Errorf("last used set before any use: %v", info.LastUsedAt)
	}
	creds, err := ks.Credentials(ctx, 1)
	if err != nil || creds.APIKey != testKey || creds.Model != "claude-sonnet-5-5" {
		t.Fatalf("credentials = %v, %v", creds.Model, err)
	}
	info, _ = ks.Info(ctx, 1)
	if info.LastUsedAt == nil {
		t.Error("last_used_at not stamped by Credentials")
	}
	if err := ks.Put(ctx, 1, "anthropic", testKey, ""); err != nil {
		t.Fatalf("Put with empty model: %v", err)
	}
	if info, _ = ks.Info(ctx, 1); info.Model != DefaultModel {
		t.Errorf("empty model stored as %q, want default", info.Model)
	}
	if err := ks.Put(ctx, 1, "anthropic", testKey, "gpt-9"); err == nil {
		t.Error("invalid model accepted")
	}
	if err := ks.Put(ctx, 1, "anthropic", "  ", ""); err == nil {
		t.Error("empty key accepted")
	}
}

func TestKeyStoreNeverStoresPlaintext(t *testing.T) {
	sqlDB, path := openTestDB(t)
	ks := newStore(sqlDB, 1, 0)
	ctx := context.Background()
	if err := ks.Put(ctx, 1, "anthropic", testKey, ""); err != nil {
		t.Fatal(err)
	}
	var ct, nonce []byte
	var hint, fp string
	if err := sqlDB.QueryRow(`SELECT ciphertext, nonce, hint, secret_fp FROM ai_keys WHERE user_id = 1`).Scan(&ct, &nonce, &hint, &fp); err != nil {
		t.Fatal(err)
	}
	row := string(ct) + string(nonce) + hint + fp
	if strings.Contains(row, testKey) || strings.Contains(string(ct), "ABCD1234") {
		t.Error("row contains the key")
	}
	if hint != "…1234" {
		t.Errorf("hint = %q", hint)
	}
	if _, err := sqlDB.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{path, path + "-wal"} {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		if strings.Contains(string(b), testKey) {
			t.Errorf("%s contains the plain key", p)
		}
		if n := strings.Count(string(b), "ABCD1234"); n != 0 {
			t.Errorf("%s contains ABCD1234 %d times, want only the 4-character hint", p, n)
		}
	}
	creds, _ := ks.Credentials(ctx, 1)
	for _, s := range []string{fmt.Sprintf("%v", creds), fmt.Sprintf("%+v", creds), fmt.Sprintf("%#v", creds), creds.String()} {
		if strings.Contains(s, "ABCD") || strings.Contains(s, "sk-ant") {
			t.Errorf("formatted credentials leak the key: %q", s)
		}
	}
	if creds.String() != "ai.Credentials{redacted}" {
		t.Errorf("String() = %q", creds.String())
	}
}

func TestKeyStoreOtherSecretIsUndecryptable(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	ctx := context.Background()
	if err := newStore(sqlDB, 1, 0).Put(ctx, 1, "anthropic", testKey, ""); err != nil {
		t.Fatal(err)
	}
	other := newStore(sqlDB, 9, 0)
	info, err := other.Info(ctx, 1)
	if err != nil || info.State != KeyUndecryptable {
		t.Fatalf("info = %+v, %v", info, err)
	}
	if _, err := other.Credentials(ctx, 1); !errors.Is(err, ErrKeyUndecryptable) {
		t.Errorf("Credentials err = %v, want ErrKeyUndecryptable", err)
	}
}

func TestKeyStoreRotate(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	ctx := context.Background()
	if err := newStore(sqlDB, 1, 0).Put(ctx, 1, "anthropic", testKey, ""); err != nil {
		t.Fatal(err)
	}
	// Row sealed under a third secret stays untouched.
	if err := newStore(sqlDB, 5, 0).Put(ctx, 2, "anthropic", "sk-ant-other-9999", ""); err != nil {
		t.Fatal(err)
	}
	ks := newStore(sqlDB, 9, 1)
	n, err := ks.Rotate(ctx)
	if err != nil || n != 1 {
		t.Fatalf("Rotate = %d, %v, want 1", n, err)
	}
	alone := newStore(sqlDB, 9, 0)
	creds, err := alone.Credentials(ctx, 1)
	if err != nil || creds.APIKey != testKey {
		t.Fatalf("after rotate: %v", err)
	}
	if _, err := alone.Credentials(ctx, 2); !errors.Is(err, ErrKeyUndecryptable) {
		t.Errorf("foreign row err = %v", err)
	}
	if n, err := ks.Rotate(ctx); err != nil || n != 0 {
		t.Errorf("second Rotate = %d, %v, want 0", n, err)
	}
	if n, err := alone.Rotate(ctx); err != nil || n != 0 {
		t.Errorf("Rotate without Previous = %d, %v, want 0", n, err)
	}
}

func TestKeyStoreSetModelAndDelete(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	ks := newStore(sqlDB, 1, 0)
	ctx := context.Background()
	if err := ks.SetModel(ctx, 1, "claude-haiku-5-5"); !errors.Is(err, ErrNoKey) {
		t.Errorf("SetModel without key = %v, want ErrNoKey", err)
	}
	if err := ks.Put(ctx, 1, "anthropic", testKey, ""); err != nil {
		t.Fatal(err)
	}
	if err := ks.SetModel(ctx, 1, "nope"); err == nil {
		t.Error("SetModel accepted an invalid model")
	}
	if err := ks.SetModel(ctx, 1, "claude-haiku-5-5"); err != nil {
		t.Fatal(err)
	}
	if info, _ := ks.Info(ctx, 1); info.Model != "claude-haiku-5-5" {
		t.Errorf("model = %q", info.Model)
	}
	if creds, err := ks.Credentials(ctx, 1); err != nil || creds.APIKey != testKey {
		t.Errorf("key changed by SetModel: %v", err)
	}
	for i := 0; i < 2; i++ {
		if err := ks.Delete(ctx, 1); err != nil {
			t.Fatalf("Delete #%d: %v", i, err)
		}
	}
	if _, err := ks.Info(ctx, 1); !errors.Is(err, ErrNoKey) {
		t.Errorf("Info after delete = %v, want ErrNoKey", err)
	}
	if _, err := ks.Credentials(ctx, 1); !errors.Is(err, ErrNoKey) {
		t.Errorf("Credentials after delete = %v, want ErrNoKey", err)
	}
}

func TestValidModel(t *testing.T) {
	for _, id := range []string{"claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"} {
		if !ValidModel(id) {
			t.Errorf("%s not valid", id)
		}
	}
	for _, id := range []string{"", "claude-opus-5-5-20260101", "gpt-4"} {
		if ValidModel(id) {
			t.Errorf("%q valid", id)
		}
	}
}
