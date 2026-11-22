package segment_test

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"testing"

	"qinqin/internal/lang"
)

// segmentFixture is docs/contracts/lemma/segment.json: a small JMdict-
// shaped lexicon and texts with the tokens the server must produce.
type segmentFixture struct {
	Version  int    `json:"version"`
	Rule     string `json:"rule"`
	Language string `json:"language"`
	Table    string `json:"table"`
	Lexicon  []struct {
		Forms    []string `json:"forms"`
		Readings []string `json:"readings"`
		POS      []string `json:"pos"`
		Pri      []string `json:"pri"`
		UK       bool     `json:"uk"`
	} `json:"lexicon"`
	Cases []struct {
		Name   string `json:"name"`
		Text   string `json:"text"`
		Tokens []struct {
			Surface string   `json:"surface"`
			Start   int      `json:"start"`
			End     int      `json:"end"`
			Lemma   string   `json:"lemma"`
			Reasons []string `json:"reasons"`
			Head    string   `json:"head"`
		} `json:"tokens"`
	} `json:"cases"`
}

func TestContractLemmaSegment(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/lemma/segment.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx segmentFixture
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&fx); err != nil {
		t.Fatal(err)
	}
	if fx.Version != 1 || fx.Rule != "lemma/segment" || fx.Language != "ja" || len(fx.Cases) == 0 {
		t.Fatalf("fixture header = %+v", fx)
	}
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
		if len(ms) != len(c.Tokens) {
			t.Errorf("%s: Segment(%q) = %d tokens %+v, want %d", c.Name, c.Text, len(ms), ms, len(c.Tokens))
			continue
		}
		for i, w := range c.Tokens {
			m := ms[i]
			head := ""
			if hs := headwords(t, sqlDB, &m); len(hs) > 0 {
				head = hs[0]
			}
			if m.Surface != w.Surface || m.Start != w.Start || m.End != w.End || m.Lemma != w.Lemma ||
				m.Reason != lang.ReasonOf(w.Reasons) || head != w.Head {
				t.Errorf("%s: token %d = %s [%d,%d) %s (%s) %s, want %s [%d,%d) %s (%s) %s", c.Name, i,
					m.Surface, m.Start, m.End, m.Lemma, m.Reason, head,
					w.Surface, w.Start, w.End, w.Lemma, lang.ReasonOf(w.Reasons), w.Head)
			}
		}
	}
}
