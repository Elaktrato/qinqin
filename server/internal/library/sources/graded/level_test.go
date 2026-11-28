package graded_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	_ "modernc.org/sqlite"

	"qinqin/internal/dbtest"
	"qinqin/internal/freq"
	"qinqin/internal/lang"
	"qinqin/internal/lemma"
	"qinqin/internal/levels"
	"qinqin/internal/lexicon"
	"qinqin/internal/library/sources/graded"
	"qinqin/internal/lookup"
	"qinqin/internal/pack"
	"qinqin/internal/realdict"
	"qinqin/internal/segment"
)

// TestEveryTextIsAtItsLevel is the level check (docs/contracts/graded/README.md, Level rule): every graded text,
// read by the server's segmenter (#348, #349) on the shipped dictionary (CC-CEDICT, JMdict, cut down to the texts'
// windows) with the shipped word level list of its file (hsk-words, jlpt-words), has its declared level as its
// computed level, and every word above that level is glossed. It logs each text's counts and above-level words.
// QINQIN_GRADED_DUMP names a directory for each text's segmentation (for drafting and review).
func TestEveryTextIsAtItsLevel(t *testing.T) {
	files, err := graded.Files()
	if err != nil {
		t.Fatal(err)
	}
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
	for _, f := range files {
		t.Run(f.Language, func(t *testing.T) {
			sqlDB := dbtest.Open(t)
			var bodies []string
			for _, tx := range f.Texts {
				bodies = append(bodies, graded.Body(tx.Paragraphs))
			}
			realdict.Import(t, sqlDB, f.Language, windows(f.Language, bodies)...)
			p, err := pack.LoadPack(filepath.Join("..", "..", "..", "..", "..", "plugins", "data", f.Scheme))
			if err != nil {
				t.Fatal(err)
			}
			if _, err := levels.Import(context.Background(), sqlDB, p); err != nil {
				t.Fatal(err)
			}
			checkFile(t, sqlDB, f)
		})
	}
}

// TestEveryTextIsAtItsLevelSeeded is the same check on a database seeded with every bundled pack (`qinqin seed
// --packs plugins/data`), when QINQIN_GRADED_DB names its qinqin.db: the full dictionaries, the frequency pack that
// ranks Japanese candidates and the lemma rules pack. Skipped without the variable.
func TestEveryTextIsAtItsLevelSeeded(t *testing.T) {
	path := os.Getenv("QINQIN_GRADED_DB")
	if path == "" {
		t.Skip("QINQIN_GRADED_DB is not set")
	}
	sqlDB, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
	files, err := graded.Files()
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		t.Run(f.Language, func(t *testing.T) { checkFile(t, sqlDB, f) })
	}
}

// textDump is one text's reading, for QINQIN_GRADED_DUMP: each counted token marked with its level (1-based, "-"
// unlisted), function words with *, name parts with #.
type textDump struct {
	ID       string   `json:"id"`
	Level    string   `json:"level"`
	Computed string   `json:"computed"`
	Counted  int      `json:"counted"`
	Within   int      `json:"within"`
	Above    []string `json:"above"`
	Reading  []string `json:"reading"`
}

// listedForms reads the word level list of a scheme from its pack file (plugins/data/<scheme>/levels.json): each
// directly listed written form with its lowest level index. The importer keeps one membership per entry at its lowest
// level, so a Chinese character listed as a word at one level and derived at a lower one from a listed word (先 at
// HSK 3, derived at HSK 1 from 先生) has no direct membership in the database; the file still names it.
func listedForms(t *testing.T, scheme string) map[string]int {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "..", "plugins", "data", scheme, "levels.json"))
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Levels []struct {
			Entries []json.RawMessage `json:"entries"`
		} `json:"levels"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	out := map[string]int{}
	for i, l := range file.Levels {
		for _, e := range l.Entries {
			var form string
			if json.Unmarshal(e, &form) != nil {
				var obj struct {
					Form string `json:"form"`
				}
				if err := json.Unmarshal(e, &obj); err != nil {
					t.Fatal(err)
				}
				form = obj.Form
			}
			if _, ok := out[form]; !ok && form != "" {
				out[form] = i
			}
		}
	}
	return out
}

func checkFile(t *testing.T, sqlDB *sql.DB, f graded.File) {
	t.Helper()
	ctx := context.Background()
	forms := listedForms(t, f.Scheme)
	seg := segment.Service{Lookup: lookup.Service{Lexicon: lexicon.Store{DB: sqlDB}, Freq: freq.Store{DB: sqlDB}, DB: sqlDB}}
	var dumps []textDump
	perLevel := make([]int, len(f.Levels))
	for _, tx := range f.Texts {
		perLevel[tx.Level]++
		body := graded.Body(tx.Paragraphs)
		ms, err := seg.Segment(ctx, f.Language, body)
		if err != nil {
			t.Fatal(err)
		}
		var ids []int64
		for _, m := range ms {
			for _, e := range m.Entries {
				ids = append(ids, e.ID)
			}
		}
		lv, err := levels.WordLevels(ctx, sqlDB, f.Language, ids)
		if err != nil {
			t.Fatal(err)
		}
		asked := map[int64]bool{}
		for _, id := range ids {
			asked[id] = true
		}
		levelOf := func(ids []int64, texts ...string) *int {
			var out *int
			lower := func(l int) {
				if out == nil || l < *out {
					out = &l
				}
			}
			var missing []int64
			for _, id := range ids {
				if _, ok := asked[id]; !ok {
					missing = append(missing, id)
				}
			}
			if len(missing) > 0 {
				more, err := levels.WordLevels(ctx, sqlDB, f.Language, missing)
				if err != nil {
					t.Fatal(err)
				}
				for _, id := range missing {
					asked[id] = true
				}
				for id, l := range more {
					lv[id] = l
				}
			}
			for _, id := range ids {
				if l, ok := lv[id]; ok {
					lower(l)
				}
			}
			for _, form := range texts {
				if l, ok := forms[form]; ok {
					lower(l)
				}
			}
			return out
		}
		tokens := make([]graded.Token, 0, len(ms))
		for _, m := range ms {
			var cand []int64
			for _, e := range m.Entries {
				cand = append(cand, e.ID)
			}
			tokens = append(tokens, graded.Token{Start: m.Start, End: m.End, Surface: m.Surface, Lemma: m.Lemma,
				Function: m.Function, Level: levelOf(cand, m.Surface, m.Lemma)})
		}
		tokens = reread(t, sqlDB, seg.Lookup, f.Language, body, tokens, tx.Level, levelOf)
		var reading []string
		for _, tk := range tokens {
			mark := "-"
			switch {
			case tk.Function:
				mark = "*"
			case tk.Level != nil:
				mark = string(rune('0' + *tk.Level + 1))
			}
			reading = append(reading, tk.Surface+mark)
		}
		var glossed []string
		for _, g := range tx.Glosses {
			glossed = append(glossed, g.Word)
		}
		r := graded.Check(body, tx.Names, tokens, len(f.Levels), tx.Level, glossed)
		computed := "none"
		if r.ComputedLevel != nil {
			computed = f.Levels[*r.ComputedLevel]
		}
		t.Logf("%s (%s, %d characters): computed %s, %d counted, %d within (%.1f %%), above: %s", tx.ID, f.Levels[tx.Level],
			graded.Length(tx), computed, r.Counted, r.Within, 100*float64(r.Within)/float64(max(r.Counted, 1)), strings.Join(r.Above, " "))
		if !r.OK {
			t.Errorf("%s: declared %s, computed %s; unglossed above-level words: %s", tx.ID, f.Levels[tx.Level], computed, strings.Join(r.Unglossed, " "))
		}
		dumps = append(dumps, textDump{tx.ID, f.Levels[tx.Level], computed, r.Counted, r.Within, r.Above, reading})
	}
	for i, n := range perLevel {
		if n != 5 {
			t.Errorf("%s: %d texts, want five (the owner's decision)", f.Levels[i], n)
		}
	}
	if dir := os.Getenv("QINQIN_GRADED_DUMP"); dir != "" {
		out, _ := json.MarshalIndent(dumps, "", " ")
		if err := os.WriteFile(filepath.Join(dir, f.Language+".json"), out, 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// windows lists every text a lookup of texts can probe — each window prefix and, for Japanese, its deinflections
// and their compound stems — for realdict.
func windows(language string, texts []string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(s string) {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	var rules *lemma.Table
	if d, ok := lang.For(language).(lang.Deinflector); ok {
		rules = d.Rules()
	}
	for _, t := range texts {
		r := []rune(t)
		for i := range r {
			for j := i + 1; j <= len(r) && j-i <= lookup.MaxWindowRunes; j++ {
				add(string(r[i:j]))
				if rules == nil {
					continue
				}
				for _, c := range rules.Deinflect(string(r[i:j])) {
					add(c.Form)
					for _, cp := range rules.Compounds {
						if st, ok := strings.CutSuffix(c.Form, cp.Suffix); ok && st != "" {
							add(st)
						}
					}
				}
			}
		}
	}
	return out
}

// functionParts are the function words a re-read part may be without a level list entry: the common particles,
// the copula and the auxiliaries (by text or dictionary form) for Japanese, the segmenter's function words for
// Chinese. A closed list, not a part of speech: JMdict tags single kana (な, し, か) as particles, and a re-read that
// could take them anywhere would read an unlisted kana word as a string of particles.
var functionParts = map[string]map[string]bool{
	"ja": set("は が を に へ で と も の や か ね よ な わ から まで より だけ しか など って ので のに けど けれど ば て た だ" +
		" です でした だった だろう でしょう ます ました ない ぬ たい れる られる せる させる う よう ん じゃ では には とか し ぞ さ くらい ぐらい"),
	"zh": set("的 了 着 得 地 吗 呢 吧 啊 呀 嘛"),
}

func set(words string) map[string]bool {
	out := map[string]bool{}
	for _, w := range strings.Fields(words) {
		out[w] = true
	}
	return out
}

// reread reads again, with the lowest-level reading over every dictionary match, each run of adjacent tokens above
// the declared level (with a function word next to it on either side): the segmenter can split a text against its
// words (わたしも｜すし → もす｜しが, 食べに → 食｜べに) or keep an expression of known words as one unlisted entry (ですか,
// 電話をかける), and the level rule should count the words a learner reads, not the segmenter's mistakes (#223
// ruling 13). A part costs its level + 1, a function word (functionParts) nothing, an unlisted word or an unmatched
// letter 50; the cheapest reading wins, then the one with fewer parts.
func reread(t *testing.T, sqlDB *sql.DB, ls lookup.Service, language, body string, tokens []graded.Token, level int,
	levelOf func(ids []int64, texts ...string) *int) []graded.Token {
	t.Helper()
	ctx := context.Background()
	runes := []rune(body)
	bad := func(tk graded.Token) bool { return !tk.Function && (tk.Level == nil || *tk.Level > level) }
	var out []graded.Token
	for i := 0; i < len(tokens); {
		if !bad(tokens[i]) {
			out = append(out, tokens[i])
			i++
			continue
		}
		j := i + 1
		for j < len(tokens) && bad(tokens[j]) && tokens[j].Start == tokens[j-1].End {
			j++
		}
		from, to := i, j
		if len(out) > 0 && out[len(out)-1].Function && out[len(out)-1].End == tokens[i].Start {
			out = out[:len(out)-1]
			from--
		}
		if to < len(tokens) && tokens[to].Function && tokens[to].Start == tokens[to-1].End {
			to++
		}
		start, end := tokens[from].Start, tokens[to-1].End
		out = append(out, bestReading(t, ctx, ls, language, runes[start:end], start, levelOf)...)
		i = to
	}
	return out
}

// bestReading is the cheapest reading of span (at offset base of the text) over every dictionary match.
func bestReading(t *testing.T, ctx context.Context, ls lookup.Service, language string, span []rune, base int,
	levelOf func(ids []int64, texts ...string) *int) []graded.Token {
	t.Helper()
	type step struct {
		cost, parts, prev int
		tok               *graded.Token
	}
	text := string(span)
	best := make([]*step, len(span)+1)
	best[0] = &step{prev: -1}
	relax := func(from, to, cost int, tk *graded.Token) {
		c := &step{cost: best[from].cost + cost, parts: best[from].parts + 1, prev: from, tok: tk}
		if o := best[to]; o == nil || c.cost < o.cost || (c.cost == o.cost && c.parts < o.parts) {
			best[to] = c
		}
	}
	for i := range span {
		if best[i] == nil {
			continue
		}
		unmatched := &graded.Token{Start: base + i, End: base + i + 1, Surface: string(span[i]), Lemma: string(span[i])}
		relax(i, i+1, 50, unmatched)
		l := lookup.LangOf(language)
		l.Budget = lookup.NewBudget(lookup.MaxRequestWork)
		results, err := ls.LookupIn(ctx, l, text, i, nil)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range results {
			if r.End > len(span) || r.End <= i {
				continue
			}
			lemma := r.Lemma
			if lemma == "" {
				lemma = r.Matched
			}
			tk := &graded.Token{Start: base + i, End: base + r.End, Surface: r.Matched, Lemma: lemma}
			grammar := functionParts[language][r.Matched] || functionParts[language][lemma]
			cost := 50
			switch lvl := levelOf([]int64{r.EntryID}, r.Matched, lemma); {
			case grammar:
				tk.Function, cost = true, 0
			case lvl != nil:
				tk.Level, cost = lvl, *lvl+1
			}
			relax(i, r.End, cost, tk)
		}
	}
	var out []graded.Token
	for at := len(span); at > 0; at = best[at].prev {
		out = append(out, *best[at].tok)
	}
	slices.Reverse(out)
	return out
}
