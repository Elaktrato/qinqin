package starter_test

import (
	"bufio"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/pack"
	"qinqin/internal/starter"
	"qinqin/internal/topics"
)

// repoRoot is the repository root seen from this package.
var repoRoot = filepath.Join("..", "..", "..")

// TestShippedSetsResolveInTheCommittedDictionaries resolves every shipped set against the dictionaries the repository
// ships (plugins/data/cedict and plugins/data/jmdict), imported with the real importer but cut down to the entries
// that carry one of the set's forms or readings (every entry the resolver could choose between). Every word must
// resolve, to its own entry, carrying the word's form (or kana) and its reading when the set names one, and the picture
// the server would serve for that entry (the best row of the committed images mappings for its targets,
// docs/contracts/images/README.md "Resolution") must be the picture the set names, so the set never promises a
// picture the learner does not get. TestRealDictionaries does the same against a full seed when one is at hand.
func TestShippedSetsResolveInTheCommittedDictionaries(t *testing.T) {
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
	sets, err := starter.Sets()
	if err != nil {
		t.Fatal(err)
	}
	words := map[string]map[string]bool{}
	for _, s := range sets {
		if words[s.Language] == nil {
			words[s.Language] = map[string]bool{}
		}
		for _, w := range s.Words {
			words[s.Language][w.Form] = true
			if w.Reading != "" {
				words[s.Language][w.Reading] = true
			}
		}
	}
	sqlDB := dbtest.Open(t)
	ctx := context.Background()
	for _, src := range []struct{ dir, file, language string }{
		{"cedict", "dictionary.txt", "zh"},
		{"jmdict", "jmdict.xml", "ja"},
	} {
		if words[src.language] == nil {
			continue
		}
		dir := filteredPack(t, src.dir, src.file, words[src.language])
		p, err := pack.LoadPack(dir)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := dict.ImportLexicon(ctx, sqlDB, &p); err != nil {
			t.Fatalf("%s: %v", src.dir, err)
		}
	}
	store := lexicon.Store{DB: sqlDB}
	pictures := committedMappings(t)
	for _, s := range sets {
		labels, err := topics.Load(s.Language)
		if err != nil {
			t.Fatal(err)
		}
		got, err := starter.Resolve(ctx, starter.Lexicon{Store: store}, s)
		if err != nil {
			t.Fatal(err)
		}
		var unlabelled []string
		resolved := map[string]bool{}
		for _, g := range got {
			resolved[g.Word.Form+"|"+g.Word.Reading] = true
		}
		for _, w := range s.Words {
			if !resolved[w.Form+"|"+w.Reading] {
				t.Errorf("%s: %s %s does not resolve, or takes an entry an earlier word took", s.ID, w.Form, w.Reading)
			}
		}
		for _, g := range got {
			e, err := store.Get(ctx, g.EntryID)
			if err != nil {
				t.Fatal(err)
			}
			w := g.Word
			if !carries(e, w.Form, "") {
				t.Errorf("%s: %s resolves to %s, which does not carry the form", s.ID, w.Form, e.Key)
			}
			if w.Reading != "" && !carries(e, "", w.Reading) {
				t.Errorf("%s: %s resolves to %s, which does not have the reading %s", s.ID, w.Form, e.Key, w.Reading)
			}
			if w.Picture.Target != "" && w.Picture.Target != e.Key {
				t.Errorf("%s: %s resolves to %s, but its picture is mapped to %s", s.ID, w.Form, e.Key, w.Picture.Target)
			}
			served, ok := pictures.best(s.Language, pictureTargets(e))
			switch {
			case !ok:
				t.Errorf("%s: %s (%s): no images mapping gives it a picture", s.ID, w.Form, e.Key)
			case served.pack != w.Picture.Pack || served.concept != w.Picture.Concept:
				t.Errorf("%s: %s (%s): the server serves %s/%s (score %d, %s), the set names %s/%s",
					s.ID, w.Form, e.Key, served.pack, served.concept, served.score, served.note, w.Picture.Pack, w.Picture.Concept)
			}
			var themes []string
			if labels != nil {
				for _, l := range labels.Labels {
					if l.Key == e.Key {
						themes = append(themes, l.Topics...)
					}
				}
			}
			if len(themes) == 0 {
				unlabelled = append(unlabelled, w.Form)
			}
			gloss := ""
			if len(e.Senses) > 0 && len(e.Senses[0].Glosses) > 0 {
				gloss = e.Senses[0].Glosses[0]
			}
			t.Logf("%s\t%s\t%s\t%s\tgloss=%q\twant=%q\tpicture=%s\ttopics=%s", s.ID, w.Form, w.Reading, e.Key, gloss, w.Gloss, w.Picture.Concept, strings.Join(slices.Compact(themes), ","))
		}
		// Section 0 of a course is the Starter set itself, so a word needs no topic to be placed; the words the
		// topic labels (#220) do not cover yet are reported for the people who extend them.
		if len(unlabelled) > 0 {
			t.Logf("%s: %d words without a topic label: %s", s.ID, len(unlabelled), strings.Join(unlabelled, " "))
		}
	}
}

// carries says whether e has form as a written form (or, for a kana form, as a kana reading) and reading as a
// reading; an empty argument is not checked.
func carries(e *lexicon.Entry, form, reading string) bool {
	if form != "" {
		has := e.Key == form
		for _, f := range e.Forms {
			has = has || f.Text == form
		}
		for _, r := range e.Readings {
			has = has || (r.Type == "kana" && r.Value == form)
		}
		if !has {
			return false
		}
	}
	if reading != "" {
		for _, r := range e.Readings {
			if r.Value == reading && (r.Type == "kana" || r.Type == "pinyin") {
				return true
			}
		}
		return false
	}
	return true
}

// pictureTargets are the strings the server looks an entry's picture up by (api.pictureTargets): the key, the
// written forms, and the kana readings when the entry has no written form.
func pictureTargets(e *lexicon.Entry) []string {
	targets := []string{e.Key}
	for _, f := range e.Forms {
		targets = append(targets, f.Text)
	}
	if len(e.Forms) == 0 {
		for _, r := range e.Readings {
			if r.Type == "kana" {
				targets = append(targets, r.Value)
			}
		}
	}
	return targets
}

type mapping struct {
	pack, language, target, concept, note string
	sense, score                          int
}

type mappings []mapping

// best is the server's choice among the mappings of any target (images.Resolve without a sense): the higher score,
// then the lower sense, the pack id and the concept.
func (ms mappings) best(language string, targets []string) (mapping, bool) {
	var cands []mapping
	for _, m := range ms {
		if m.language == language && slices.Contains(targets, m.target) {
			cands = append(cands, m)
		}
	}
	if len(cands) == 0 {
		return mapping{}, false
	}
	sort.Slice(cands, func(i, j int) bool {
		a, b := cands[i], cands[j]
		if a.score != b.score {
			return a.score > b.score
		}
		if a.sense != b.sense {
			return a.sense < b.sense
		}
		if a.pack != b.pack {
			return a.pack < b.pack
		}
		return a.concept < b.concept
	})
	return cands[0], true
}

// committedMappings reads every committed images mapping, scripts/images/<pack>/map.tsv (pack id images-<pack>).
func committedMappings(t *testing.T) mappings {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(repoRoot, "scripts", "images", "*", "map.tsv"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no committed images mappings (%v)", err)
	}
	var out mappings
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		packID := "images-" + filepath.Base(filepath.Dir(f))
		for i, line := range strings.Split(string(raw), "\n") {
			c := strings.Split(line, "\t")
			if i == 0 || len(c) < 7 {
				continue
			}
			sense, err1 := strconv.Atoi(c[2])
			score, err2 := strconv.Atoi(c[4])
			if err1 != nil || err2 != nil {
				t.Fatalf("%s line %d: %q", f, i+1, line)
			}
			out = append(out, mapping{packID, c[0], c[1], c[3], c[6], sense, score})
		}
	}
	return out
}

var (
	cedictLine = regexp.MustCompile(`^\S+ (\S+) \[`)
	jmdictText = regexp.MustCompile(`<(?:keb|reb)>([^<]+)</(?:keb|reb)>`)
)

// filteredPack writes a copy of the committed dictionary pack plugins/data/<dir> that keeps only the entries with one
// of the strings in keep (CC-CEDICT: the simplified form; JMdict: a written form or a kana reading), and returns its
// directory. The manifest is the committed one.
func filteredPack(t *testing.T, dir, file string, keep map[string]bool) string {
	t.Helper()
	src := filepath.Join(repoRoot, "plugins", "data", dir)
	manifest, err := os.ReadFile(filepath.Join(src, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(filepath.Join(src, file+".gz"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	switch file {
	case "dictionary.txt":
		err = filterLines(zr, func(line string) bool {
			if strings.HasPrefix(line, "#") {
				return true
			}
			m := cedictLine.FindStringSubmatch(line)
			return m != nil && keep[m[1]]
		}, &out)
	default:
		err = filterJMdict(zr, keep, &out)
	}
	if err != nil {
		t.Fatalf("%s: %v", dir, err)
	}
	outDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(outDir, "manifest.json"), manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outDir, file), []byte(out.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	return outDir
}

func filterLines(r io.Reader, keep func(string) bool, out *strings.Builder) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		if line := sc.Text(); keep(line) {
			out.WriteString(line + "\n")
		}
	}
	return sc.Err()
}

// filterJMdict keeps JMdict's header (with the entity declarations), the entries that carry one of keep, and the
// closing tag. JMdict writes one element per line, an entry from <entry> to </entry>.
func filterJMdict(r io.Reader, keep map[string]bool, out *strings.Builder) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	var entry []string
	inEntry, kept, entries := false, false, 0
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "<entry>"):
			inEntry, kept, entry = true, false, entry[:0]
			entry = append(entry, line)
		case inEntry:
			entry = append(entry, line)
			if m := jmdictText.FindStringSubmatch(line); m != nil && keep[m[1]] {
				kept = true
			}
			if strings.HasPrefix(line, "</entry>") {
				inEntry = false
				if kept {
					entries++
					out.WriteString(strings.Join(entry, "\n") + "\n")
				}
			}
		default:
			out.WriteString(line + "\n")
		}
	}
	if err := sc.Err(); err != nil {
		return err
	}
	if entries == 0 {
		return fmt.Errorf("no JMdict entry kept")
	}
	return nil
}
