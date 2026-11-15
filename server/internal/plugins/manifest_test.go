package plugins_test

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"qinqin/internal/plugins"
)

// journalBase is the valid journal manifest of the spec, as a mutable map.
func journalBase() map[string]any {
	return map[string]any{
		"id":          "qinqin-journal",
		"name":        "Journal",
		"version":     "1.1",
		"type":        "feature",
		"sdk":         1,
		"description": "Dated entries.",
		"surfaces":    []any{"page"},
		"permissions": []any{"owns-data", "write:study-events"},
		"hooks":       []any{},
		"events":      []any{map[string]any{"type": "journal"}},
	}
}

func marshalMutated(t *testing.T, mutate func(m map[string]any)) []byte {
	t.Helper()
	m := journalBase()
	mutate(m)
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestParseManifest(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		got, err := plugins.ParseManifest(marshalMutated(t, func(map[string]any) {}))
		if err != nil {
			t.Fatalf("ParseManifest: %v", err)
		}
		if got.ID != "qinqin-journal" || got.SDK != 1 || len(got.Events) != 1 || got.Events[0].Type != "journal" {
			t.Errorf("manifest = %+v", got)
		}
	})

	long := strings.Repeat("a", 65)
	cases := []struct {
		name   string
		mutate func(m map[string]any)
		want   []string
	}{
		{"bad id", func(m map[string]any) { m["id"] = "Qinqin_X" }, []string{`id "Qinqin_X" must match`}},
		{"long id", func(m map[string]any) { m["id"] = long }, []string{"id must be at most 64"}},
		{"empty name", func(m map[string]any) { m["name"] = "" }, []string{"name is required"}},
		{"long name", func(m map[string]any) { m["name"] = strings.Repeat("n", 81) }, []string{"name must be at most 80"}},
		{"bad version", func(m map[string]any) { m["version"] = "v1" }, []string{`version "v1" must look like 1.0 or 1.0.0`}},
		{"bad type", func(m map[string]any) { m["type"] = "data" }, []string{`type must be "feature"`}},
		{"missing sdk", func(m map[string]any) { delete(m, "sdk") }, []string{"sdk 0 is not supported (1..1)"}},
		{"sdk 2", func(m map[string]any) { m["sdk"] = 2 }, []string{"sdk 2 is not supported"}},
		{"long description", func(m map[string]any) { m["description"] = strings.Repeat("d", 201) }, []string{"description must be at most 200"}},
		{"unknown surface", func(m map[string]any) { m["surfaces"] = []any{"widget"} }, []string{`surfaces[0] "widget" is unknown`}},
		{"repeated surface", func(m map[string]any) { m["surfaces"] = []any{"page", "page"} }, []string{`surfaces[1] "page" is repeated`}},
		{"unknown permission", func(m map[string]any) { m["permissions"] = []any{"write:events"} }, []string{`permissions[0] "write:events" is unknown`}},
		{"repeated permission", func(m map[string]any) { m["permissions"] = []any{"owns-data", "owns-data", "write:study-events"} }, []string{`permissions[1] "owns-data" is repeated`}},
		{"unknown hook", func(m map[string]any) {
			m["surfaces"] = []any{"hook"}
			m["hooks"] = []any{"nope"}
		}, []string{`hooks[0] "nope" is unknown`}},
		{"repeated hook", func(m map[string]any) {
			m["surfaces"] = []any{"hook"}
			m["hooks"] = []any{"study-event", "study-event"}
		}, []string{`hooks[1] "study-event" is repeated`}},
		{"hook surface without hooks", func(m map[string]any) { m["surfaces"] = []any{"hook"} }, []string{`hooks must not be empty with the "hook" surface`}},
		{"hooks without hook surface", func(m map[string]any) { m["hooks"] = []any{"study-event"} }, []string{`hooks must be empty without the "hook" surface`}},
		{"bad event type", func(m map[string]any) { m["events"] = []any{map[string]any{"type": "Bad"}} }, []string{`events[0].type "Bad" must match`}},
		{"repeated event type", func(m map[string]any) {
			m["events"] = []any{map[string]any{"type": "journal"}, map[string]any{"type": "journal"}}
		}, []string{`events[1].type "journal" is repeated`}},
		{"events without permission", func(m map[string]any) { m["permissions"] = []any{"owns-data"} }, []string{"events need the write:study-events permission"}},
		{"activity not an object", func(m map[string]any) {
			m["events"] = []any{map[string]any{"type": "journal", "activity": 3}}
		}, []string{"events[0].activity must be an object"}},
		{"unknown field", func(m map[string]any) { m["permision"] = []any{} }, []string{`unknown field "permision"`}},
		{"two problems", func(m map[string]any) {
			m["id"] = "Bad_Id"
			m["sdk"] = 7
		}, []string{`id "Bad_Id" must match`, "sdk 7 is not supported"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := plugins.ParseManifest(marshalMutated(t, tc.mutate))
			if !errors.Is(err, plugins.ErrInvalidManifest) {
				t.Fatalf("err = %v, want ErrInvalidManifest", err)
			}
			for _, frag := range tc.want {
				if !strings.Contains(err.Error(), frag) {
					t.Errorf("error %q lacks %q", err, frag)
				}
			}
		})
	}

	t.Run("two problems are joined in field order", func(t *testing.T) {
		_, err := plugins.ParseManifest(marshalMutated(t, func(m map[string]any) {
			m["id"] = "Bad_Id"
			m["sdk"] = 7
		}))
		if err == nil || !strings.HasPrefix(err.Error(), "plugins: invalid manifest: id ") ||
			!strings.Contains(err.Error(), "; sdk 7") {
			t.Errorf("err = %v", err)
		}
	})

	t.Run("not an object", func(t *testing.T) {
		_, err := plugins.ParseManifest([]byte(`[1]`))
		if !errors.Is(err, plugins.ErrInvalidManifest) || !strings.Contains(err.Error(), "json:") {
			t.Errorf("err = %v", err)
		}
	})
}

func TestManifestHas(t *testing.T) {
	m, err := plugins.ParseManifest(marshalMutated(t, func(map[string]any) {}))
	if err != nil {
		t.Fatal(err)
	}
	if !m.Has("owns-data") || m.Has("read:entries") {
		t.Errorf("Has wrong for %v", m.Permissions)
	}
}
