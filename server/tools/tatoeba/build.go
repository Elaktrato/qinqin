package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// buildConfig is one build run.
type buildConfig struct {
	Root       string // repository root; the rules' dictionary paths are relative to it
	ExportDir  string // the downloaded, verified archives
	Pin        Pin
	Rules      Rules
	OutDir     string // where the packs go (plugins/data)
	ReportDir  string // where the report, review list and sample go
	Langs      []string
	Workers    int
	MaxPerWord int // overrides Rules.MaxPerWord when > 0
	Log        io.Writer
}

// langResult is everything one language's build produced, for the pack
// files and the report.
type langResult struct {
	code     string
	rules    LangRules
	dict     string // name and version of the dictionary used
	read     int
	drops    *counter
	filtered int // kept by the text filters
	groups   []group
	bundled  []*candidate // every sentence in some group, by id
	review   map[string]int
	seen     map[string]bool // word-kind tokens of kept sentences
	unlinked map[string]int  // tokens that did not link, with counts
	chars    int             // matches of character entries (never linked)
}

type group struct {
	word      string
	sentences []*candidate
}

// build filters the pinned export into one sentences pack per language.
func build(ctx context.Context, cfg buildConfig) error {
	if err := cfg.Pin.requirePinned(); err != nil {
		return err
	}
	for _, a := range cfg.Pin.Archives {
		if err := a.verify(cfg.ExportDir); err != nil {
			return err
		}
	}
	if cfg.Workers < 1 {
		cfg.Workers = 1
	}
	if cfg.MaxPerWord > 0 {
		cfg.Rules.MaxPerWord = cfg.MaxPerWord
	}
	var codes []string
	for _, code := range cfg.Langs {
		l, ok := cfg.Rules.Languages[code]
		if !ok {
			return fmt.Errorf("rules have no language %q", code)
		}
		codes = append(codes, l.Tatoeba)
	}
	fmt.Fprintf(cfg.Log, "reading the export in %s\n", cfg.ExportDir)
	ex, err := loadExport(cfg.ExportDir, cfg.Pin, codes, cfg.Rules.TranslationLanguage)
	if err != nil {
		return err
	}
	for _, code := range cfg.Langs {
		res, err := buildLanguage(ctx, cfg, ex, code)
		if err != nil {
			return fmt.Errorf("%s: %w", code, err)
		}
		dir, err := writePack(cfg, res)
		if err != nil {
			return fmt.Errorf("%s: %w", code, err)
		}
		if err := writeReports(cfg, res, dir); err != nil {
			return fmt.Errorf("%s: %w", code, err)
		}
		fmt.Fprintf(cfg.Log, "%s: %d sentences in %d word groups -> %s (report in %s)\n",
			res.rules.PackID, len(res.bundled), len(res.groups), dir, filepath.Join(cfg.ReportDir, "report-"+code+".txt"))
	}
	return nil
}

func buildLanguage(ctx context.Context, cfg buildConfig, ex *export, code string) (*langResult, error) {
	lr := cfg.Rules.Languages[code]
	tmp, err := os.MkdirTemp("", "tatoeba-dict-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	fmt.Fprintf(cfg.Log, "%s: loading %s\n", code, lr.Dictionary)
	a, err := newAnalyzer(ctx, filepath.Join(tmp, "dict.db"), code, lr, cfg.Root)
	if err != nil {
		return nil, err
	}
	defer a.close()

	kept, read, drops := filterLanguage(ex, cfg.Rules, lr)
	res := &langResult{
		code: code, rules: lr, dict: a.dict.Name + " " + a.dict.Version, read: read, drops: drops, filtered: len(kept),
		review: map[string]int{}, seen: map[string]bool{}, unlinked: map[string]int{},
	}

	// Analyze in parallel; results land by index, so the order of the
	// workers never shows in the output.
	fmt.Fprintf(cfg.Log, "%s: segmenting %d sentences\n", code, len(kept))
	results := make([]analysis, len(kept))
	errs := make([]error, len(kept))
	var wg sync.WaitGroup
	next := make(chan int)
	for w := 0; w < cfg.Workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range next {
				results[i], errs[i] = a.analyze(ctx, kept[i].s.Text)
			}
		}()
	}
	for i := range kept {
		next <- i
	}
	close(next)
	wg.Wait()

	drops.add(stepCoverage, 0)
	drops.add(stepNoWord, 0)
	byWord := map[string][]*candidate{}
	for i, c := range kept {
		if errs[i] != nil {
			return nil, fmt.Errorf("sentence %d: %w", c.s.ID, errs[i])
		}
		an := results[i]
		for _, w := range an.unlinked {
			res.unlinked[w]++
		}
		for _, w := range an.tokens {
			res.seen[w] = true
		}
		res.chars += an.chars
		if an.coverage < lr.MinCoverage || an.coverage == 0 {
			drops.add(stepCoverage, 1)
			continue
		}
		if len(an.words) == 0 {
			drops.add(stepNoWord, 1)
			continue
		}
		for _, line := range an.ambiguous {
			res.review[line]++
		}
		c.reading, c.words = an.reading, an.words
		for _, w := range an.words {
			byWord[w] = append(byWord[w], c)
		}
	}

	inPack := map[int64]*candidate{}
	for _, w := range sortedKeys(byWord) {
		list := byWord[w]
		sortCandidates(list)
		if len(list) > cfg.Rules.MaxPerWord {
			list = list[:cfg.Rules.MaxPerWord]
		}
		res.groups = append(res.groups, group{word: w, sentences: list})
		for _, c := range list {
			inPack[c.s.ID] = c
		}
	}
	for _, c := range inPack {
		res.bundled = append(res.bundled, c)
	}
	sort.Slice(res.bundled, func(i, j int) bool { return res.bundled[i].s.ID < res.bundled[j].s.ID })
	if err := checkCredits(res.bundled); err != nil {
		return nil, err
	}
	return res, nil
}

// checkCredits refuses a bundled CC BY sentence or translation without an
// owner: CC BY needs the author credited, and credits.tsv would be empty.
func checkCredits(bundled []*candidate) error {
	for _, c := range bundled {
		for _, s := range []*sentence{c.s, c.tr} {
			if s.Licence == licenceBY && strings.TrimSpace(s.Owner) == "" {
				return fmt.Errorf("sentence %d is CC BY 2.0 FR but has no owner to credit; it must not be bundled", s.ID)
			}
		}
	}
	return nil
}
