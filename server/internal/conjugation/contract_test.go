package conjugation_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/conjugation"
)

const contractDir = "../../../docs/contracts/conjugation"

func decodeFixture(t *testing.T, name string, v any) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(contractDir, name))
	if err != nil {
		t.Fatal(err)
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

type familiesFixture struct {
	Version  int    `json:"version"`
	Rule     string `json:"rule"`
	Families []struct {
		ID      string   `json:"id"`
		Forms   []string `json:"forms"`
		Default bool     `json:"default"`
	} `json:"families"`
	Classes    map[string][]string `json:"classes"`
	Exclusions []struct {
		Written []string `json:"written"`
		Class   string   `json:"class"`
		Reading string   `json:"reading"`
		Forms   []string `json:"forms"`
		Why     string   `json:"why"`
	} `json:"exclusions"`
}

func sorted(list []string) []string {
	out := slices.Clone(list)
	slices.Sort(out)
	return out
}

// TestFamiliesContract: the families, their forms and defaults, the
// families of each class, and the word exclusions are the contract's
// (docs/contracts/conjugation/families.json).
func TestFamiliesContract(t *testing.T) {
	var fx familiesFixture
	decodeFixture(t, "families.json", &fx)
	if fx.Version != 1 || fx.Rule != "conjugation/families" {
		t.Fatalf("header = %d %q", fx.Version, fx.Rule)
	}
	var ids, defaults []string
	for _, f := range fx.Families {
		ids = append(ids, f.ID)
		if f.Default {
			defaults = append(defaults, f.ID)
		}
		if got := conjugation.FormsOf(f.ID); !slices.Equal(got, f.Forms) {
			t.Errorf("FormsOf(%q) = %v, want %v", f.ID, got, f.Forms)
		}
	}
	if !slices.Equal(conjugation.FamilyIDs(), ids) {
		t.Errorf("FamilyIDs = %v, want %v", conjugation.FamilyIDs(), ids)
	}
	if !slices.Equal(conjugation.DefaultFamilies(), defaults) {
		t.Errorf("DefaultFamilies = %v, want %v", conjugation.DefaultFamilies(), defaults)
	}
	var classes []string
	for class, want := range fx.Classes {
		classes = append(classes, class)
		if got := conjugation.ClassFamilies(class); !slices.Equal(got, want) {
			t.Errorf("ClassFamilies(%q) = %v, want %v", class, got, want)
		}
	}
	if got := conjugation.Classes(); !slices.Equal(got, sorted(classes)) {
		t.Errorf("Classes = %v, want %v", got, sorted(classes))
	}
	if len(conjugation.ExcludedForms("v1", "食べる", "たべる")) != 0 {
		t.Error("食べる has exclusions")
	}
	for _, x := range fx.Exclusions {
		class := x.Class
		if class == "" {
			class = "v5r"
		}
		for _, w := range x.Written {
			if got := conjugation.ExcludedForms(class, w, x.Reading); !slices.Equal(sorted(got), sorted(x.Forms)) {
				t.Errorf("ExcludedForms(%q, %q, %q) = %v, want %v", class, w, x.Reading, got, x.Forms)
			}
		}
		if x.Class != "" && len(conjugation.ExcludedForms("v1", x.Written[0], x.Reading)) != 0 {
			t.Errorf("%s: the exclusion of class %s applies to v1 too", x.Written[0], x.Class)
		}
		if x.Reading != "" && len(conjugation.ExcludedForms(class, x.Written[0], "")) != 0 {
			t.Errorf("%s: the exclusion of reading %s applies to any reading", x.Written[0], x.Reading)
		}
	}
}

type answer struct {
	Written []string `json:"written"`
	Reading []string `json:"reading"`
}

type formsFixture struct {
	Version  int    `json:"version"`
	Rule     string `json:"rule"`
	Classify []struct {
		Name  string     `json:"name"`
		POS   [][]string `json:"pos"`
		Class *string    `json:"class"`
	} `json:"classify"`
	Conjugate []struct {
		Name      string            `json:"name"`
		Written   string            `json:"written"`
		Spellings []string          `json:"spellings"`
		Reading   string            `json:"reading"`
		Class     string            `json:"class"`
		Families  []string          `json:"families"`
		Forms     map[string]answer `json:"forms"`
	} `json:"conjugate"`
	Ineligible []struct {
		Name    string `json:"name"`
		Written string `json:"written"`
		Reading string `json:"reading"`
		Class   string `json:"class"`
	} `json:"ineligible"`
	LemmaGaps []string `json:"lemmaGaps"`
}

func loadForms(t *testing.T) formsFixture {
	t.Helper()
	var fx formsFixture
	decodeFixture(t, "forms.json", &fx)
	if fx.Version != 1 || fx.Rule != "conjugation/forms" || len(fx.Conjugate) == 0 {
		t.Fatalf("header = %d %q with %d cases", fx.Version, fx.Rule, len(fx.Conjugate))
	}
	return fx
}

// TestFormsContract: the class of a part-of-speech list, the forms of each
// word (canonical answer first, accepted alternatives after) and the words
// the engine refuses (docs/contracts/conjugation/forms.json).
func TestFormsContract(t *testing.T) {
	fx := loadForms(t)
	for _, c := range fx.Classify {
		t.Run("classify/"+c.Name, func(t *testing.T) {
			want := ""
			if c.Class != nil {
				want = *c.Class
			}
			if got := conjugation.Classify(c.POS); got != want {
				t.Errorf("Classify(%v) = %q, want %q", c.POS, got, want)
			}
		})
	}
	for _, c := range fx.Conjugate {
		t.Run("conjugate/"+c.Name, func(t *testing.T) {
			w, ok := conjugation.Conjugate(c.Class, c.Written, c.Reading, c.Spellings...)
			if !ok {
				t.Fatalf("Conjugate(%q, %q, %q) refused", c.Class, c.Written, c.Reading)
			}
			if !slices.Equal(w.Families, c.Families) {
				t.Errorf("families = %v, want %v", w.Families, c.Families)
			}
			for id, want := range c.Forms {
				got := w.Forms[id]
				var written, reading []string
				for _, a := range got {
					written = append(written, a.Written)
					reading = append(reading, a.Reading)
				}
				if !slices.Equal(written, want.Written) || !slices.Equal(reading, want.Reading) {
					t.Errorf("%s = %v / %v, want %v / %v", id, written, reading, want.Written, want.Reading)
				}
			}
			for id := range w.Forms {
				if _, ok := c.Forms[id]; !ok {
					t.Errorf("extra form %s = %v", id, w.Forms[id])
				}
			}
		})
	}
	for _, c := range fx.Ineligible {
		t.Run("ineligible/"+c.Name, func(t *testing.T) {
			if w, ok := conjugation.Conjugate(c.Class, c.Written, c.Reading); ok {
				t.Errorf("Conjugate(%q, %q, %q) = %v, want refused", c.Class, c.Written, c.Reading, w)
			}
		})
	}
}
