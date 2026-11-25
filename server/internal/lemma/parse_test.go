package lemma_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/lemma"
)

// docs/contracts/lemma/parse.json: one JSON object per file, no duplicate
// keys, no unknown keys.
func TestContractParse(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(contractDir, "parse.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Version int    `json:"version"`
		Rule    string `json:"rule"`
		Doc     string `json:"_doc"`
		Cases   []struct {
			Name   string `json:"name"`
			Text   string `json:"text"`
			Valid  bool   `json:"valid"`
			Reason string `json:"reason"`
		} `json:"cases"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&fx); err != nil {
		t.Fatal(err)
	}
	if fx.Version != 1 || fx.Rule != "lemma/parse" || len(fx.Cases) < 6 {
		t.Fatalf("header %d %q, %d cases", fx.Version, fx.Rule, len(fx.Cases))
	}
	for _, c := range fx.Cases {
		_, err := lemma.Parse([]byte(c.Text))
		switch {
		case c.Valid && err != nil:
			t.Errorf("%s: %v", c.Name, err)
		case !c.Valid && (err == nil || !strings.Contains(err.Error(), c.Reason)):
			t.Errorf("%s: Parse = %v, want an error naming %q", c.Name, err, c.Reason)
		}
	}
}
