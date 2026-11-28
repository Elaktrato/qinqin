package topics_test

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"regexp"
	"strconv"
	"testing"

	"qinqin/internal/topics"
)

// levelList reads a bundled levels pack's levels.json (entries are {form, reading} objects or bare forms).
func levelList(t *testing.T, path string) (map[string][][2]string, []string) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Levels []struct {
			Name    string            `json:"name"`
			Entries []json.RawMessage `json:"entries"`
		} `json:"levels"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	out := map[string][][2]string{}
	var names []string
	for _, l := range doc.Levels {
		names = append(names, l.Name)
		for _, e := range l.Entries {
			var form string
			if json.Unmarshal(e, &form) == nil {
				out[l.Name] = append(out[l.Name], [2]string{form, ""})
				continue
			}
			var w struct{ Form, Reading string }
			if err := json.Unmarshal(e, &w); err != nil {
				t.Fatal(err)
			}
			out[l.Name] = append(out[l.Name], [2]string{w.Form, w.Reading})
		}
	}
	return out, names
}

// TestShippedFilesParse loads the embedded labels of both languages.
func TestShippedFilesParse(t *testing.T) {
	for _, language := range []string{"zh", "ja"} {
		f, err := topics.Load(language)
		if err != nil {
			t.Fatalf("%s: %v", language, err)
		}
		if f == nil || f.Language != language || f.HumanReviewed {
			t.Fatalf("%s: %+v", language, f)
		}
	}
	if f, err := topics.Load("es"); f != nil || err != nil {
		t.Fatalf("es: %v %v", f, err)
	}
}

// TestCoverage is the coverage report's floor on the server's own lookup rule: the share of each level's words
// of the bundled hsk-words and (once #219 has bundled it) jlpt-words lists that have a topic.
func TestCoverage(t *testing.T) {
	floors := []struct {
		language, path string
		level          *regexp.Regexp
		floor          float64
	}{
		{"zh", "../../../plugins/data/hsk-words/levels.json", regexp.MustCompile(`^HSK [123]$`), 0.9},
		{"zh", "../../../plugins/data/hsk-words/levels.json", regexp.MustCompile(`^HSK 4$`), 0.9},
		{"ja", "../../../plugins/data/jlpt-words/levels.json", regexp.MustCompile(`^≈ N[345]$`), 0.85},
	}
	for _, c := range floors {
		f, err := topics.Load(c.language)
		if err != nil {
			t.Fatal(err)
		}
		levels, names := levelList(t, c.path)
		if levels == nil {
			t.Logf("%s: not bundled on this branch, skipped", c.path)
			continue
		}
		for _, name := range names {
			if !c.level.MatchString(name) {
				continue
			}
			words, labelled := 0, 0
			for _, w := range levels[name] {
				words++
				if len(f.TopicsFor(w[0], w[1])) > 0 {
					labelled++
				}
			}
			share := float64(labelled) / float64(words)
			t.Logf("%s %s: %d of %d words (%s%%)", c.language, name, labelled, words, strconv.FormatFloat(100*share, 'f', 1, 64))
			if share < c.floor {
				t.Errorf("%s %s: %.3f of the words have a topic, want at least %.2f", c.language, name, share, c.floor)
			}
		}
	}
}
