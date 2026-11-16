package radicals

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"
)

// The embedded copy must be byte-identical to the contract fixture: Go
// embed cannot reach docs/, so the copy is checked here instead.
func TestEmbeddedCopyMatchesContract(t *testing.T) {
	want, err := os.ReadFile("../../../docs/contracts/radicals/kangxi.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(want, kangxiJSON) {
		t.Fatal("server/internal/radicals/kangxi.json differs from docs/contracts/radicals/kangxi.json; copy the contract file")
	}
}

func TestTable(t *testing.T) {
	seen := map[int]bool{}
	for _, r := range Rows() {
		if seen[r.N] {
			t.Fatalf("radical %d twice", r.N)
		}
		seen[r.N] = true
	}
	for n := 1; n <= 214; n++ {
		if !seen[n] || !Valid(n) {
			t.Fatalf("radical %d missing", n)
		}
	}
	if len(Rows()) != 214 {
		t.Fatalf("rows = %d, want 214", len(Rows()))
	}
	for _, n := range []int{0, 215, -1} {
		if Valid(n) || Strokes(n) != 0 {
			t.Fatalf("%d must be invalid", n)
		}
		if _, ok := Char(n); ok {
			t.Fatalf("Char(%d) ok", n)
		}
	}
	if c, ok := Char(85); !ok || c != "水" {
		t.Fatalf("Char(85) = %q %v", c, ok)
	}
	if c, _ := Char(149); c != "言" {
		t.Fatalf("Char(149) = %q", c)
	}
	for n, want := range map[int]int{1: 1, 6: 1, 7: 2, 114: 5, 118: 6, 211: 15, 213: 16, 214: 17} {
		if got := Strokes(n); got != want {
			t.Errorf("Strokes(%d) = %d, want %d", n, got, want)
		}
	}
}

func TestNumber(t *testing.T) {
	for char, want := range map[string]int{
		"水": 85, "氵": 85, "讠": 149, "言": 149, "訁": 149, "竜": 212, "月": 74, "⺼": 130,
		"阝": 163, "⻏": 163, "⻖": 170, "x": 0, "": 0, "語": 0, "水水": 0,
	} {
		if got := Number(char); got != want {
			t.Errorf("Number(%q) = %d, want %d", char, got, want)
		}
	}
}

// Every row of the contract decodes with the shape the web module reads.
func TestContractShape(t *testing.T) {
	var doc struct {
		Version int    `json:"version"`
		Rule    string `json:"rule"`
		Rows    []struct {
			N     int                 `json:"n"`
			C     string              `json:"c"`
			S     int                 `json:"s"`
			Forms map[string][]string `json:"forms"`
		} `json:"rows"`
	}
	if err := json.Unmarshal(kangxiJSON, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Version != 1 || doc.Rule != "radicals/kangxi" || len(doc.Rows) != 214 {
		t.Fatalf("header %d %q %d", doc.Version, doc.Rule, len(doc.Rows))
	}
	for _, r := range doc.Rows {
		for _, k := range []string{"all", "zh", "ja"} {
			if _, ok := r.Forms[k]; !ok {
				t.Fatalf("radical %d lacks forms.%s", r.N, k)
			}
		}
	}
}
