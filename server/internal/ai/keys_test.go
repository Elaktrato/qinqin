package ai

import (
	"context"
	"database/sql"
	"encoding/json"
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
	if err := ks.Put(ctx, 1, "anthropic", testKey, "claude-sonnet-5-5", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	info, err := ks.Info(ctx, 1, "anthropic")
	if err != nil {
		t.Fatal(err)
	}
	if info.Hint != "…1234" || info.State != KeyOK || info.Model != "claude-sonnet-5-5" || info.Provider != "anthropic" {
		t.Errorf("info = %+v", info)
	}
	if info.LastUsedAt != nil {
		t.Errorf("last used set before any use: %v", info.LastUsedAt)
	}
	creds, err := ks.Credentials(ctx, 1, "anthropic")
	if err != nil || creds.APIKey != testKey || creds.Model != "claude-sonnet-5-5" {
		t.Fatalf("credentials = %v, %v", creds.Model, err)
	}
	info, _ = ks.Info(ctx, 1, "anthropic")
	if info.LastUsedAt == nil {
		t.Error("last_used_at not stamped by Credentials")
	}
	if err := ks.Put(ctx, 1, "anthropic", testKey, "", PutOptions{}); err != nil {
		t.Fatalf("Put with empty model: %v", err)
	}
	if info, _ = ks.Info(ctx, 1, "anthropic"); info.Model != DefaultModel {
		t.Errorf("empty model stored as %q, want default", info.Model)
	}
	if err := ks.Put(ctx, 1, "anthropic", testKey, "gpt 9", PutOptions{}); err == nil {
		t.Error("invalid model accepted")
	}
	if err := ks.Put(ctx, 1, "anthropic", "  ", "", PutOptions{}); err == nil {
		t.Error("empty key accepted")
	}
}

func TestKeyStoreNeverStoresPlaintext(t *testing.T) {
	sqlDB, path := openTestDB(t)
	ks := newStore(sqlDB, 1, 0)
	ctx := context.Background()
	if err := ks.Put(ctx, 1, "anthropic", testKey, "", PutOptions{}); err != nil {
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
	creds, _ := ks.Credentials(ctx, 1, "anthropic")
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
	if err := newStore(sqlDB, 1, 0).Put(ctx, 1, "anthropic", testKey, "", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	other := newStore(sqlDB, 9, 0)
	info, err := other.Info(ctx, 1, "anthropic")
	if err != nil || info.State != KeyUndecryptable {
		t.Fatalf("info = %+v, %v", info, err)
	}
	if _, err := other.Credentials(ctx, 1, "anthropic"); !errors.Is(err, ErrKeyUndecryptable) {
		t.Errorf("Credentials err = %v, want ErrKeyUndecryptable", err)
	}
}

func TestKeyStoreRotate(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	ctx := context.Background()
	if err := newStore(sqlDB, 1, 0).Put(ctx, 1, "anthropic", testKey, "", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	// Row sealed under a third secret stays untouched.
	if err := newStore(sqlDB, 5, 0).Put(ctx, 2, "anthropic", "sk-ant-other-9999", "", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	ks := newStore(sqlDB, 9, 1)
	n, err := ks.Rotate(ctx)
	if err != nil || n != 1 {
		t.Fatalf("Rotate = %d, %v, want 1", n, err)
	}
	alone := newStore(sqlDB, 9, 0)
	creds, err := alone.Credentials(ctx, 1, "anthropic")
	if err != nil || creds.APIKey != testKey {
		t.Fatalf("after rotate: %v", err)
	}
	if _, err := alone.Credentials(ctx, 2, "anthropic"); !errors.Is(err, ErrKeyUndecryptable) {
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
	if err := ks.SetModel(ctx, 1, "anthropic", "claude-haiku-5-5"); !errors.Is(err, ErrNoKey) {
		t.Errorf("SetModel without key = %v, want ErrNoKey", err)
	}
	if err := ks.Put(ctx, 1, "anthropic", testKey, "", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := ks.SetModel(ctx, 1, "anthropic", "no pe"); err == nil {
		t.Error("SetModel accepted an invalid model")
	}
	if err := ks.SetModel(ctx, 1, "anthropic", "claude-haiku-5-5"); err != nil {
		t.Fatal(err)
	}
	if info, _ := ks.Info(ctx, 1, "anthropic"); info.Model != "claude-haiku-5-5" {
		t.Errorf("model = %q", info.Model)
	}
	if creds, err := ks.Credentials(ctx, 1, "anthropic"); err != nil || creds.APIKey != testKey {
		t.Errorf("key changed by SetModel: %v", err)
	}
	for i := 0; i < 2; i++ {
		if err := ks.Delete(ctx, 1, "anthropic"); err != nil {
			t.Fatalf("Delete #%d: %v", i, err)
		}
	}
	if _, err := ks.Info(ctx, 1, "anthropic"); !errors.Is(err, ErrNoKey) {
		t.Errorf("Info after delete = %v, want ErrNoKey", err)
	}
	if _, err := ks.Credentials(ctx, 1, "anthropic"); !errors.Is(err, ErrNoKey) {
		t.Errorf("Credentials after delete = %v, want ErrNoKey", err)
	}
}

func TestValidModelID(t *testing.T) {
	for _, id := range []string{"claude-opus-5-5", "gpt-6-astra", "openai/gpt-oss-120b", "llama3.2:3b", "a", "x@y-1.2_3", strings.Repeat("a", 200)} {
		if !ValidModelID(id) {
			t.Errorf("%s not valid", id)
		}
	}
	for _, id := range []string{"", "a b", "-a", ".a", "a\nb", "a$b", strings.Repeat("a", 201), "é"} {
		if ValidModelID(id) {
			t.Errorf("%q valid", id)
		}
	}
}

func TestCredentialsNeverEncodeKey(t *testing.T) {
	c := Credentials{APIKey: "sk-ant-SECRET-VALUE-1234", Model: "claude-opus-5-5"}
	outs := map[string]string{
		"%v": fmt.Sprintf("%v", c), "%+v": fmt.Sprintf("%+v", c), "%#v": fmt.Sprintf("%#v", c),
		"%s": fmt.Sprintf("%s", c), "%v ptr": fmt.Sprintf("%v", &c), "%+v ptr": fmt.Sprintf("%+v", &c),
		"%#v ptr": fmt.Sprintf("%#v", &c), "%x": fmt.Sprintf("%x", c),
	}
	j, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	outs["json"] = string(j)
	jp, _ := json.Marshal(map[string]any{"c": &c, "s": []Credentials{c}})
	outs["json nested"] = string(jp)
	txt, err := c.MarshalText()
	if err != nil {
		t.Fatal(err)
	}
	outs["text"] = string(txt)
	for name, o := range outs {
		if strings.Contains(o, "SECRET") || strings.Contains(o, "sk-ant") {
			t.Errorf("%s leaks the key: %s", name, o)
		}
	}
}

func TestPutPerProviderIndependent(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	ks := newStore(sqlDB, 1, 0)
	ctx := context.Background()
	if err := ks.Put(ctx, 1, "anthropic", testKey, "claude-opus-5-5", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := ks.Put(ctx, 1, "openai", "sk-fake-openai-key-0001", "gpt-6-astra", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	list, err := ks.List(ctx, 1)
	if err != nil || len(list) != 2 || list[0].Provider != "anthropic" || list[1].Provider != "openai" {
		t.Fatalf("List = %+v, %v", list, err)
	}
	for _, k := range list {
		if k.State != KeyOK {
			t.Errorf("%s state = %s", k.Provider, k.State)
		}
	}
	if c, err := ks.Credentials(ctx, 1, "openai"); err != nil || c.APIKey != "sk-fake-openai-key-0001" || c.Model != "gpt-6-astra" {
		t.Errorf("openai credentials: %v", err)
	}
	if err := ks.Delete(ctx, 1, "anthropic"); err != nil {
		t.Fatal(err)
	}
	if _, err := ks.Info(ctx, 1, "openai"); err != nil {
		t.Errorf("openai key lost when anthropic was deleted: %v", err)
	}
	if _, err := ks.Info(ctx, 1, "anthropic"); !errors.Is(err, ErrNoKey) {
		t.Errorf("anthropic after delete = %v", err)
	}
	// Replacing one provider's key leaves the other alone.
	if err := ks.Put(ctx, 1, "openai", "sk-fake-openai-key-0002", "gpt-6-luna", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if list, _ = ks.List(ctx, 1); len(list) != 1 || list[0].Model != "gpt-6-luna" {
		t.Errorf("after replace: %+v", list)
	}
}

func TestKeyOfOtherProviderDoesNotOpen(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	ks := newStore(sqlDB, 1, 0)
	ctx := context.Background()
	if err := ks.Put(ctx, 1, "openai", "sk-fake-openai-key-0001", "gpt-6-astra", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if err := ks.Put(ctx, 1, "deepseek", "sk-fake-deepseek-0001xx", "deepseek-flash", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	// An attacker with write access copies the openai ciphertext over deepseek's row.
	if _, err := sqlDB.Exec(`UPDATE ai_keys SET ciphertext = o.ciphertext, nonce = o.nonce, secret_fp = o.secret_fp
		FROM (SELECT ciphertext, nonce, secret_fp FROM ai_keys WHERE user_id = 1 AND provider = 'openai') AS o
		WHERE ai_keys.user_id = 1 AND ai_keys.provider = 'deepseek'`); err != nil {
		t.Fatal(err)
	}
	info, err := ks.Info(ctx, 1, "deepseek")
	if err != nil || info.State != KeyUndecryptable {
		t.Fatalf("Info = %+v, %v", info, err)
	}
	if _, err := ks.Credentials(ctx, 1, "deepseek"); !errors.Is(err, ErrKeyUndecryptable) {
		t.Errorf("Credentials err = %v, want ErrKeyUndecryptable", err)
	}
}

func TestCrossUserRowDoesNotOpen(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	ks := newStore(sqlDB, 1, 0)
	ctx := context.Background()
	if err := ks.Put(ctx, 1, "openai", "sk-fake-openai-key-0001", "gpt-6-astra", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`INSERT INTO ai_keys (user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at)
		SELECT 2, provider, ciphertext, nonce, secret_fp, hint, model, created_at FROM ai_keys WHERE user_id = 1`); err != nil {
		t.Fatal(err)
	}
	if info, err := ks.Info(ctx, 2, "openai"); err != nil || info.State != KeyUndecryptable {
		t.Fatalf("Info = %+v, %v", info, err)
	}
	if _, err := ks.Credentials(ctx, 2, "openai"); !errors.Is(err, ErrKeyUndecryptable) {
		t.Errorf("Credentials err = %v", err)
	}
}

func TestCustomKeyBoundToBaseURL(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	ks := newStore(sqlDB, 1, 0)
	base := "https://a.example/v1"
	ks.AADFor = func(userID int64, provider string) (string, error) {
		return KeyAADCustom(userID, provider, base), nil
	}
	ctx := context.Background()
	if err := ks.Put(ctx, 1, "custom-abcdefghij", "sk-fake-custom-key-0001", "m", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	if c, err := ks.Credentials(ctx, 1, "custom-abcdefghij"); err != nil || c.APIKey != "sk-fake-custom-key-0001" {
		t.Fatalf("same base: %v", err)
	}
	base = "https://b.example/v1" // someone repointed base_url in the database
	if info, err := ks.Info(ctx, 1, "custom-abcdefghij"); err != nil || info.State != KeyUndecryptable {
		t.Fatalf("Info = %+v, %v", info, err)
	}
	if _, err := ks.Credentials(ctx, 1, "custom-abcdefghij"); !errors.Is(err, ErrKeyUndecryptable) {
		t.Errorf("Credentials err = %v, want ErrKeyUndecryptable", err)
	}
}

func TestUnknownProviderAADIsUndecryptableNotPanic(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	ks := newStore(sqlDB, 1, 0)
	ctx := context.Background()
	if err := ks.Put(ctx, 1, "custom-abcdefghij", "sk-fake-custom-key-0001", "m", PutOptions{}); err != nil {
		t.Fatal(err)
	}
	ks.AADFor = func(int64, string) (string, error) { return "", errors.New("unknown provider") }
	if info, err := ks.Info(ctx, 1, "custom-abcdefghij"); err != nil || info.State != KeyUndecryptable {
		t.Fatalf("Info = %+v, %v", info, err)
	}
	if _, err := ks.Credentials(ctx, 1, "custom-abcdefghij"); !errors.Is(err, ErrKeyUndecryptable) {
		t.Errorf("Credentials err = %v", err)
	}
	if err := ks.Put(ctx, 1, "custom-abcdefghij", "sk-fake-custom-key-0002", "m", PutOptions{}); err == nil {
		t.Error("Put for a provider without AAD succeeded")
	}
	if n, err := ks.Rotate(ctx); err != nil || n != 0 {
		t.Errorf("Rotate = %d, %v", n, err)
	}
}

func TestV1AADUnchanged(t *testing.T) {
	if got, want := KeyAAD(7, "anthropic"), "qinqin/ai_keys/v1|user=7|provider=anthropic"; got != want {
		t.Errorf("KeyAAD = %q, want %q", got, want)
	}
	if got, want := KeyAADCustom(7, "custom-abcdefghij", "https://a.example/v1"), "qinqin/ai_keys/v2|user=7|provider=custom-abcdefghij|base=https://a.example/v1"; got != want {
		t.Errorf("KeyAADCustom = %q, want %q", got, want)
	}
}

func TestRotatePerRow(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	ctx := context.Background()
	old := newStore(sqlDB, 1, 0)
	for _, p := range []string{"anthropic", "openai"} {
		if err := old.Put(ctx, 1, p, "sk-fake-"+p+"-key-0001", "m", PutOptions{}); err != nil {
			t.Fatal(err)
		}
	}
	ks := newStore(sqlDB, 9, 1)
	if n, err := ks.Rotate(ctx); err != nil || n != 2 {
		t.Fatalf("Rotate = %d, %v, want 2", n, err)
	}
	alone := newStore(sqlDB, 9, 0)
	for _, p := range []string{"anthropic", "openai"} {
		if c, err := alone.Credentials(ctx, 1, p); err != nil || c.APIKey != "sk-fake-"+p+"-key-0001" {
			t.Errorf("%s after rotate: %v", p, err)
		}
	}
}

func TestEmptyKeyOnlyWhenAllowed(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	ks := newStore(sqlDB, 1, 0)
	ctx := context.Background()
	if err := ks.Put(ctx, 1, "custom-abcdefghij", "", "m", PutOptions{}); err == nil {
		t.Error("empty key accepted without AllowEmptyKey")
	}
	if err := ks.Put(ctx, 1, "custom-abcdefghij", "  ", "m", PutOptions{}); err == nil {
		t.Error("blank key accepted without AllowEmptyKey")
	}
	if err := ks.Put(ctx, 1, "custom-abcdefghij", "", "m", PutOptions{AllowEmptyKey: true}); err != nil {
		t.Fatal(err)
	}
	info, err := ks.Info(ctx, 1, "custom-abcdefghij")
	if err != nil || info.State != KeyOK || info.Hint != "" {
		t.Errorf("info = %+v, %v", info, err)
	}
	c, err := ks.Credentials(ctx, 1, "custom-abcdefghij")
	if err != nil || c.APIKey != "" || c.Model != "m" {
		t.Errorf("credentials = %v, %v", c.Model, err)
	}
	if err := ks.Put(ctx, 1, "openai", "sk-fake-openai-key-0001", "", PutOptions{}); err == nil {
		t.Error("non-anthropic provider without a model accepted")
	}
}

func TestDeleteProvider(t *testing.T) {
	sqlDB, _ := openTestDB(t)
	ks := newStore(sqlDB, 1, 0)
	ctx := context.Background()
	for _, u := range []int64{1, 2} {
		for _, p := range []string{"custom-abcdefghij", "openai"} {
			if err := ks.Put(ctx, u, p, "sk-fake-"+p+"-key-0001", "m", PutOptions{}); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := ks.DeleteProvider(ctx, "custom-abcdefghij"); err != nil {
		t.Fatal(err)
	}
	for _, u := range []int64{1, 2} {
		if _, err := ks.Info(ctx, u, "custom-abcdefghij"); !errors.Is(err, ErrNoKey) {
			t.Errorf("user %d custom key = %v", u, err)
		}
		if _, err := ks.Info(ctx, u, "openai"); err != nil {
			t.Errorf("user %d openai key: %v", u, err)
		}
	}
}

func TestCredentialsNeverFormatted(t *testing.T) {
	c := Credentials{APIKey: "sk-fake-SECRET-VALUE-1234", Model: "m", BaseURL: "https://x.example/v1?token=QUERYSECRET"}
	outs := []string{fmt.Sprintf("%v %+v %#v %s", c, c, c, c), fmt.Sprintf("%v %+v %#v", &c, &c, &c)}
	j, err := json.Marshal(struct{ C Credentials }{c})
	if err != nil {
		t.Fatal(err)
	}
	outs = append(outs, string(j))
	for _, o := range outs {
		for _, bad := range []string{"SECRET", "sk-fake", "QUERYSECRET", "x.example"} {
			if strings.Contains(o, bad) {
				t.Errorf("output leaks %q: %s", bad, o)
			}
		}
	}
}
