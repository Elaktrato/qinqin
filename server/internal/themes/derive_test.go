package themes

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestDeriveContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/themes/derive.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Alpha []struct {
			P   int    `json:"p"`
			Hex string `json:"hex"`
		} `json:"alpha"`
		Cases []struct {
			Name   string          `json:"name"`
			Theme  json.RawMessage `json:"theme"`
			Accent *string         `json:"accent"`
			Expect json.RawMessage `json:"expect"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	for _, a := range doc.Alpha {
		if got := WithAlpha("#000000", a.P); got != "#000000"+a.Hex {
			t.Errorf("WithAlpha(%d) = %s, want %s", a.P, got, a.Hex)
		}
	}
	if len(doc.Cases) < 8 {
		t.Fatalf("only %d cases", len(doc.Cases))
	}
	for _, c := range doc.Cases {
		th, err := ParseTheme(c.Theme)
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		accent := ""
		if c.Accent != nil {
			accent = *c.Accent
		}
		// Strict: a token of the fixture that Derived does not carry fails.
		dec := json.NewDecoder(bytes.NewReader(c.Expect))
		dec.DisallowUnknownFields()
		var want Derived
		if err := dec.Decode(&want); err != nil {
			t.Fatalf("%s: expect: %v", c.Name, err)
		}
		if got := Derive(th, accent); !reflect.DeepEqual(got, want) {
			t.Errorf("%s: Derive =\n%+v\nwant\n%+v", c.Name, got, want)
		}
	}
}
