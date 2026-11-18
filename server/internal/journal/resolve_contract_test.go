package journal

import (
	"encoding/json"
	"os"
	"testing"

	"qinqin/internal/ai"
)

// docs/contracts/journal/kind-resolve.json: the model's kind is normalised
// to the closed set, and anything else is a mistake.
func TestResolveKindContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/journal/kind-resolve.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Cases []struct {
			Name string  `json:"name"`
			Raw  *string `json:"raw"`
			Kind string  `json:"kind"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(fx.Cases) < 9 {
		t.Fatalf("cases = %d", len(fx.Cases))
	}
	for _, c := range fx.Cases {
		in := ai.RawAnnotation{Quote: "bad", Correction: "good", Explanation: "why", Category: "grammar"}
		if c.Raw != nil {
			in.Kind = *c.Raw
		}
		kept, dropped := ResolveAnnotations("bad", "en", []ai.RawAnnotation{in})
		if len(kept) != 1 {
			t.Errorf("%s: kept %d annotations, dropped %+v", c.Name, len(kept), dropped)
			continue
		}
		if kept[0].Kind != c.Kind {
			t.Errorf("%s: kind = %q, want %q", c.Name, kept[0].Kind, c.Kind)
		}
	}
}

func TestResolveKindNeverDrops(t *testing.T) {
	kept, dropped := ResolveAnnotations("bad", "en", []ai.RawAnnotation{{Quote: "bad", Correction: "good", Explanation: "why", Category: "grammar", Kind: "error"}})
	if len(kept) != 1 || dropped.Total() != 0 {
		t.Fatalf("kept %d, dropped %+v", len(kept), dropped)
	}
	if kept[0].Kind != "mistake" {
		t.Errorf("kind = %q", kept[0].Kind)
	}
}
