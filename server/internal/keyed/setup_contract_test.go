package keyed

import (
	"encoding/json"
	"errors"
	"os"
	"testing"
)

// docs/contracts/study/setup.json: the saved study setup is the workspace
// row "study-setup". The server stores it like any keyed row and never reads
// its members; this test pins the key and scope the fixture names, and that
// every document in it is a JSON object (or no row) well under the row cap.
func TestStudySetupContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/study/setup.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Key      string            `json:"key"`
		Scope    Scope             `json:"scope"`
		Defaults json.RawMessage   `json:"defaults"`
		Parse    []json.RawMessage `json:"parse"`
		Repair   []json.RawMessage `json:"repair"`
		Write    []json.RawMessage `json:"write"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Key != "study-setup" || fx.Scope != ScopeWorkspace {
		t.Fatalf("fixture names %q in %q", fx.Key, fx.Scope)
	}
	ws := int64(7)
	if err := Check(fx.Key, &ws); err != nil {
		t.Fatalf("workspace row refused: %v", err)
	}
	if err := Check(fx.Key, nil); !errors.Is(err, ErrWrongScope) {
		t.Fatalf("user-global row: %v, want ErrWrongScope", err)
	}
	objects := []json.RawMessage{fx.Defaults}
	for _, group := range [][]json.RawMessage{fx.Parse, fx.Repair, fx.Write} {
		for _, c := range group {
			var m map[string]json.RawMessage
			if err := json.Unmarshal(c, &m); err != nil {
				t.Fatal(err)
			}
			for _, member := range []string{"row", "expect", "next"} {
				if v, ok := m[member]; ok && string(v) != "null" {
					objects = append(objects, v)
				}
			}
		}
	}
	if len(objects) < 20 {
		t.Fatalf("only %d documents in the fixture", len(objects))
	}
	for _, doc := range objects {
		var obj map[string]any
		if err := json.Unmarshal(doc, &obj); err != nil {
			t.Errorf("not a JSON object: %s", doc)
		}
		if len(doc) > 256<<10 {
			t.Errorf("document over the row cap: %d bytes", len(doc))
		}
	}
}
