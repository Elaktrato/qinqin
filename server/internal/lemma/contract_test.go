package lemma_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/lemma"
)

const contractDir = "../../../docs/contracts/lemma"

// The contract copy of the Japanese table is the embedded one, byte for
// byte, and parses on its own.
func TestContractTableIsTheBuiltin(t *testing.T) {
	copyRaw, err := os.ReadFile(filepath.Join(contractDir, "ja.rules.json"))
	if err != nil {
		t.Fatal(err)
	}
	builtin, err := lemma.BuiltinFile("ja")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(copyRaw, builtin) {
		t.Fatal("docs/contracts/lemma/ja.rules.json differs from server/internal/lemma/tables/ja.json: copy the table")
	}
	if _, err := lemma.Parse(copyRaw); err != nil {
		t.Fatal(err)
	}
}

type deinflectFixture struct {
	Version int    `json:"version"`
	Rule    string `json:"rule"`
	Table   string `json:"table"`
	Cases   []struct {
		Name    string `json:"name"`
		Surface string `json:"surface"`
		Expect  []struct {
			Form    string   `json:"form"`
			Class   string   `json:"class"`
			Reasons []string `json:"reasons"`
		} `json:"expect"`
		Reject []string `json:"reject"`
		None   bool     `json:"none"`
	} `json:"cases"`
}

func TestContractDeinflect(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(contractDir, "deinflect.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx deinflectFixture
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&fx); err != nil {
		t.Fatal(err)
	}
	if fx.Version != 1 || fx.Rule != "lemma/deinflect" || len(fx.Cases) == 0 {
		t.Fatalf("fixture header = %d %q, %d cases", fx.Version, fx.Rule, len(fx.Cases))
	}
	tableRaw, err := os.ReadFile(filepath.Join(contractDir, fx.Table))
	if err != nil {
		t.Fatal(err)
	}
	tb, err := lemma.Parse(tableRaw)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range fx.Cases {
		got := tb.Deinflect(c.Surface)
		for _, e := range c.Expect {
			if !slices.ContainsFunc(got, func(g lemma.Candidate) bool {
				return g.Form == e.Form && g.Class == e.Class && slices.Equal(g.Reasons, e.Reasons)
			}) {
				t.Errorf("%s: Deinflect(%q) = %+v, want %s/%s %v", c.Name, c.Surface, got, e.Form, e.Class, e.Reasons)
			}
		}
		for _, f := range c.Reject {
			if slices.ContainsFunc(got, func(g lemma.Candidate) bool { return g.Form == f }) {
				t.Errorf("%s: Deinflect(%q) = %+v, want no %s", c.Name, c.Surface, got, f)
			}
		}
		if c.None && len(got) != 0 {
			t.Errorf("%s: Deinflect(%q) = %+v, want none", c.Name, c.Surface, got)
		}
	}
}
