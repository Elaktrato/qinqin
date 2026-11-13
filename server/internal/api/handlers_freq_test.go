package api_test

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/freq"
)

// frequencyPackBody mirrors the JSON body of GET /api/frequency-packs.
type frequencyPackBody struct {
	ID          int64  `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Language    string `json:"language"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
}

func listFrequencyPacks(t *testing.T, tsURL string) []frequencyPackBody {
	t.Helper()
	resp := doJSON(t, http.MethodGet, tsURL, "/api/frequency-packs", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/frequency-packs: status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	var list []frequencyPackBody
	decodeJSON(t, resp, &list)
	return list
}

func TestListFrequencyPacks(t *testing.T) {
	ts, sqlDB, _ := newServerWithDir(t)
	if list := listFrequencyPacks(t, ts.URL); list == nil || len(list) != 0 {
		t.Fatalf("GET /api/frequency-packs = %#v, want an empty list", list)
	}

	dir := t.TempDir()
	manifest := `{"id":"jiten-frequency","name":"Jiten frequency list","version":"2026-11-12","type":"frequency",` +
		`"language":"ja","license":"CC BY-SA 4.0","attribution":"Jiten (https://jiten.moe)","format":"freq-csv"}`
	for name, body := range map[string]string{"manifest.json": manifest, "freq.csv": "term,reading,rank\n為る,する,10\n"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := freq.Import(context.Background(), sqlDB, &p); err != nil {
		t.Fatalf("import: %v", err)
	}

	list := listFrequencyPacks(t, ts.URL)
	want := []frequencyPackBody{{Name: "Jiten frequency list", Version: "2026-11-12", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "Jiten (https://jiten.moe)"}}
	if len(list) == 1 {
		want[0].ID = list[0].ID
	}
	if !reflect.DeepEqual(list, want) || list[0].ID == 0 {
		t.Errorf("GET /api/frequency-packs = %+v, want %+v", list, want)
	}

	// A soft-deleted pack is not listed.
	if _, err := sqlDB.Exec(`UPDATE frequency_packs SET deleted_at = '2026-11-12T00:00:00Z'`); err != nil {
		t.Fatal(err)
	}
	if list := listFrequencyPacks(t, ts.URL); len(list) != 0 {
		t.Errorf("after delete: %+v, want empty", list)
	}
}
