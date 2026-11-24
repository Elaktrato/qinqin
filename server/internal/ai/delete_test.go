package ai

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"qinqin/internal/dbtest"
)

func countRows(t *testing.T, sqlDB *sql.DB, q string, args ...any) int {
	t.Helper()
	var n int
	if err := sqlDB.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// seedKeysAndSelections stores, straight on the tables (no secret is
// needed to delete), a key and a selection of users 1 and 2 for both
// providers.
func seedKeysAndSelections(t *testing.T, sqlDB *sql.DB, providers ...string) {
	t.Helper()
	for _, user := range []int64{1, 2} {
		for _, p := range providers {
			if _, err := sqlDB.Exec(`INSERT INTO ai_keys (user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at) VALUES (?, ?, x'00', x'00', 'fp', 'h', 'm', 't')`, user, p); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := sqlDB.Exec(`INSERT INTO ai_selection (user_id, provider, updated_at) VALUES (?, ?, 't')`, user, providers[0]); err != nil {
			t.Fatal(err)
		}
	}
}

func TestDeleteUserKey(t *testing.T) {
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	seedKeysAndSelections(t, sqlDB, "anthropic", "openai")
	if err := DeleteUserKey(ctx, sqlDB, 1, "anthropic"); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, sqlDB, `SELECT COUNT(*) FROM ai_keys WHERE user_id = 1`); n != 1 {
		t.Errorf("user 1 keeps %d keys, want the other provider's", n)
	}
	if n := countRows(t, sqlDB, `SELECT COUNT(*) FROM ai_selection WHERE user_id = 1`); n != 0 {
		t.Errorf("the selection on the deleted provider stays (%d)", n)
	}
	if n := countRows(t, sqlDB, `SELECT COUNT(*) FROM ai_keys WHERE user_id = 2`) + countRows(t, sqlDB, `SELECT COUNT(*) FROM ai_selection WHERE user_id = 2`); n != 3 {
		t.Errorf("user 2 has %d rows, want all 3", n)
	}
	// Deleting nothing, or a provider that does not exist, is fine.
	for _, p := range []string{"anthropic", "nope"} {
		if err := DeleteUserKey(ctx, sqlDB, 1, p); err != nil {
			t.Errorf("DeleteUserKey(%s) = %v", p, err)
		}
	}
	// The selection of another provider is not moved or cleared.
	if _, err := sqlDB.Exec(`INSERT INTO ai_selection (user_id, provider, updated_at) VALUES (1, 'openai', 't')`); err != nil {
		t.Fatal(err)
	}
	if err := DeleteUserKey(ctx, sqlDB, 1, "anthropic"); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, sqlDB, `SELECT COUNT(*) FROM ai_selection WHERE user_id = 1 AND provider = 'openai'`); n != 1 {
		t.Error("the selection of another provider changed")
	}
}

func TestDeleteCustomProvider(t *testing.T) {
	cs, sqlDB := newCustom(t)
	ctx := context.Background()
	sp, err := cs.Create(ctx, 1, validInput())
	if err != nil {
		t.Fatal(err)
	}
	seedKeysAndSelections(t, sqlDB, sp.ID, "anthropic")
	if err := DeleteCustomProvider(ctx, sqlDB, sp.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := cs.Get(ctx, sp.ID); !errors.Is(err, ErrUnknownProvider) {
		t.Errorf("Get after delete = %v", err)
	}
	if n := countRows(t, sqlDB, `SELECT COUNT(*) FROM ai_keys WHERE provider = ?`, sp.ID) + countRows(t, sqlDB, `SELECT COUNT(*) FROM ai_selection WHERE provider = ?`, sp.ID); n != 0 {
		t.Errorf("%d keys and selections of the endpoint remain", n)
	}
	if n := countRows(t, sqlDB, `SELECT COUNT(*) FROM ai_keys WHERE provider = 'anthropic'`); n != 2 {
		t.Errorf("other providers' keys = %d, want 2", n)
	}
	if err := DeleteCustomProvider(ctx, sqlDB, sp.ID); !errors.Is(err, ErrUnknownProvider) {
		t.Errorf("second delete = %v", err)
	}
}
