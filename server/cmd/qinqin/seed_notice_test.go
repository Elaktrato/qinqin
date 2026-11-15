package main

import (
	"slices"
	"strings"
	"testing"

	"qinqin/internal/dict"
)

// TestCommittedPackNotices: every committed pack decides whether it
// needs a caveat on the Sources page. The packs whose terms or
// compilation need one carry a valid, non-empty manifest notice; the
// others are listed as needing none, so a new bundled pack fails here
// until someone decides.
func TestCommittedPackNotices(t *testing.T) {
	needNotice := map[string][]string{
		"jiten-frequency": {"[Jiten](https://jiten.moe/frequency-dictionaries)", "CC BY-SA 4.0", "ranks unmodified"},
		"joyo-grades":     {"KANJIDIC2", "Jinmeiyō"},
		"tgh-chars":       {"国发〔2013〕23号", "kTGH"},
		"jlpt-kanji":      {"approximate", "[kanjiapi.dev](https://github.com/onlyskin/kanjiapi.dev)"},
		"hsk-words":       {"HSK 词汇大纲", "[Legal Notice](https://www.chinesetest.cn/legal-notice)"},
		"hsk-chars":       {"HSK 汉字大纲", "[Legal Notice](https://www.chinesetest.cn/legal-notice)"},
	}
	noNotice := []string{"cedict", "es-demo", "jmdict", "kanjidic2", "unihan"}

	packs, err := findPacksIn(committedPacks)
	if err != nil {
		t.Fatal(err)
	}
	var seen []string
	for _, p := range packs {
		m := p.pack.Manifest
		seen = append(seen, m.ID)
		if err := dict.ValidateNotice(m.Notice); err != nil {
			t.Errorf("%s: %v", m.ID, err)
		}
		wants, needs := needNotice[m.ID]
		switch {
		case needs && m.Notice == "":
			t.Errorf("%s: no notice; its Sources page caveat belongs in the manifest", m.ID)
		case needs:
			for _, want := range wants {
				if !strings.Contains(m.Notice, want) {
					t.Errorf("%s: notice lacks %q", m.ID, want)
				}
			}
		case !slices.Contains(noNotice, m.ID):
			t.Errorf("%s: a new committed pack; decide whether it needs a notice and list it in this test", m.ID)
		}
	}
	for id := range needNotice {
		if !slices.Contains(seen, id) {
			t.Errorf("%s: expected a committed pack with a notice, not found", id)
		}
	}
}
