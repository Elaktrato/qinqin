package api

import (
	"reflect"
	"testing"

	"qinqin/internal/lexicon"
)

// 鸡 as CC-CEDICT imports it (one sense per line) under dictionary 1, and a
// second dictionary that glosses it too.
var jiSenses = []lexicon.Sense{
	{DictionaryID: 1, Glosses: []string{"(slang) prostitute"}},
	{DictionaryID: 1, Glosses: []string{"fowl", "chicken"}},
	{DictionaryID: 2, Glosses: []string{"(vulgar) whore"}},
	{DictionaryID: 3, Glosses: []string{"hen"}},
}

// The one gloss a list shows follows the sense display rule (#345,
// docs/contracts/senses): never a folded slang or vulgar line.
func TestListGlossesFollowTheSenseDisplayRule(t *testing.T) {
	e := lexicon.Entry{Senses: jiSenses}
	if g := firstGloss(e); g != "fowl" {
		t.Errorf("firstGloss = %q, want fowl", g)
	}
	if g := firstEntryGloss(e); g != "fowl" {
		t.Errorf("firstEntryGloss = %q, want fowl", g)
	}
	want := []searchGloss{{DictionaryID: 1, Gloss: "fowl"}, {DictionaryID: 3, Gloss: "hen"}}
	if got := firstGlosses(e); !reflect.DeepEqual(got, want) {
		t.Errorf("firstGlosses = %+v, want %+v", got, want)
	}
	only := lexicon.Entry{Senses: []lexicon.Sense{{DictionaryID: 1, Glosses: []string{"penis (vulgar)"}}}}
	if g := firstGloss(only); g != "penis (vulgar)" {
		t.Errorf("an entry with only a vulgar sense shows it: %q", g)
	}
	if got := firstGlosses(only); len(got) != 1 || got[0].Gloss != "penis (vulgar)" {
		t.Errorf("firstGlosses of a vulgar-only entry = %+v", got)
	}
	if got := firstGlosses(lexicon.Entry{}); got == nil || len(got) != 0 {
		t.Errorf("firstGlosses of no senses = %#v", got)
	}
}
