package eligibility_test

import (
	"context"
	"encoding/json"
	"os"
	"slices"
	"strconv"
	"testing"

	"qinqin/internal/eligibility"
	"qinqin/internal/model"
	"qinqin/internal/segment"
)

type fixtureCase struct {
	Name  string `json:"name"`
	Entry struct {
		ID       int64                   `json:"id"`
		Language string                  `json:"language"`
		Kind     string                  `json:"kind"`
		Written  string                  `json:"written"`
		Forms    []struct{ Text string } `json:"forms"`
		Readings []model.Reading         `json:"readings"`
		Glosses  int                     `json:"glosses"`
	} `json:"entry"`
	Segmentable bool `json:"segmentable"`
	Sentences   []struct {
		ID    int64  `json:"id"`
		Hanzi string `json:"hanzi"`
	} `json:"sentences"`
	MatchesBySentence map[string][]segment.Match `json:"matchesBySentence"`
	Strokes           []string                   `json:"strokes"`
	Kinds             []string                   `json:"kinds"`
}

// TestEligibilityContract decodes docs/contracts/cards/eligibility.json: the
// companion kinds the server answers for an entry are the show-time rules of
// the cards (the web decodes the same fixture against cardFlow.isEligible).
func TestEligibilityContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/cards/eligibility.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Version int           `json:"version"`
		Rule    string        `json:"rule"`
		Cases   []fixtureCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Version != 1 || fx.Rule != "cards/eligibility" || len(fx.Cases) == 0 {
		t.Fatalf("fixture header = %d %q with %d cases", fx.Version, fx.Rule, len(fx.Cases))
	}
	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) {
			e := eligibility.Entry{
				ID: c.Entry.ID, Language: c.Entry.Language, Kind: c.Entry.Kind, Written: c.Entry.Written,
				Readings: c.Entry.Readings, Glosses: c.Entry.Glosses, Strokes: map[string]bool{},
			}
			for _, ch := range c.Strokes {
				e.Strokes[ch] = true
			}
			for _, f := range c.Entry.Forms {
				e.Forms = append(e.Forms, f.Text)
			}
			byText := map[string][]segment.Match{}
			for _, s := range c.Sentences {
				e.Sentences = append(e.Sentences, s.Hanzi)
				byText[s.Hanzi] = c.MatchesBySentence[strconv.FormatInt(s.ID, 10)]
			}
			var seg eligibility.SegmentFunc
			segmented := 0
			if c.Segmentable {
				seg = func(_ context.Context, language, text string) ([]segment.Match, error) {
					if language != c.Entry.Language {
						t.Errorf("segmented in %q, want %q", language, c.Entry.Language)
					}
					segmented++
					return byText[text], nil
				}
			}
			got, err := eligibility.Kinds(context.Background(), e, seg)
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(got, c.Kinds) {
				t.Errorf("Kinds = %v, want %v", got, c.Kinds)
			}
			if segmented > eligibility.ClozeCandidates {
				t.Errorf("segmented %d sentences, want at most %d", segmented, eligibility.ClozeCandidates)
			}
		})
	}
}
