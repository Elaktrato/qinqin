package api_test

import (
	"bytes"
	"context"
	"net/http"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/lemma"
	"qinqin/internal/packs"
)

// GET /api/lemma-packs (#176) is public shared data: the credits of every
// live lemma-rules pack by pack id, the same for anyone (as
// /api/component-packs).
func TestLemmaPacksList(t *testing.T) {
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	ts, sqlDB := newServer(t)
	resp, body := getPlain(t, ts.URL, "/api/lemma-packs", nil)
	if resp.StatusCode != http.StatusOK || string(body) != "[]" {
		t.Fatalf("empty list: %d %s", resp.StatusCode, body)
	}
	ctx := context.Background()
	for _, id := range []string{"xh-b", "xh-a"} {
		language := map[string]string{"xh-a": "xh", "xh-b": "xq"}[id]
		p, err := dict.LoadPack(lemmaPackDir(t, id, language, `{"format": 2, "language": "`+language+`", "version": "1", "maxDepth": 1,
 "classes": {"w": {"any": true}}, "hints": {}, "rules": [{"from": "aba", "to": "ar", "reason": "past", "out": "w"}]}`))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := packs.Import(ctx, sqlDB, p); err != nil {
			t.Fatal(err)
		}
	}
	if err := packs.Uninstall(ctx, sqlDB, "lemma-rules", "xh-b"); err != nil {
		t.Fatal(err)
	}
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	_, anon := getPlain(t, ts.URL, "/api/lemma-packs", nil)
	_, a := getPlain(t, ts.URL, "/api/lemma-packs", map[string]string{"Authorization": "Bearer " + alice})
	_, b := getPlain(t, ts.URL, "/api/lemma-packs", map[string]string{"Authorization": "Bearer " + bob})
	want := `[{"packId":"xh-a","name":"Rules xh-a","version":"1.0","language":"xh","license":"CC0-1.0","attribution":"Qinqin test fixtures","notice":""}]`
	if string(anon) != want || !bytes.Equal(anon, a) || !bytes.Equal(a, b) {
		t.Errorf("list anon %s\nalice %s\nbob %s\nwant %s", anon, a, b, want)
	}
	if resp := doJSON(t, http.MethodPost, ts.URL, "/api/lemma-packs", alice, nil); resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("POST: %d, want 405", resp.StatusCode)
	}
}
