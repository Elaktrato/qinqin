package step038

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
	"time"
)

// The frozen codec reads the legacy rows exactly as the fixture said when
// migration 038 shipped (testdata/legacy-codec-038.json, a frozen copy of
// docs/contracts/study/legacy-codec.json; never regenerate it).
func TestFrozenCodecMatchesThe038Fixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/legacy-codec-038.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		ModifiedAt string `json:"modifiedAt"`
		Cases      []struct {
			Name      string          `json:"name"`
			Key       string          `json:"key"`
			Data      json.RawMessage `json:"data"`
			Expect    json.RawMessage `json:"expect"`
			RoundTrip json.RawMessage `json:"roundTrip"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	mod, _ := time.Parse(time.RFC3339, fx.ModifiedAt)
	value := func(b []byte) any {
		var v any
		json.NewDecoder(bytes.NewReader(b)).Decode(&v)
		return v
	}
	for _, c := range fx.Cases {
		r, err := FromLegacy(c.Key, c.Data)
		if string(c.Expect) == `"unreadable"` {
			if !errors.Is(err, ErrUnreadable) {
				t.Errorf("%s: want unreadable, got %v", c.Name, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s: %v", c.Name, err)
			continue
		}
		r.M().WorkspaceID = 7
		if err := Validate(r); err != nil {
			t.Errorf("%s: Validate: %v", c.Name, err)
			continue
		}
		var exp struct {
			Row json.RawMessage `json:"row"`
		}
		json.Unmarshal(c.Expect, &exp)
		enc, _ := json.Marshal(r)
		var body map[string]json.RawMessage
		json.Unmarshal(enc, &body)
		for _, k := range []string{"workspaceId", "version", "updatedAt", "deletedAt"} {
			delete(body, k)
		}
		got, _ := json.Marshal(body)
		if !reflect.DeepEqual(value(got), value(exp.Row)) {
			t.Errorf("%s: row %s, want %s", c.Name, got, exp.Row)
		}
		r.M().ModifiedAt = mod
		if _, data := ToLegacy(r); !reflect.DeepEqual(value(data), value(c.RoundTrip)) {
			t.Errorf("%s: roundTrip %s, want %s", c.Name, data, c.RoundTrip)
		}
	}
}
