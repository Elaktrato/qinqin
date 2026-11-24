package sentences_test

import (
	"bytes"
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/ai"
	"qinqin/internal/model"
	"qinqin/internal/segment"
	"qinqin/internal/sentences"
)

// fxString is a fixture string: plain, or {"repeat": s, "times": n}.
type fxString string

func (f *fxString) UnmarshalJSON(b []byte) error {
	var s string
	if json.Unmarshal(b, &s) == nil {
		*f = fxString(s)
		return nil
	}
	var r struct {
		Repeat string `json:"repeat"`
		Times  int    `json:"times"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		return err
	}
	*f = fxString(strings.Repeat(r.Repeat, r.Times))
	return nil
}

type examplesFixture struct {
	Levels  []string `json:"levels"`
	Reasons []string `json:"reasons"`
	Limits  struct {
		PerGeneration, KeptPerEntry, TextRunes, ReadingRunes, TranslationRunes, FewExamples, ReportsPerUser, RequestIDLength int
	} `json:"limits"`
	Draft     json.RawMessage `json:"draft"`
	Examples  json.RawMessage `json:"examples"`
	WithReq   json.RawMessage `json:"examplesWithRequest"`
	Generated json.RawMessage `json:"generated"`
	Kept      json.RawMessage `json:"kept"`
	Plain     json.RawMessage `json:"plain"`
	Generate  struct {
		Accept []struct {
			Level     string   `json:"level"`
			RequestID fxString `json:"requestId"`
		} `json:"accept"`
		Refuse []struct {
			Level     string    `json:"level"`
			RequestID *fxString `json:"requestId"`
			Why       string    `json:"why"`
		} `json:"refuse"`
	} `json:"generate"`
	Reports struct {
		Accept []string `json:"accept"`
		Refuse []string `json:"refuse"`
	} `json:"reports"`
	Checks []struct {
		Name          string `json:"name"`
		Language      string `json:"language"`
		ReadingSystem string `json:"readingSystem"`
		Word          struct {
			ID      int64    `json:"id"`
			Written string   `json:"written"`
			Forms   []string `json:"forms"`
		} `json:"word"`
		Segmented bool            `json:"segmented"`
		Matches   []segment.Match `json:"matches"`
		Existing  []string        `json:"existing"`
		Sentence  struct {
			Text, Reading, Translation fxString
		} `json:"sentence"`
		Want struct {
			Keep                       bool   `json:"keep"`
			Reason                     string `json:"reason"`
			Text, Reading, Translation string
		} `json:"want"`
	} `json:"checks"`
}

func readExamplesFixture(t *testing.T) examplesFixture {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/examples/examples.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx examplesFixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	return fx
}

func TestExamplesFixtureConstants(t *testing.T) {
	fx := readExamplesFixture(t)
	if !slices.Equal(fx.Levels, ai.Levels) {
		t.Errorf("levels = %v, server %v", fx.Levels, ai.Levels)
	}
	if !slices.Equal(fx.Reasons, sentences.ReportReasons) {
		t.Errorf("reasons = %v, server %v", fx.Reasons, sentences.ReportReasons)
	}
	l := fx.Limits
	for name, pair := range map[string][2]int{
		"perGeneration": {l.PerGeneration, ai.MaxExamples}, "keptPerEntry": {l.KeptPerEntry, sentences.MaxKeptPerEntry},
		"textRunes": {l.TextRunes, sentences.MaxExampleTextRunes}, "readingRunes": {l.ReadingRunes, sentences.MaxExampleReadingRunes},
		"translationRunes": {l.TranslationRunes, sentences.MaxExampleTranslationRunes}, "fewExamples": {l.FewExamples, sentences.FewExamples},
		"reportsPerUser": {l.ReportsPerUser, sentences.MaxReportsPerUser}, "requestIdLength": {l.RequestIDLength, sentences.MaxRequestIDLength},
	} {
		if pair[0] != pair[1] {
			t.Errorf("limit %s = %d, server %d", name, pair[0], pair[1])
		}
	}
}

// remarshal decodes raw into v and compares the encoding with raw.
func remarshal(t *testing.T, name string, raw json.RawMessage, v any) {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var a, b any
	_ = json.Unmarshal(raw, &a)
	_ = json.Unmarshal(out, &b)
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	if !bytes.Equal(ja, jb) {
		t.Errorf("%s: the server writes\n%s\nthe fixture says\n%s", name, jb, ja)
	}
}

func TestExamplesFixtureShapes(t *testing.T) {
	fx := readExamplesFixture(t)
	var d sentences.Draft
	remarshal(t, "draft", fx.Draft, &d)
	var v, vr sentences.ExamplesView
	remarshal(t, "examples", fx.Examples, &v)
	remarshal(t, "examplesWithRequest", fx.WithReq, &vr)
	var g sentences.GenerationResult
	remarshal(t, "generated", fx.Generated, &g)
	var kept, plain model.Sentence
	remarshal(t, "kept", fx.Kept, &kept)
	remarshal(t, "plain", fx.Plain, &plain)
	if kept.AI == nil || kept.AI.Provider != "anthropic" || plain.AI != nil {
		t.Errorf("marks: kept %+v, plain %+v", kept.AI, plain.AI)
	}
}

func TestExamplesFixtureRequests(t *testing.T) {
	fx := readExamplesFixture(t)
	for _, c := range fx.Generate.Accept {
		if !ai.ValidLevel(c.Level) || !sentences.ValidRequestID(string(c.RequestID)) {
			t.Errorf("accept %+v refused", c)
		}
	}
	for _, c := range fx.Generate.Refuse {
		id := ""
		if c.RequestID != nil {
			id = string(*c.RequestID)
		}
		if ai.ValidLevel(c.Level) && sentences.ValidRequestID(id) {
			t.Errorf("refuse (%s) accepted", c.Why)
		}
	}
	for _, r := range fx.Reports.Accept {
		if !sentences.ValidReason(r) {
			t.Errorf("reason %q refused", r)
		}
	}
	for _, r := range fx.Reports.Refuse {
		if sentences.ValidReason(r) {
			t.Errorf("reason %q accepted", r)
		}
	}
}

func TestExamplesFixtureChecks(t *testing.T) {
	fx := readExamplesFixture(t)
	for _, c := range fx.Checks {
		w := sentences.Word{ID: c.Word.ID, Language: c.Language, Written: c.Word.Written, Forms: c.Word.Forms}
		var matches []segment.Match
		if c.Segmented {
			matches = c.Matches
			if matches == nil {
				matches = []segment.Match{}
			}
		}
		got, reason := sentences.CheckExample(sentences.Candidate{Text: string(c.Sentence.Text), Reading: string(c.Sentence.Reading), Translation: string(c.Sentence.Translation)},
			w, c.ReadingSystem, matches, c.Existing)
		if c.Want.Keep {
			want := sentences.Candidate{Text: c.Want.Text, Reading: c.Want.Reading, Translation: c.Want.Translation}
			if reason != "" || got != want {
				t.Errorf("%s: got %+v (%q), want %+v kept", c.Name, got, reason, want)
			}
		} else if reason != c.Want.Reason {
			t.Errorf("%s: reason %q, want %q", c.Name, reason, c.Want.Reason)
		}
	}
}

// The word check is the cloze card's blank rule: on every candidate of
// docs/contracts/cards/cloze.json, a sentence contains the word exactly when
// the cloze fixture calls it eligible.
func TestContainsWordFollowsTheClozeFixture(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/cards/cloze.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Cases []struct {
			Name  string `json:"name"`
			Entry struct {
				ID      int64  `json:"id"`
				Written string `json:"written"`
				Forms   []struct {
					Text string `json:"text"`
				} `json:"forms"`
			} `json:"entry"`
			Sentences []struct {
				ID    int64  `json:"id"`
				Hanzi string `json:"hanzi"`
			} `json:"sentences"`
			Matches     map[string][]segment.Match `json:"matchesBySentence"`
			EligibleIDs []int64                    `json:"eligibleIds"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, c := range fx.Cases {
		w := sentences.Word{ID: c.Entry.ID, Written: c.Entry.Written}
		for _, f := range c.Entry.Forms {
			w.Forms = append(w.Forms, f.Text)
		}
		candidates := 0
		for _, s := range c.Sentences {
			if strings.TrimSpace(s.Hanzi) == "" {
				continue
			}
			if candidates++; candidates > 8 {
				break
			}
			matches := c.Matches[jsonID(s.ID)]
			if matches == nil {
				matches = []segment.Match{}
			}
			got := sentences.ContainsWord(s.Hanzi, w, matches)
			if want := slices.Contains(c.EligibleIDs, s.ID); got != want {
				t.Errorf("%s: sentence %d %q contains = %v, cloze eligible = %v", c.Name, s.ID, s.Hanzi, got, want)
			}
			checked++
		}
	}
	if checked < 16 {
		t.Fatalf("only %d sentences checked", checked)
	}
}

func jsonID(id int64) string { b, _ := json.Marshal(id); return string(b) }
