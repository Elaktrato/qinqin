package courses_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode"

	"qinqin/internal/courses"
	"qinqin/internal/grammar"
	"qinqin/internal/pack"
)

const bundled = "../../../plugins/data"

// bundledCourse is what a shipped course must be: its pack, grammar pack, level schemes and the sections that carry a
// reading text in every unit (the fully written levels; plan #223, ruling 1).
type bundledCourse struct {
	id, language, grammarPack, wordScheme, charScheme string
	charLevels                                        int
	written                                           []string
}

var bundledCourseList = []bundledCourse{
	{id: "zh-course", language: "zh", grammarPack: "zh-grammar", wordScheme: "hsk-words", charScheme: "hsk-chars", charLevels: 4,
		written: []string{"hsk1", "hsk2"}},
	{id: "ja-course", language: "ja", grammarPack: "ja-grammar", wordScheme: "jlpt-words", charScheme: "jlpt-kanji", charLevels: 3,
		written: []string{"n5", "n4"}},
}

// TestBundledCourses checks the shipped course packs without a database: each loads and passes the import check, is
// CC BY 4.0 and credits the project, names a bundled level scheme, references only lessons of the bundled grammar
// pack and every lesson of a level its section covers once, introduces only characters of the bundled character
// list, and has a reading text with an English translation in every unit of its fully written sections and none
// elsewhere. The real fill and the texts' words are checked against a seeded database (TestBundledCoursesRealFill).
func TestBundledCourses(t *testing.T) {
	for _, b := range bundledCourseList {
		t.Run(b.id, func(t *testing.T) {
			dir := filepath.Join(bundled, b.id)
			p, err := pack.LoadPack(dir)
			if err != nil {
				t.Fatal(err)
			}
			if p.Manifest.ID != b.id || p.Manifest.Language != b.language || p.Manifest.License != "CC-BY-4.0" ||
				!strings.Contains(p.Manifest.Attribution, "qinqin contributors, CC BY 4.0") ||
				!strings.Contains(strings.ToLower(p.Manifest.Attribution), "reviewed by agents") {
				t.Fatalf("manifest: %+v", p.Manifest)
			}
			for _, f := range []string{"LICENSE", "ATTRIBUTION.md", "REVIEW.md"} {
				if _, err := os.Stat(filepath.Join(dir, f)); err != nil {
					t.Error(err)
				}
			}
			_, c, err := courses.CheckPack(p)
			if err != nil {
				t.Fatal(err)
			}
			if c.Levels == nil || c.Levels.Scheme != b.wordScheme {
				t.Fatalf("levels: %+v, want the scheme %s", c.Levels, b.wordScheme)
			}
			if _, err := os.Stat(filepath.Join(bundled, b.wordScheme, "manifest.json")); err != nil {
				t.Fatalf("the scheme %s is not bundled: %v", b.wordScheme, err)
			}

			data, err := grammar.ReadData(filepath.Join(bundled, b.grammarPack))
			if err != nil {
				t.Fatal(err)
			}
			levelOf := map[string]string{}
			for _, l := range data.Lessons {
				levelOf[l.ID] = l.Level
			}
			chars := characterList(t, b.charScheme, b.charLevels)
			written := map[string]bool{}
			for _, s := range b.written {
				written[s] = true
			}
			used := map[string]int{}
			for _, s := range c.Sections {
				levels := map[string]bool{}
				for _, u := range s.Units {
					for _, g := range u.Grammar {
						packID, id, _ := strings.Cut(g, ":")
						if packID != b.grammarPack || levelOf[id] == "" {
							t.Errorf("unit %s: grammar point %s is not a lesson of %s", u.ID, g, b.grammarPack)
							continue
						}
						used[id]++
						levels[levelOf[id]] = true
					}
					for _, ch := range u.Characters {
						if !chars[ch] {
							t.Errorf("unit %s: %s is not in %s levels 1–%d", u.ID, ch, b.charScheme, b.charLevels)
						}
					}
					hasText := u.Text != nil && u.Text.Translation["en"] != ""
					if written[s.ID] != hasText {
						t.Errorf("unit %s: reading text with a translation %v, want %v", u.ID, hasText, written[s.ID])
					}
					if u.Text != nil && strings.ContainsFunc(u.Text.Body, func(r rune) bool { return r < 0x80 && unicode.IsLetter(r) }) {
						t.Errorf("unit %s: the text has Latin letters", u.ID)
					}
				}
				// A section's grammar is one level of the grammar pack, every lesson of it once.
				if len(levels) > 1 {
					t.Errorf("section %s: grammar from several levels %v", s.ID, levels)
				}
				for id, l := range levelOf {
					if levels[l] && used[id] != 1 {
						t.Errorf("section %s: lesson %s used %d times, want once", s.ID, id, used[id])
					}
				}
			}
		})
	}
}

// characterList is the set of characters of a bundled character level pack, levels 1..n.
func characterList(t *testing.T, scheme string, n int) map[string]bool {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(bundled, scheme, "levels.json"))
	if err != nil {
		t.Fatal(err)
	}
	var list struct {
		Levels []struct {
			Entries []json.RawMessage `json:"entries"`
		} `json:"levels"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, l := range list.Levels[:n] {
		for _, e := range l.Entries {
			var s string
			if json.Unmarshal(e, &s) == nil {
				out[s] = true
			}
		}
	}
	if len(out) == 0 {
		t.Fatalf("%s has no characters", scheme)
	}
	return out
}
