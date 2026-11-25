package images_test

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/images"
)

// The fixtures of docs/contracts/images/: the resolution rule and the picture
// vocabulary every client implements the same way.

func readFixture(t *testing.T, name string, v any) {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/images/" + name)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

func TestContractResolve(t *testing.T) {
	var fx struct {
		Packs []struct {
			PackID   string   `json:"packId"`
			Live     bool     `json:"live"`
			Pictures []string `json:"pictures"`
			Map      []struct {
				Language string `json:"language"`
				Target   string `json:"target"`
				Sense    int    `json:"sense"`
				Concept  string `json:"concept"`
				Score    int    `json:"score"`
			} `json:"map"`
		} `json:"packs"`
		Cases []struct {
			Name     string   `json:"name"`
			Language string   `json:"language"`
			Targets  []string `json:"targets"`
			Sense    int      `json:"sense"`
			Pack     *string  `json:"pack"`
			Concept  *string  `json:"concept"`
		} `json:"cases"`
	}
	readFixture(t, "resolve.json", &fx)
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	for _, p := range fx.Packs {
		var deleted any
		if !p.Live {
			deleted = "2026-01-01T00:00:00Z"
		}
		if _, err := sqlDB.Exec(`INSERT INTO image_packs (pack_id, name, version, languages, license, attribution, updated_at, deleted_at)
			VALUES (?, ?, '1', '["ja","zh"]', 'CC BY-SA 4.0', 'x', '2026-01-01T00:00:00Z', ?)`, p.PackID, p.PackID, deleted); err != nil {
			t.Fatal(err)
		}
		for _, c := range p.Pictures {
			if _, err := sqlDB.Exec(`INSERT INTO image_pictures (pack_id, concept, label, credit, svg) VALUES (?, ?, ?, 'c', '<svg/>')`, p.PackID, c, c); err != nil {
				t.Fatal(err)
			}
		}
		for _, m := range p.Map {
			if _, err := sqlDB.Exec(`INSERT INTO image_map (pack_id, language, target, sense, concept, score, basis) VALUES (?, ?, ?, ?, ?, ?, 'manual')`,
				p.PackID, m.Language, m.Target, m.Sense, m.Concept, m.Score); err != nil {
				t.Fatal(err)
			}
		}
	}
	if len(fx.Cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range fx.Cases {
		f, ok, err := images.Resolve(ctx, sqlDB, c.Language, c.Targets, c.Sense)
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		switch {
		case c.Concept == nil && ok:
			t.Errorf("%s: got %s/%s, want no picture", c.Name, f.PackID, f.Concept)
		case c.Concept != nil && (!ok || f.Concept != *c.Concept || f.PackID != *c.Pack):
			t.Errorf("%s: got %s/%s (ok %v), want %s/%s", c.Name, f.PackID, f.Concept, ok, *c.Pack, *c.Concept)
		}
	}
}

func TestContractSVG(t *testing.T) {
	var fx struct {
		Valid   []struct{ Name, SVG string } `json:"valid"`
		Invalid []struct{ Name, SVG string } `json:"invalid"`
	}
	readFixture(t, "svg.json", &fx)
	if len(fx.Valid) == 0 || len(fx.Invalid) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range fx.Valid {
		if err := images.CheckSVG([]byte(c.SVG)); err != nil {
			t.Errorf("valid %q: %v", c.Name, err)
		}
	}
	for _, c := range fx.Invalid {
		if err := images.CheckSVG([]byte(c.SVG)); err == nil {
			t.Errorf("invalid %q was accepted", c.Name)
		}
	}
}
