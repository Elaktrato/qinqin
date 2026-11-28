package sentences_test

import (
	"slices"
	"testing"

	"qinqin/internal/lexicon"
	"qinqin/internal/sentences"
)

// An AI example request is never given a folded slang or vulgar gloss (#345).
func TestExampleRequestLeavesFoldedGlossesOut(t *testing.T) {
	e := lexicon.Entry{Language: "zh", Kind: "character", Key: "鸡", Forms: []lexicon.Form{{Text: "鸡"}}, Senses: []lexicon.Sense{
		{Glosses: []string{"fowl", "chicken", "(slang) prostitute"}},
	}}
	r := sentences.RequestFor(e, nil, "HSK 1", true)
	if !slices.Equal(r.Glosses, []string{"fowl", "chicken"}) {
		t.Errorf("glosses %q", r.Glosses)
	}
}
