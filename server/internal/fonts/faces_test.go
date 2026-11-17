package fonts_test

import (
	"encoding/json"
	"errors"
	"os"
	"testing"

	"qinqin/internal/fonts"
)

// contractDir holds the fixtures of docs/contracts/fonts.
const contractDir = "../../../docs/contracts/fonts/"

type facesCase struct {
	Name  string          `json:"name"`
	Code  string          `json:"code"`
	Path  string          `json:"path"`
	Faces json.RawMessage `json:"faces"`
}

func loadCases(t *testing.T, file string) []facesCase {
	t.Helper()
	raw, err := os.ReadFile(contractDir + file)
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Cases []facesCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(fx.Cases) == 0 {
		t.Fatalf("%s has no cases", file)
	}
	return fx.Cases
}

// body is the faces.json text of a case: {"$raw": text} or the JSON itself.
func (c facesCase) body() []byte {
	var raw struct {
		Raw *string `json:"$raw"`
	}
	if json.Unmarshal(c.Faces, &raw) == nil && raw.Raw != nil {
		return []byte(*raw.Raw)
	}
	return c.Faces
}

func TestParseFacesValid(t *testing.T) {
	for _, c := range loadCases(t, "faces-valid.json") {
		list, err := fonts.ParseFaces(c.body())
		if err != nil {
			t.Errorf("%s: %v", c.Name, err)
			continue
		}
		for _, f := range list {
			for _, s := range f.Slices {
				if "slices/"+s.Sha+".woff2" != s.File {
					t.Errorf("%s: sha %q of %q", c.Name, s.Sha, s.File)
				}
			}
		}
	}
	list, _ := fonts.ParseFaces(loadCases(t, "faces-valid.json")[0].body())
	if len(list) != 1 || list[0].Face != "sans" || list[0].Script != "Hans" || list[0].Original != "Noto Sans SC" ||
		list[0].Weight != "200 900" || list[0].WeightLo != 200 || list[0].WeightHi != 900 || list[0].Style != "normal" ||
		len(list[0].Slices) != 2 || list[0].Slices[1].UnicodeRange != "U+4E00,U+4E09-4E0B" {
		t.Errorf("first valid case = %+v", list)
	}
}

func TestParseFacesInvalid(t *testing.T) {
	for _, c := range loadCases(t, "faces-invalid.json") {
		_, err := fonts.ParseFaces(c.body())
		var fe *fonts.FileError
		if !errors.As(err, &fe) {
			t.Errorf("%s: err = %v, want %s at %s", c.Name, err, c.Code, c.Path)
			continue
		}
		if fe.Code != c.Code || fe.Path != c.Path {
			t.Errorf("%s: %s at %s, want %s at %s", c.Name, fe.Code, fe.Path, c.Code, c.Path)
		}
	}
	big := make([]byte, fonts.MaxFacesBytes+1)
	if _, err := fonts.ParseFaces(big); err == nil || err.Error() != "too-large at $" {
		t.Errorf("oversize: %v", err)
	}
}
