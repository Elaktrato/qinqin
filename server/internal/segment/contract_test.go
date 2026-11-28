package segment_test

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"qinqin/internal/segment"
)

// casesFixture is docs/contracts/segment/cases.json: a JMdict-shaped
// lexicon and texts with the tokens the lattice segmenter must produce.
type casesFixture struct {
	Version  int    `json:"version"`
	Rule     string `json:"rule"`
	Language string `json:"language"`
	Rules    string `json:"rules"`
	Doc      string `json:"_doc"`
	Lexicon  []struct {
		Forms    []string `json:"forms"`
		Readings []string `json:"readings"`
		POS      []string `json:"pos"`
		Pri      []string `json:"pri"`
		UK       bool     `json:"uk"`
	} `json:"lexicon"`
	Cases []segmentCase `json:"cases"`
}

type segmentCase struct {
	Name   string   `json:"name"`
	Text   string   `json:"text"`
	Greedy []string `json:"greedy"`
	Tokens []struct {
		Surface  string `json:"surface"`
		Lemma    string `json:"lemma"`
		Head     string `json:"head"`
		Function bool   `json:"function"`
	} `json:"tokens"`
}

func readCases(t *testing.T) casesFixture {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/segment/cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx casesFixture
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&fx); err != nil {
		t.Fatal(err)
	}
	if fx.Version != 1 || fx.Rule != "segment/cases" || fx.Language != "ja" || fx.Rules != "ja.json" || len(fx.Cases) == 0 {
		t.Fatalf("fixture header = %+v", fx)
	}
	return fx
}

// The rules file of the contract is the one the server embeds, byte for
// byte, and it parses.
func TestContractRulesAreEmbedded(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/segment/ja.json")
	if err != nil {
		t.Fatal(err)
	}
	embedded, ok := segment.RulesFile("ja")
	if !ok || !bytes.Equal(raw, embedded) {
		t.Fatal("docs/contracts/segment/ja.json differs from server/internal/segment/rules/ja.json")
	}
	if _, err := segment.ParseRules(raw); err != nil {
		t.Fatal(err)
	}
}

func TestContractSegmentCases(t *testing.T) {
	fx := readCases(t)
	words := make([]jw, len(fx.Lexicon))
	for i, w := range fx.Lexicon {
		words[i] = jw{kanji: w.Forms, readings: w.Readings, pos: w.POS, pri: w.Pri, uk: w.UK}
	}
	svc, sqlDB := jaService(t, words, "")
	for _, c := range fx.Cases {
		ms, err := svc.Segment(context.Background(), fx.Language, c.Text)
		if err != nil {
			t.Fatalf("%s: %v", c.Name, err)
		}
		var got, want []string
		for i := range ms {
			head := ""
			if hs := headwords(t, sqlDB, &ms[i]); len(hs) > 0 {
				head = hs[0]
			}
			got = append(got, tokenString(ms[i].Surface, ms[i].Lemma, head, ms[i].Function))
		}
		for _, w := range c.Tokens {
			want = append(want, tokenString(w.Surface, w.Lemma, w.Head, w.Function))
		}
		if strings.Join(got, " | ") != strings.Join(want, " | ") {
			t.Errorf("%s: Segment(%q)\n got  %s\n want %s", c.Name, c.Text, strings.Join(got, " | "), strings.Join(want, " | "))
		}
	}
}

func tokenString(surface, lemma, head string, function bool) string {
	s := surface + "(" + lemma + "/" + head + ")"
	if function {
		s += "*"
	}
	return s
}
