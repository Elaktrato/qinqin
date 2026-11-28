package courses

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"unicode"

	_ "modernc.org/sqlite"

	"qinqin/internal/freq"
	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/lookup"
	"qinqin/internal/segment"
)

// bundledCourses are the shipped course packs (plugins/data).
var bundledCourses = []string{"zh-course", "ja-course"}

// maxNewWords is how many words a unit's reading text may have that the learner has not reached by then: words the
// segmenter finds whose entry is not among the words of this unit and the units before it (plan #223, ruling 12).
const maxNewWords = 4

// grammarPOS are the parts of speech (first sense, JMdict tags) of the grammar words a text may use without the level
// list: particles, the copula and auxiliaries, which the grammar lessons teach (plan #223, ruling 12).
var grammarPOS = map[string]bool{"prt": true, "cop": true, "aux": true, "aux-v": true, "aux-adj": true}

// TestBundledCoursesRealFill fills the shipped courses from a database seeded with the bundled packs
// (`qinqin seed --packs plugins/data`), when QINQIN_COURSE_DB names its qinqin.db, and checks that the fill places
// the words, that every grammar point is installed, and that every reading text stays within the words reached by
// its unit (at most maxNewWords others, which the reading lesson shows with a reading and a gloss). It logs the
// counts per section and each text's new words. QINQIN_COURSE_PACKS overrides the packs' root (a draft) and
// QINQIN_COURSE_DUMP names a directory for the filled courses and the texts' segmentation (for review). Skipped
// without the variable: the dictionaries and level lists are not in the test's reach otherwise.
func TestBundledCoursesRealFill(t *testing.T) {
	path := os.Getenv("QINQIN_COURSE_DB")
	if path == "" {
		t.Skip("QINQIN_COURSE_DB is not set")
	}
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
	root := os.Getenv("QINQIN_COURSE_PACKS")
	if root == "" {
		root = filepath.Join("..", "..", "..", "plugins", "data")
	}
	dump := os.Getenv("QINQIN_COURSE_DUMP")
	ctx := context.Background()
	seg := segment.Service{Lookup: lookup.Service{Lexicon: lexicon.Store{DB: db}, Freq: freq.Store{DB: db}, DB: db}, WithReadings: true}
	for _, id := range bundledCourses {
		t.Run(id, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(root, id, DataFile))
			if err != nil {
				t.Fatal(err)
			}
			c, err := Parse(raw)
			if err != nil {
				t.Fatal(err)
			}
			g, err := gather(ctx, db, Pack{}, c)
			if err != nil {
				t.Fatal(err)
			}
			if g.in.Levels == nil {
				t.Fatalf("the level scheme %s is not installed", c.Levels.Scheme)
			}
			f := Fill(c, g.in)
			t.Logf("%s: %d candidates, %d placed (%d by topic), %d unplaced", id, f.Counts.Candidates, f.Counts.Placed, f.Counts.ByTopic, f.Counts.Unplaced)
			unplacedBy := map[int]int{}
			for _, u := range f.Unplaced {
				unplacedBy[u.Level]++
			}
			for _, s := range f.Sections {
				if s.Level == nil {
					continue
				}
				n, smallest, largest := 0, -1, 0
				for _, u := range s.Units {
					n += len(u.Words)
					if smallest < 0 || len(u.Words) < smallest {
						smallest = len(u.Words)
					}
					largest = max(largest, len(u.Words))
				}
				t.Logf("  %s (%s): %d units, %d placed, %d unplaced, %d–%d words a unit", s.ID, *s.LevelName, len(s.Units), n, unplacedBy[*s.Level], smallest, largest)
			}
			// The words of a level all have a unit: a few unplaced (a character introduced late) are a skeleton bug.
			if f.Counts.Unplaced > 0 {
				forms := []string{}
				for _, u := range f.Unplaced {
					forms = append(forms, u.Form)
				}
				t.Errorf("%d words unplaced: %s", f.Counts.Unplaced, strings.Join(forms, " "))
			}
			for _, s := range f.Sections {
				for _, u := range s.Units {
					for _, l := range u.Lessons {
						if l.Kind == KindGrammar && !l.Available {
							t.Errorf("unit %s: grammar point %s is not installed", u.ID, l.Point)
						}
					}
				}
			}
			report := checkTexts(ctx, t, seg, c.Language, f)
			if dump != "" {
				out, _ := json.MarshalIndent(map[string]any{"filled": f, "texts": report}, "", " ")
				if err := os.WriteFile(filepath.Join(dump, id+".json"), out, 0o644); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

// textReport is one reading text checked against the words reached by its unit.
type textReport struct {
	Unit    string `json:"unit"`
	Reached int    `json:"reached"`
	// Reading is the text read with the fewest new words (plan #223, ruling 12): each token a dictionary
	// match, marked * when new, + when a grammar word.
	Reading []string `json:"reading"`
	New     []string `json:"new"`
	// Reader is the reading lesson's own segmentation (the server's segmenter); Shown its tokens that get a reading
	// because their entry is not a reached word's: what the learner sees marked.
	Reader []string `json:"reader"`
	Shown  []string `json:"shown"`
}

// checkTexts checks each unit's text against the words the learner has reached by the end of the unit (the words of
// this unit and every unit before it): read with the fewest new words, using every dictionary match at every position
// (the greedy segmenter of the reading lesson can split a text against its words), at most maxNewWords new words. A
// match is known when its entry is a reached word, or its text, dictionary form or compound stem is a reached word's
// form (another entry of the same word), or it is a grammar word (grammarPOS). It also records the reading lesson's
// own segmentation, for review.
func checkTexts(ctx context.Context, t *testing.T, seg segment.Service, language string, f Filled) []textReport {
	t.Helper()
	reached := map[int64]bool{}
	forms := map[string]bool{}
	var out []textReport
	for _, s := range f.Sections {
		for _, u := range s.Units {
			for _, w := range u.Words {
				reached[w.EntryID] = true
				forms[w.Form] = true
			}
			if u.Text == nil {
				continue
			}
			r := textReport{Unit: u.ID, Reached: len(reached)}
			r.Reading, r.New = bestReading(ctx, t, seg.Lookup, language, u.Text.Body, reached, forms)
			matches, err := seg.Segment(ctx, language, u.Text.Body)
			if err != nil {
				t.Fatal(err)
			}
			for _, m := range matches {
				if len(m.Entries) == 0 {
					continue
				}
				if reached[m.Entries[0].ID] {
					r.Reader = append(r.Reader, m.Surface)
					continue
				}
				r.Reader = append(r.Reader, m.Surface+"*")
				r.Shown = append(r.Shown, m.Surface)
			}
			t.Logf("  text %s: %d new: %s (the reading lesson marks %d: %s)", u.ID, len(r.New), strings.Join(r.New, ", "), len(r.Shown), strings.Join(r.Shown, " "))
			if len(r.New) > maxNewWords {
				t.Errorf("unit %s: the text has %d new words, at most %d: %s", u.ID, len(r.New), maxNewWords, strings.Join(r.New, ", "))
			}
			out = append(out, r)
		}
	}
	return out
}

// bestReading reads text with the fewest new words (then the fewest tokens) over every dictionary match at every
// position, and returns its tokens and its distinct new words.
func bestReading(ctx context.Context, t *testing.T, ls lookup.Service, language, text string, reached map[int64]bool, forms map[string]bool) ([]string, []string) {
	t.Helper()
	type step struct {
		cost, tokens, prev int
		token, mark        string
		entry              int64
	}
	runes := []rune(text)
	best := make([]*step, len(runes)+1)
	best[0] = &step{prev: -1}
	relax := func(to int, from int, add int, token, mark string, entry int64) {
		b := best[from]
		c := &step{cost: b.cost + add, tokens: b.tokens, prev: from, token: token, mark: mark, entry: entry}
		if token != "" {
			c.tokens++
		}
		if o := best[to]; o == nil || c.cost < o.cost || (c.cost == o.cost && c.tokens < o.tokens) {
			best[to] = c
		}
	}
	for i := range runes {
		if best[i] == nil {
			continue
		}
		if !unicode.IsLetter(runes[i]) {
			relax(i+1, i, 0, "", "", 0)
			continue
		}
		l := lookup.LangOf(language)
		l.Budget = lookup.NewBudget(lookup.MaxRequestWork)
		results, err := ls.LookupIn(ctx, l, text, i, nil)
		if err != nil {
			t.Fatal(err)
		}
		relax(i+1, i, 1, string(runes[i]), "*", -1)
		for _, res := range results {
			switch {
			case reached[res.EntryID] || forms[res.Matched] || forms[res.Lemma] || (res.Stem != "" && forms[res.Stem]):
				relax(res.End, i, 0, res.Matched, "", res.EntryID)
			case len(res.Senses) > 0 && slices.ContainsFunc(res.Senses[0].POS, func(p string) bool { return grammarPOS[p] }):
				relax(res.End, i, 0, res.Matched, "+", res.EntryID)
			default:
				relax(res.End, i, 1, res.Matched, "*", res.EntryID)
			}
		}
	}
	var tokens, news []string
	seen := map[string]bool{}
	for at := len(runes); at > 0; at = best[at].prev {
		st := best[at]
		if st.token == "" {
			continue
		}
		tokens = append(tokens, st.token+st.mark)
		key := st.token
		if st.entry > 0 {
			key = fmt.Sprint(st.entry)
		}
		if st.mark == "*" && !seen[key] {
			seen[key] = true
			news = append(news, st.token)
		}
	}
	slices.Reverse(tokens)
	slices.Reverse(news)
	return tokens, news
}
