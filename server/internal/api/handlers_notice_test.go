package api_test

import (
	"context"
	"net/http"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/levels"
)

// listRaw fetches path and decodes its JSON list without a typed body,
// so a missing field is told apart from an empty one.
func listRaw(t *testing.T, tsURL, path string) []map[string]any {
	t.Helper()
	resp := doJSON(t, http.MethodGet, tsURL, path, "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: status = %d, want %d", path, resp.StatusCode, http.StatusOK)
	}
	var list []map[string]any
	decodeJSON(t, resp, &list)
	return list
}

// noticesByName maps each listed item's name to its notice, failing when
// an item has no notice field or a non-string one.
func noticesByName(t *testing.T, path string, list []map[string]any) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, item := range list {
		raw, ok := item["notice"]
		if !ok {
			t.Errorf("GET %s: %v has no notice field (it must always be present)", path, item["name"])
			continue
		}
		notice, ok := raw.(string)
		if !ok {
			t.Errorf("GET %s: %v notice = %#v, want a string", path, item["name"], raw)
			continue
		}
		out[item["name"].(string)] = notice
	}
	return out
}

// The three pack registries serve notice on every item: the manifest's
// notice, or "" when the pack has none. The other credit fields are
// served as before.
func TestPackListsServeNotice(t *testing.T) {
	ts, sqlDB, _ := newServerWithDir(t)
	ctx := context.Background()

	importSchemeCedict(t, sqlDB) // a dictionary without notice
	const dictNotice = "Dictionary caveat with [a link](https://example.com/dict)."
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "cedict-noticed", Name: "Noticed dictionary", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "MDBG", Notice: dictNotice, Format: "cedict",
	}, "dictionary.txt", "你好 你好 [ni3 hao3] /hello/\n")

	const freqNotice = "Ranks unmodified.\n\nSecond paragraph."
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "freq-noticed", Name: "Noticed frequency", Version: "1", Type: "frequency", Language: "zh",
		License: "CC0-1.0", Attribution: "test", Notice: freqNotice, Format: "freq-csv",
	}, "freq.csv", "term,reading,rank\n你好,,1\n")
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "freq-plain", Name: "Plain frequency", Version: "1", Type: "frequency", Language: "zh",
		License: "CC0-1.0", Attribution: "test", Format: "freq-csv",
	}, "freq.csv", "term,reading,rank\n你好,,2\n")

	const schemeNotice = "Approximate levels: 汉字 lists."
	pack, err := dict.LoadPack(levelsFixture)
	if err != nil {
		t.Fatal(err)
	}
	pack.Manifest.Notice = schemeNotice
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("import scheme: %v", err)
	}

	for path, want := range map[string]map[string]string{
		"/api/dictionaries":    {"CC-CEDICT test": "", "Noticed dictionary": dictNotice},
		"/api/frequency-packs": {"Noticed frequency": freqNotice, "Plain frequency": ""},
		"/api/schemes":         {pack.Manifest.Name: schemeNotice},
	} {
		list := listRaw(t, ts.URL, path)
		got := noticesByName(t, path, list)
		if len(got) != len(want) {
			t.Errorf("GET %s: notices %q, want %q", path, got, want)
		}
		for name, notice := range want {
			if got[name] != notice {
				t.Errorf("GET %s: %s notice = %q, want %q", path, name, got[name], notice)
			}
		}
		for _, item := range list {
			for _, field := range []string{"id", "name", "version", "license", "attribution"} {
				if _, ok := item[field]; !ok {
					t.Errorf("GET %s: %v lost its %s field", path, item["name"], field)
				}
			}
		}
	}
}
