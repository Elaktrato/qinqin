package conjugation_test

import (
	"slices"
	"strings"
	"testing"

	"qinqin/internal/lemma"
)

// lemmaClass is the reader lemmatizer's word class (server/internal/lemma/
// tables/ja.json "classes") of an engine class; "" for none (な-adjectives:
// the lemmatizer has no copula rules).
func lemmaClass(class string) string {
	switch {
	case class == "v1" || class == "v1-s":
		return "v1"
	case strings.HasPrefix(class, "v5"):
		return "v5"
	case class == "vk":
		return "vk"
	case class == "vs-i" || class == "vs-s":
		return "vs"
	case class == "adj-i" || class == "adj-ix":
		return class
	}
	return ""
}

// TestFormsDeinflect is the shared rule with the reader (#165): every form
// the engine's fixture expects, written and read, lemmatizes back to its
// word through the Japanese rule table, unless the fixture lists it in
// lemmaGaps ("<word> <form>"); and every listed gap really is one, so the list stays honest.
func TestFormsDeinflect(t *testing.T) {
	fx := loadForms(t)
	table := lemma.For("ja")
	reaches := func(surface string, words []string, class string) bool {
		if slices.Contains(words, surface) {
			return true
		}
		return slices.ContainsFunc(table.Deinflect(surface), func(c lemma.Candidate) bool {
			return slices.Contains(words, c.Form) && c.Class == class
		})
	}
	gaps := map[string]bool{}
	for _, g := range fx.LemmaGaps {
		gaps[g] = true
	}
	seen := map[string]bool{}
	for _, c := range fx.Conjugate {
		class := lemmaClass(c.Class)
		if class == "" {
			continue
		}
		written := append([]string{c.Written}, c.Spellings...)
		for id, f := range c.Forms {
			for _, side := range []struct {
				surfaces, words []string
			}{{f.Written, written}, {f.Reading, []string{c.Reading}}} {
				for _, surface := range side.surfaces {
					ok := reaches(surface, side.words, class)
					key := side.words[0] + " " + surface
					switch {
					case gaps[key]:
						seen[key] = true
						if ok {
							t.Errorf("%s %s: %s lemmatizes to %v now; remove it from lemmaGaps", c.Name, id, surface, side.words)
						}
					case !ok:
						t.Errorf("%s %s: %s does not lemmatize to %v (%s); fix the table or list it in lemmaGaps", c.Name, id, surface, side.words, class)
					}
				}
			}
		}
	}
	for _, g := range fx.LemmaGaps {
		if !seen[g] {
			t.Errorf("lemmaGaps lists %s, which no case has", g)
		}
	}
}
