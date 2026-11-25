package api_test

import (
	"io"
	"net/http"
	"testing"

	"qinqin/internal/ai"
)

// TestDeleteCustomProviderTakesKeysAndSelections deletes an endpoint over
// HTTP: the endpoint, every user's key for it and every selection on it go;
// another provider's rows stay; a second delete is 404. (#194 moved the
// transaction into ai.DeleteCustomProvider; this test also passes on the
// code before the move.)
func TestDeleteCustomProviderTakesKeysAndSelections(t *testing.T) {
	e := newCustomEnv(t, false, nil)
	resp := e.create(t, e.admin, validCustom())
	var sp ai.ProviderSpec
	decodeJSON(t, resp, &sp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d", resp.StatusCode)
	}
	for _, user := range []int64{1, 2} {
		for _, p := range []string{sp.ID, "anthropic"} {
			mustExec(t, e.db, `INSERT INTO ai_keys (user_id, provider, ciphertext, nonce, secret_fp, hint, model, created_at) VALUES (`+
				string(rune('0'+user))+`, '`+p+`', x'00', x'00', 'fp', 'h', 'm', 't')`)
		}
	}
	mustExec(t, e.db, `INSERT INTO ai_selection (user_id, provider, updated_at) VALUES (1, '`+sp.ID+`', 't'), (2, 'anthropic', 't')`)
	resp = doJSON(t, http.MethodDelete, e.ts.URL, "/api/ai/custom-providers/"+sp.ID, e.admin, nil)
	if resp.StatusCode != http.StatusNoContent {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("delete: %d %s", resp.StatusCode, b)
	}
	count := func(q string) int {
		var n int
		if err := e.db.QueryRow(q).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(`SELECT COUNT(*) FROM ai_custom_providers`); n != 0 {
		t.Errorf("endpoints = %d", n)
	}
	if n := count(`SELECT COUNT(*) FROM ai_keys WHERE provider = '` + sp.ID + `'`); n != 0 {
		t.Errorf("keys of the endpoint = %d", n)
	}
	if n := count(`SELECT COUNT(*) FROM ai_selection WHERE provider = '` + sp.ID + `'`); n != 0 {
		t.Errorf("selections on the endpoint = %d", n)
	}
	if n := count(`SELECT COUNT(*) FROM ai_keys WHERE provider = 'anthropic'`) + count(`SELECT COUNT(*) FROM ai_selection`); n != 3 {
		t.Errorf("other rows = %d, want 3", n)
	}
	resp = doJSON(t, http.MethodDelete, e.ts.URL, "/api/ai/custom-providers/"+sp.ID, e.admin, nil)
	if er := errOf(t, resp); resp.StatusCode != http.StatusNotFound || er.Error != "unknown_provider" {
		t.Errorf("second delete: %d %+v", resp.StatusCode, er)
	}

	// A user's key delete takes the user's selection on that provider only.
	mustExec(t, e.db, `INSERT INTO ai_selection (user_id, provider, updated_at) VALUES (1, 'anthropic', 't')`)
	resp = doJSON(t, http.MethodDelete, e.ts.URL, "/api/ai/keys/anthropic", e.bob, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("key delete: %d", resp.StatusCode)
	}
	if n := count(`SELECT COUNT(*) FROM ai_keys WHERE user_id = 2`) + count(`SELECT COUNT(*) FROM ai_selection WHERE user_id = 2`); n != 0 {
		t.Errorf("bob keeps %d rows", n)
	}
	if n := count(`SELECT COUNT(*) FROM ai_keys WHERE user_id = 1`) + count(`SELECT COUNT(*) FROM ai_selection WHERE user_id = 1`); n != 2 {
		t.Errorf("root has %d rows, want its key and selection", n)
	}
}
