package keyed

import (
	"encoding/json"
	"errors"
	"os"
	"testing"
)

// docs/contracts/keyed/families.json: the server accepts exactly these
// families, each in its scope.
func TestFamiliesContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/keyed/families.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Families []struct {
			Key    string `json:"key"`
			Prefix bool   `json:"prefix"`
			Scope  Scope  `json:"scope"`
		} `json:"families"`
		Cases []struct {
			Name   string `json:"name"`
			Key    string `json:"key"`
			Scope  Scope  `json:"scope"`
			Accept bool   `json:"accept"`
			Answer string `json:"answer"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(fx.Families) != len(Families) {
		t.Fatalf("fixture lists %d families, server %d", len(fx.Families), len(Families))
	}
	for i, f := range fx.Families {
		if (Family{f.Key, f.Prefix, f.Scope}) != Families[i] {
			t.Errorf("family %d: fixture %+v, server %+v", i, f, Families[i])
		}
	}
	ws := int64(3)
	for _, c := range fx.Cases {
		var scope *int64
		if c.Scope == ScopeWorkspace {
			scope = &ws
		}
		err := Check(c.Key, scope)
		switch {
		case c.Accept && err != nil:
			t.Errorf("%s: refused: %v", c.Name, err)
		case !c.Accept && c.Answer == "scope" && !errors.Is(err, ErrWrongScope):
			t.Errorf("%s: %v, want ErrWrongScope", c.Name, err)
		case !c.Accept && c.Answer == "unknown" && !errors.Is(err, ErrUnknownKey):
			t.Errorf("%s: %v, want ErrUnknownKey", c.Name, err)
		}
	}
}
