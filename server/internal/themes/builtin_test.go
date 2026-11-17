package themes

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// The built-in packs are listed in the contract's order, parse, carry a
// licence, and never repeat an id.
func TestBuiltinPacks(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/themes/themes-api.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		BuiltinPacks []struct {
			PackID string   `json:"packId"`
			Themes []string `json:"themes"`
		} `json:"builtinPacks"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	got := Builtin()
	if len(got) != len(doc.BuiltinPacks) {
		t.Fatalf("%d built-in packs, the contract lists %d", len(got), len(doc.BuiltinPacks))
	}
	seenPack, seenTheme := map[string]bool{}, map[string]bool{}
	for i, p := range got {
		want := doc.BuiltinPacks[i]
		var ids []string
		for _, th := range p.Themes {
			ids = append(ids, th.ID)
			if seenTheme[th.ID] {
				t.Errorf("theme id %s twice", th.ID)
			}
			seenTheme[th.ID] = true
			if r := Ratio(th.Colors.Text, th.Colors.Panel); r < MinText {
				t.Errorf("%s: text on panel %.2f:1, a built-in theme needs %.1f", th.ID, r, MinText)
			}
			// Button text on the default accent (the one primary action).
			if d := Derive(th, ""); Ratio(d.OnAccent, d.Accent) < MinText {
				t.Errorf("%s: on-accent on %s %.2f:1, a built-in theme needs %.1f", th.ID, d.AccentKey, Ratio(d.OnAccent, d.Accent), MinText)
			}
		}
		if p.Manifest.ID != want.PackID || strings.Join(ids, ",") != strings.Join(want.Themes, ",") {
			t.Errorf("pack %d = %s %v, want %s %v", i, p.Manifest.ID, ids, want.PackID, want.Themes)
		}
		if seenPack[p.Manifest.ID] {
			t.Errorf("pack id %s twice", p.Manifest.ID)
		}
		seenPack[p.Manifest.ID] = true
		m := p.Manifest
		if m.Type != "theme" || m.Format != "themes-json" || m.License != "MIT" || m.Attribution == "" || m.Notice == "" || m.Version == "" {
			t.Errorf("pack %s manifest %+v", m.ID, m)
		}
		if !strings.Contains(p.License, "Permission is hereby granted") || !strings.Contains(p.License, "Copyright") {
			t.Errorf("pack %s: LICENSE is not the MIT text it states", m.ID)
		}
	}
	// Builtin returns copies: a caller cannot change the embedded themes.
	got[0].Themes[0].Name = "changed"
	if Builtin()[0].Themes[0].Name == "changed" {
		t.Error("Builtin shares its slices with callers")
	}
}

// The eight themes of the approved design take the mockup's values, except
// where the mockup used another variant's value for a role (corrected to
// the upstream palette; docs/sources.md "Themes").
func TestBuiltinMatchesTheMockup(t *testing.T) {
	raw, err := os.ReadFile("testdata/mockup-themes.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Themes map[string]map[string]json.RawMessage `json:"themes"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	corrected := map[string]string{
		"rose-pine/accent:pine": "#31748f", // the mockup has Moon's pine (#3e8fb0)
		"rose-pine-dawn/text":   "#464261", // the mockup has the palette's former Dawn text (#575279)
	}
	byID := map[string]Theme{}
	for _, p := range Builtin() {
		for _, th := range p.Themes {
			byID[th.ID] = th
		}
	}
	if len(doc.Themes) != 8 {
		t.Fatalf("%d mockup themes", len(doc.Themes))
	}
	for id, mock := range doc.Themes {
		th, ok := byID[id]
		if !ok {
			t.Errorf("mockup theme %s is not built in", id)
			continue
		}
		check := func(key, got string, raw json.RawMessage) {
			var want string
			json.Unmarshal(raw, &want)
			if c, ok := corrected[id+"/"+key]; ok {
				if got != c || want == c {
					t.Errorf("%s %s = %s, want the correction %s (mockup %s)", id, key, got, c, want)
				}
				return
			}
			if got != want {
				t.Errorf("%s %s = %s, mockup %s", id, key, got, want)
			}
		}
		for _, k := range ColorKeys {
			check(k, th.Colors.Get(k), mock[k])
		}
		check("scheme", th.Scheme, mock["scheme"])
		check("defaultAccent", th.DefaultAccent, mock["defaultAccent"])
		var accents map[string]string
		json.Unmarshal(mock["accents"], &accents)
		if len(accents) != len(th.Accents) {
			t.Errorf("%s: %d accents, mockup %d", id, len(th.Accents), len(accents))
		}
		for _, a := range th.Accents {
			b, _ := json.Marshal(accents[a.Key])
			check("accent:"+a.Key, a.Color, b)
		}
	}
}
