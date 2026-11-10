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
	"qinqin/internal/lang"
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
		t.Fatalf("upsert %q (%s/%s): %v", e.Written, e.Kind, e.Language, err)
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

// findReading returns e's reading of the given type, or nil.
func findReading(e model.Entry, readType string) *model.Reading {
	for i := range e.Readings {
		if e.Readings[i].Type == readType {
			return &e.Readings[i]
		}
	}
	return nil
}

func TestGetEntryEndpoint(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	ts, sqlDB := newServer(t)
	ctx := context.Background()
	st := entries.Store{DB: sqlDB}

	hao := mustUpsertEntry(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "好",
		Readings: []model.Reading{{Type: "pinyin", Value: "hǎo"}},
	})
	fa := mustUpsertEntry(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "发",
		Readings: []model.Reading{{Type: "pinyin", Value: "fā"}},
	})
	faTrad := mustUpsertEntry(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "發",
		Readings: []model.Reading{{Type: "pinyin", Value: "fā"}},
	})
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
	if body.ID != fa || body.Language != "zh" || body.Kind != "character" || body.Written != "发" {
		t.Errorf("entry body = %+v, want the 发 entry", body.Entry)
	}
	if py := findReading(body.Entry, "pinyin"); py == nil || py.Value != "fā" || py.Plain != "fa" {
		t.Errorf("entry readings = %+v, want pinyin fā/fa", body.Readings)
	}
	if bm := findReading(body.Entry, "bopomofo"); bm == nil || bm.Value != "ㄈㄚ" {
		t.Errorf("entry readings = %+v, want derived bopomofo ㄈㄚ", body.Readings)
	}
	if body.Attrs == nil {
		t.Errorf("attrs = null, want an empty object")
	}
	if len(body.Variants) != 1 || body.Variants[0].ID != faTrad || body.Variants[0].Written != "發" {
		t.Errorf("variants = %+v, want just 發", body.Variants)
	}
	if py := findReading(body.Variants[0], "pinyin"); py == nil || py.Plain != "fa" {
		t.Errorf("variant readings = %+v, want pinyin plain fa", body.Variants[0].Readings)
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
	if body.Readings == nil || len(body.Readings) != 2 {
		t.Errorf("readings of 好 = %v, want pinyin plus derived bopomofo", body.Readings)
	}

	// Unknown and malformed ids are 404.
	for _, path := range []string{"/api/entries/999999", "/api/entries/NaN"} {
		resp = getEntry(t, ts.URL, path)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s: status = %d, want %d", path, resp.StatusCode, http.StatusNotFound)
		}
	}
}
