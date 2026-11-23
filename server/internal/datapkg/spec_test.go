package datapkg_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/datapkg"
)

func specByID(t *testing.T, specs []datapkg.Spec, id string) datapkg.Spec {
	t.Helper()
	for _, s := range specs {
		if s.ID == id {
			return s
		}
	}
	t.Fatalf("no spec %s in %v", id, specIDs(specs))
	return datapkg.Spec{}
}

func specIDs(specs []datapkg.Spec) []string {
	var ids []string
	for _, s := range specs {
		ids = append(ids, s.ID)
	}
	return ids
}

func TestPlanListsOnePackagePerLanguageAndPack(t *testing.T) {
	s := seedAll(t)
	specs, err := datapkg.Plan(context.Background(), s.db)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"audio.ja-audio", "components.zh-comp", "frequency.zh-freq", "grammar.zh-gram", "lemma-rules.ja-rules",
		"levels.zh-levels", "lexicon.ja", "lexicon.zh", "sentences.zh-sent", "strokes.hw"}
	if got := specIDs(specs); !slices.Equal(got, want) {
		t.Fatalf("Plan ids = %v, want %v (sorted)", got, want)
	}

	zh := specByID(t, specs, "lexicon.zh")
	if zh.Type != datapkg.TypeLexicon || !slices.Equal(zh.Languages, []string{"zh"}) || zh.Optional || len(zh.Requires) != 0 {
		t.Errorf("lexicon.zh = %+v", zh)
	}
	if len(zh.Sources) != 2 || zh.Sources[0].PackID != "zh-a" || zh.Sources[1].PackID != "zh-b" {
		t.Fatalf("lexicon.zh sources = %+v, want zh-a and zh-b", zh.Sources)
	}
	a := zh.Sources[0]
	if a.Type != "dictionary" || a.Name != "Zh A" || a.Version != "1.0" || a.License != "CC0-1.0" ||
		a.Attribution != "Qinqin test fixtures" || a.Notice != "Zh A notice." || !a.TextsStored {
		t.Errorf("zh-a source = %+v", a)
	}
	if len(a.Texts) != 2 || a.Texts[0].Name != "ATTRIBUTION.md" || a.Texts[1].Name != "LICENSE" || a.Texts[1].Text != zhALicense {
		t.Errorf("zh-a texts = %+v", a.Texts)
	}
	if len(zh.Sources[1].Texts) != 0 || !zh.Sources[1].TextsStored {
		t.Errorf("zh-b ships no licence files but its texts were collected: %+v", zh.Sources[1])
	}
	if !zh.LicenseTexts() {
		t.Error("lexicon.zh: LicenseTexts = false, want true (every source's texts were collected)")
	}

	if ja := specByID(t, specs, "lexicon.ja"); len(ja.Sources) != 1 || ja.Sources[0].PackID != "ja-a" {
		t.Errorf("lexicon.ja = %+v", ja)
	}
	for id, req := range map[string]string{"levels.zh-levels": "lexicon.zh", "sentences.zh-sent": "lexicon.zh"} {
		if got := specByID(t, specs, id).Requires; !slices.Equal(got, []string{req}) {
			t.Errorf("%s requires %v, want [%s]", id, got, req)
		}
	}
	for _, id := range []string{"frequency.zh-freq", "components.zh-comp", "grammar.zh-gram", "strokes.hw", "audio.ja-audio"} {
		if got := specByID(t, specs, id).Requires; len(got) != 0 {
			t.Errorf("%s requires %v, want none", id, got)
		}
	}
	if !specByID(t, specs, "audio.ja-audio").Optional {
		t.Error("audio.ja-audio is not optional")
	}
	if got := specByID(t, specs, "strokes.hw"); !slices.Equal(got.Languages, []string{"ja", "zh"}) || got.Type != datapkg.TypeStrokes {
		t.Errorf("strokes.hw = %+v, want languages [ja zh]", got)
	}
	if got := specByID(t, specs, "components.zh-comp"); !slices.Equal(got.Languages, []string{"zh"}) || len(got.Sources) != 1 ||
		got.Sources[0].Type != "components" || got.Sources[0].PackID != "zh-comp" {
		t.Errorf("components.zh-comp = %+v", got)
	}
}

func TestPlanDropsUninstalledAndFlagsMissingTexts(t *testing.T) {
	s := seedAll(t)
	ctx := context.Background()
	if _, err := s.db.Exec(`UPDATE dictionaries SET deleted_at = '2026-01-01T00:00:00Z' WHERE pack_id = 'ja-a'`); err != nil {
		t.Fatal(err)
	}
	// zh-b imported before the server kept licence texts: no pack_texts rows.
	if _, err := s.db.Exec(`DELETE FROM pack_texts WHERE pack_id = 'zh-b'`); err != nil {
		t.Fatal(err)
	}
	specs, err := datapkg.Plan(ctx, s.db)
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(specIDs(specs), "lexicon.ja") {
		t.Errorf("lexicon.ja planned without a live ja dictionary: %v", specIDs(specs))
	}
	zh := specByID(t, specs, "lexicon.zh")
	if zh.LicenseTexts() || zh.Sources[1].TextsStored {
		t.Errorf("lexicon.zh with zh-b's texts never collected: LicenseTexts = %v, source %+v", zh.LicenseTexts(), zh.Sources[1])
	}
}

// TestParseIDAgainstCatalogueFixture: every id of a valid catalogue parses;
// the ids the fixture rejects for the id grammar do not.
func TestParseIDAgainstCatalogueFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "packages", "catalogue.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Cases []struct {
			Name      string `json:"name"`
			Valid     bool   `json:"valid"`
			Reason    string `json:"reason"`
			Catalogue struct {
				Packages []struct {
					ID   string `json:"id"`
					Type string `json:"type"`
				} `json:"packages"`
			} `json:"catalogue"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	valid, invalid := 0, 0
	for _, c := range fx.Cases {
		for _, p := range c.Catalogue.Packages {
			typ, rest, err := datapkg.ParseID(p.ID)
			switch {
			case c.Valid:
				valid++
				if err != nil || string(typ) != p.Type || rest == "" {
					t.Errorf("%s: ParseID(%q) = %q, %q, %v", c.Name, p.ID, typ, rest, err)
				}
			case c.Reason == "id does not match idPattern":
				invalid++
				if _, _, err := datapkg.ParseID(p.ID); err == nil {
					t.Errorf("%s: ParseID(%q) accepted", c.Name, p.ID)
				}
			}
		}
	}
	if valid == 0 || invalid != 3 {
		t.Errorf("fixture ids: %d valid, %d invalid; want some valid and 3 invalid", valid, invalid)
	}
	for _, id := range []string{"", "lexicon", "lexicon.", ".zh", "lexicon.zh.x", "strokes.Hw", "strokes.-hw", "lexicon.z", "levels.a_b", "../lexicon.zh"} {
		if _, _, err := datapkg.ParseID(id); err == nil {
			t.Errorf("ParseID(%q) accepted", id)
		}
	}
	if typ, rest, err := datapkg.ParseID("lexicon.pt-br"); err != nil || typ != datapkg.TypeLexicon || rest != "pt-br" {
		t.Errorf("ParseID(lexicon.pt-br) = %q, %q, %v", typ, rest, err)
	}
}
