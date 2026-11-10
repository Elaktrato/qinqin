package api_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"

	"qinqin/internal/api"
	"qinqin/internal/db"
	"qinqin/internal/entries"
	"qinqin/internal/model"
)

// entryBody mirrors the JSON body of GET /api/entries/{id}.
type entryBody struct {
	model.Entry
	Variants []model.Entry `json:"variants"`
}

// newServer opens a fresh migrated database and serves the API on it.
func newServer(t *testing.T) (*httptest.Server, *sql.DB) {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	ts := httptest.NewServer(api.New(sqlDB))
	t.Cleanup(ts.Close)
	return ts, sqlDB
}

// mustUpsertEntry upserts e on st and returns its id, failing the test on error.
func mustUpsertEntry(t *testing.T, st entries.Store, e *model.Entry) int64 {
	t.Helper()
	id, err := st.Upsert(context.Background(), e)
	if err != nil {
		t.Fatalf("upsert %q (%s): %v", e.Written, e.Kind, err)
	}
	return id
}

// getEntry fetches path from ts and returns the undecoded response.
func getEntry(t *testing.T, tsURL, path string) *http.Response {
	t.Helper()
	resp, err := http.Get(tsURL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func TestGetEntryEndpoint(t *testing.T) {
	ts, sqlDB := newServer(t)
	ctx := context.Background()
	st := entries.Store{DB: sqlDB}

	hao := mustUpsertEntry(t, st, &model.Entry{Kind: "hanzi", Written: "好", Pinyin: "hǎo"})
	fa := mustUpsertEntry(t, st, &model.Entry{Kind: "hanzi", Written: "发", Pinyin: "fā"})
	faTrad := mustUpsertEntry(t, st, &model.Entry{Kind: "hanzi", Written: "發", Pinyin: "fā"})
	if err := st.LinkVariant(ctx, fa, faTrad); err != nil {
		t.Fatalf("link 发↔發: %v", err)
	}

	// An entry with variants carries them along.
	resp := getEntry(t, ts.URL, "/api/entries/"+strconv.FormatInt(fa, 10))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET 发: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var body entryBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode entry response: %v", err)
	}
	if body.ID != fa || body.Kind != "hanzi" || body.Written != "发" ||
		body.PinyinPlain != "fa" || body.Bopomofo != "ㄈㄚ" {
		t.Errorf("entry body = %+v, want the 发 entry", body.Entry)
	}
	if len(body.Variants) != 1 || body.Variants[0].ID != faTrad || body.Variants[0].Written != "發" {
		t.Errorf("variants = %+v, want just 發", body.Variants)
	}

	// An entry without variants returns an empty variants array.
	resp = getEntry(t, ts.URL, "/api/entries/"+strconv.FormatInt(hao, 10))
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET 好: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	body = entryBody{}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode entry response: %v", err)
	}
	if body.Written != "好" {
		t.Errorf("entry body = %+v, want the 好 entry", body.Entry)
	}
	if body.Variants == nil || len(body.Variants) != 0 {
		t.Errorf("variants of unlinked entry = %v, want an empty array", body.Variants)
	}

	// Unknown and malformed ids are 404.
	for _, path := range []string{"/api/entries/999999", "/api/entries/NaN"} {
		resp := getEntry(t, ts.URL, path)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s: status = %d, want %d", path, resp.StatusCode, http.StatusNotFound)
		}
	}
}
