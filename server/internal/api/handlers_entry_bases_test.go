package api_test

import (
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/model"
)

func postBases(t *testing.T, tsURL, token string, body any) *http.Response {
	t.Helper()
	return doJSON(t, http.MethodPost, tsURL, "/api/entries/bases", token, body)
}

func TestEntryBasesRequiresSession(t *testing.T) {
	ts, _ := newServer(t)
	if resp := postBases(t, ts.URL, "", map[string]any{"ids": []int64{1}}); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("without token: status = %d, want 401", resp.StatusCode)
	}
}

func TestEntryBasesOrderOmissionAndDuplicates(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	alice := registerUser(t, ts.URL, "alice", "")
	fa := lexID(t, sqlDB, "zh", "character", "发")
	hao := lexID(t, sqlDB, "zh", "character", "好")

	resp := postBases(t, ts.URL, alice, map[string]any{"ids": []int64{hao, 999999, fa, hao}})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var got []model.EntryBase
	decodeJSON(t, resp, &got)
	if len(got) != 2 || got[0].ID != hao || got[1].ID != fa {
		t.Fatalf("bases = %+v, want [好, 发] in request order, unknown omitted, duplicate once", got)
	}
	if got[0].Written != "好" || got[0].Language != "zh" {
		t.Errorf("first base = %+v", got[0])
	}
	// The shape is the one of GET /api/schemes/{id}/entries: no detail sections.
	resp = postBases(t, ts.URL, alice, map[string]any{"ids": []int64{hao}})
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	for _, forbidden := range []string{"senses", "forms", "sentences"} {
		if strings.Contains(string(raw), `"`+forbidden+`"`) {
			t.Errorf("response carries %q: %s", forbidden, raw)
		}
	}
}

func TestEntryBasesRejectsBadIDLists(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	big := make([]int64, 501)
	for i := range big {
		big[i] = int64(i + 1)
	}
	max := big[:500]
	for name, body := range map[string]any{
		"empty":        map[string]any{"ids": []int64{}},
		"missing":      map[string]any{},
		"501":          map[string]any{"ids": big},
		"string id":    map[string]any{"ids": []any{"1"}},
		"zero":         map[string]any{"ids": []int64{0}},
		"negative":     map[string]any{"ids": []int64{-3}},
		"fractional":   map[string]any{"ids": []any{1.5}},
		"not an array": map[string]any{"ids": 7},
	} {
		resp := postBases(t, ts.URL, alice, body)
		text, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest || errorCode(t, text) != "bad_request" || !strings.Contains(string(text), "1 to 500 entry ids") {
			t.Errorf("%s: status = %d body %q, want 400 with the ids message", name, resp.StatusCode, text)
		}
	}
	// The cap itself is allowed (unknown ids are simply omitted).
	if resp := postBases(t, ts.URL, alice, map[string]any{"ids": max}); resp.StatusCode != http.StatusOK {
		t.Errorf("500 ids: status = %d, want 200", resp.StatusCode)
	}
}

func TestEntryBasesBodyCap(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	// 4000 seven-digit ids is about 32 KiB, over the 16 KiB cap: 413, not 400.
	ids := make([]int64, 4000)
	for i := range ids {
		ids[i] = 1000000 + int64(i)
	}
	if resp := postBases(t, ts.URL, alice, map[string]any{"ids": ids}); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413", resp.StatusCode)
	}
}

func TestEntryBasesAppliesOnlyTheCallersOverlay(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	fa := lexID(t, sqlDB, "zh", "character", "发")
	path := "/api/entries/" + strconv.FormatInt(fa, 10)
	if resp := doJSON(t, http.MethodPut, ts.URL, path, alice, map[string]any{
		"written":  "發",
		"readings": []map[string]string{{"type": "pinyin", "value": "fa4"}},
	}); resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT overlay: status = %d", resp.StatusCode)
	}
	read := func(token string) model.EntryBase {
		resp := postBases(t, ts.URL, token, map[string]any{"ids": []int64{fa}})
		var got []model.EntryBase
		decodeJSON(t, resp, &got)
		if len(got) != 1 {
			t.Fatalf("bases = %+v", got)
		}
		return got[0]
	}
	a, b := read(alice), read(bob)
	if a.Written != "發" || len(a.Readings) != 1 || a.Readings[0].Value != "fa4" {
		t.Errorf("alice sees %+v, want her patched 發 / fa4", a)
	}
	if b.Written != "发" {
		t.Errorf("bob sees %q, want the shared 发 (one user's overlay never shows to another)", b.Written)
	}
	// It agrees with GET /api/entries/{id} for the same caller.
	entry := getEntryBody(t, ts.URL, fa)
	if entry.Written != b.Written {
		t.Errorf("anonymous entry %q vs bob's base %q", entry.Written, b.Written)
	}
}
