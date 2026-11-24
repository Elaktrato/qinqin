package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"

	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/freq"
	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/lookup"
	"qinqin/internal/pack"
	"qinqin/internal/segment"
)

func init() {
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
}

// analyzer segments one language's sentences with the server's own
// tokenizer over the pack's dictionary, builds their readings and finds
// the words their groups link to.
type analyzer struct {
	code  string // zh | ja
	rules LangRules
	db    *sql.DB
	path  string
	seg   segment.Service
	lex   lexicon.Store
	dict  pack.Manifest

	mu    sync.Mutex
	links map[string]int64 // word → BestWord entry id, 0 when it does not link
}

// newAnalyzer imports the language's dictionary pack (root-relative
// rules.Dictionary) into a fresh database at dbPath.
func newAnalyzer(ctx context.Context, dbPath, code string, rules LangRules, root string) (*analyzer, error) {
	pk, err := pack.LoadPack(filepath.Join(root, rules.Dictionary))
	if err != nil {
		return nil, fmt.Errorf("dictionary of %s: %w", code, err)
	}
	if pk.Language != code {
		return nil, fmt.Errorf("dictionary %s is %s, not %s", pk.ID, pk.Language, code)
	}
	sqlDB, err := db.OpenForSeed(dbPath)
	if err != nil {
		return nil, err
	}
	if _, err := dict.ImportLexicon(ctx, sqlDB, &pk); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("import %s: %w", pk.ID, err)
	}
	return &analyzer{
		code: code, rules: rules, db: sqlDB, path: dbPath, dict: pk.Manifest,
		seg:   segment.Service{Lookup: lookup.Service{Lexicon: lexicon.Store{DB: sqlDB}, Freq: freq.Store{DB: sqlDB}, DB: sqlDB}},
		lex:   lexicon.Store{DB: sqlDB},
		links: map[string]int64{},
	}, nil
}

// close closes and deletes the temporary database.
func (a *analyzer) close() {
	a.db.Close()
	for _, suffix := range []string{"", "-wal", "-shm"} {
		os.Remove(a.path + suffix)
	}
}

// analysis is what one sentence yields.
type analysis struct {
	reading   string   // "" when a word's reading is not certain
	ambiguous []string // "word\treadings" of the words that left the reading out
	coverage  float64  // share of Han/kana code points inside matches
	words     []string // the words the sentence's groups link to, in order
	tokens    []string // every word-kind match that is not a skip word (its first try)
	unlinked  []string // the tokens that did not link
	chars     int      // matches whose best entry is a character entry
}

// analyze segments text and builds its analysis.
func (a *analyzer) analyze(ctx context.Context, text string) (analysis, error) {
	matches, err := a.seg.Segment(ctx, a.code, text)
	if err != nil {
		return analysis{}, err
	}
	var ids []int64
	for _, m := range matches {
		for _, c := range m.Entries {
			ids = append(ids, c.ID)
		}
	}
	entries, err := a.lex.GetMany(ctx, ids)
	if err != nil {
		return analysis{}, err
	}
	byID := make(map[int64]lexicon.Entry, len(entries))
	for _, e := range entries {
		byID[e.ID] = e
	}

	var (
		out      analysis
		b        readingBuilder
		reliable = true
		total    int
		covered  int
	)
	runes := []rune(text)
	counts := func(r rune) bool {
		return unicode.Is(unicode.Han, r) || (a.code == "ja" && isKana(r))
	}
	mi := 0
	for i := 0; i < len(runes); {
		if mi < len(matches) && matches[mi].Start == i {
			m := matches[mi]
			mi++
			for _, r := range runes[m.Start:m.End] {
				if counts(r) {
					total++
					covered++
				}
			}
			var rd string
			var ok bool
			if a.code == "zh" {
				rd, ok = a.zhReading(m, byID, &out)
				b.word(joinSyllables(rd))
			} else {
				rd, ok = a.jaReading(m, byID, &out)
				b.kana(rd)
			}
			reliable = reliable && ok
			w, label := a.word(ctx, m, byID)
			if w != "" && !contains(out.words, w) {
				out.words = append(out.words, w)
			}
			if label != "" {
				out.tokens = append(out.tokens, label)
				if w == "" {
					out.unlinked = append(out.unlinked, label)
				}
			}
			if len(m.Entries) > 0 && m.Entries[0].Kind == "character" {
				out.chars++
			}
			i = m.End
			continue
		}
		r := runes[i]
		i++
		if counts(r) {
			total++
		}
		if a.code == "zh" {
			reliable = b.zhRune(r) && reliable
		} else {
			reliable = b.jaRune(r) && reliable
		}
	}
	if total > 0 {
		out.coverage = float64(covered) / float64(total)
	}
	if reliable {
		out.reading = b.String()
	}
	return out, nil
}

// zhReading is the pinyin of a match: the one reading all its candidate
// entries share (case-insensitively), or the rules' default when it is
// one of them.
func (a *analyzer) zhReading(m segment.Match, byID map[int64]lexicon.Entry, out *analysis) (string, bool) {
	byLower := map[string]string{}
	for _, c := range m.Entries {
		for _, rd := range byID[c.ID].Readings {
			if rd.Type != "pinyin" || strings.TrimSpace(rd.Value) == "" {
				continue
			}
			low := strings.ToLower(rd.Value)
			if prev, ok := byLower[low]; !ok || prev != low {
				byLower[low] = rd.Value // the lower-case spelling wins: a capital marks a proper noun
			}
		}
	}
	if len(byLower) == 1 {
		for _, v := range byLower {
			return v, true
		}
	}
	if d, ok := a.rules.DefaultReadings[m.Surface]; ok {
		if v, ok := byLower[strings.ToLower(d)]; ok {
			return v, true
		}
	}
	out.ambiguous = append(out.ambiguous, m.Surface+"\t"+strings.Join(sortedKeys(byLower), " / "))
	return "", false
}

// jaReading is the kana of a match: a kana surface is its own reading; a
// surface with kanji is read from its word candidates, each form that
// shares a prefix with it giving entry reading minus the form's kana tail
// plus the surface's kana tail. It is reliable only when exactly one
// reading results and no candidate is an inflected 来る: the rules'
// default settles a listed form; otherwise, with PreferCommonReadings,
// readings without a JMdict priority mark do not count when some reading
// has one (水: みず, not the rare すい).
func (a *analyzer) jaReading(m segment.Match, byID map[int64]lexicon.Entry, out *analysis) (string, bool) {
	surface := []rune(m.Surface)
	if allKana(surface) {
		return m.Surface, true
	}
	type derived struct {
		full              string
		common, isDefault bool
	}
	var found []derived
	irregular := false
	for _, c := range m.Entries {
		e := byID[c.ID]
		if e.Kind != "word" {
			continue
		}
		for _, f := range e.Forms {
			form := []rune(f.Text)
			p := commonPrefix(surface, form)
			if p == 0 || !allKana(surface[p:]) || !allKana(form[p:]) {
				continue
			}
			formTail, surfaceTail := string(form[p:]), string(surface[p:])
			if (strings.HasSuffix(f.Text, "来る") || strings.HasSuffix(f.Text, "來る")) && f.Text != m.Surface {
				irregular = true
				continue
			}
			d, hasDefault := a.rules.DefaultReadings[f.Text]
			for _, rd := range e.Readings {
				if rd.Type != "kana" || !strings.HasSuffix(rd.Value, formTail) || len(rd.Value) == len(formTail) {
					continue
				}
				found = append(found, derived{
					full:      strings.TrimSuffix(rd.Value, formTail) + surfaceTail,
					common:    rd.Pri > 0,
					isDefault: hasDefault && rd.Value == d,
				})
			}
		}
	}
	// Readings that differ only in script (ワタシ, わたし) are one; the
	// hiragana spelling is kept.
	collect := func(keep func(derived) bool) map[string]string {
		out := map[string]string{}
		for _, d := range found {
			if !keep(d) {
				continue
			}
			key := lang.ToHiragana(d.full)
			if prev, ok := out[key]; !ok || prev != key {
				out[key] = d.full
			}
		}
		return out
	}
	all := collect(func(derived) bool { return true })
	pick := collect(func(d derived) bool { return d.isDefault })
	if len(pick) == 0 && a.rules.PreferCommonReadings {
		pick = collect(func(d derived) bool { return d.common })
	}
	if len(pick) == 0 {
		pick = all
	}
	if !irregular && len(pick) == 1 {
		for _, v := range pick {
			return v, true
		}
	}
	list := sortedKeys(all)
	if irregular {
		list = append(list, "(irregular 来る)")
	}
	out.ambiguous = append(out.ambiguous, m.Surface+"\t"+strings.Join(list, " / "))
	return "", false
}

// word is the word a match's group is filed under, or "" for none. The
// tries, all naming the match's best entry: its dictionary form (when it
// is one of the entry's forms or readings, or a deinflection), its forms
// sharing the surface's prefix, then its headword. A try listed in the
// rules' skipWords skips the match; otherwise the first try that
// BestWord — what the importer calls — resolves to one of the match's
// candidates is the word. label names the token for the report (its
// first try; "" for a character entry or a skip word).
func (a *analyzer) word(ctx context.Context, m segment.Match, byID map[int64]lexicon.Entry) (word, label string) {
	if len(m.Entries) == 0 || m.Entries[0].Kind != "word" {
		return "", ""
	}
	e := byID[m.Entries[0].ID]
	valid := map[string]bool{}
	for _, f := range e.Forms {
		valid[f.Text] = true
	}
	for _, r := range e.Readings {
		valid[r.Value] = true
	}
	// A kana token is filed only when it is a common word as written: the
	// tokenizer also matches kana runs through kana folding (りま for リマ)
	// and splits unknown runs into rare words.
	if a.code == "ja" && allKana([]rune(m.Surface)) && m.Lemma == m.Surface && (!valid[m.Surface] || e.Pri <= 0) {
		return "", ""
	}
	var tries []string
	if valid[m.Lemma] || m.Lemma != m.Surface {
		tries = append(tries, m.Lemma)
	}
	surface := []rune(m.Surface)
	for _, f := range e.Forms {
		if commonPrefix(surface, []rune(f.Text)) > 0 && !contains(tries, f.Text) {
			tries = append(tries, f.Text)
		}
	}
	if hw := e.Headword(); hw != "" && !contains(tries, hw) {
		tries = append(tries, hw)
	}
	if len(tries) == 0 {
		return "", ""
	}
	for _, w := range tries {
		if contains(a.rules.SkipWords, w) {
			return "", ""
		}
	}
	for _, w := range tries {
		id, err := a.bestWord(ctx, w)
		if err != nil || id == 0 {
			continue
		}
		for _, c := range m.Entries {
			if c.ID == id {
				return w, tries[0]
			}
		}
	}
	return "", tries[0]
}

func (a *analyzer) bestWord(ctx context.Context, w string) (int64, error) {
	a.mu.Lock()
	id, ok := a.links[w]
	a.mu.Unlock()
	if ok {
		return id, nil
	}
	e, err := a.lex.BestWord(ctx, a.code, w)
	switch {
	case errors.Is(err, lexicon.ErrNotFound):
		id = 0
	case err != nil:
		return 0, err
	default:
		id = e.ID
	}
	a.mu.Lock()
	a.links[w] = id
	a.mu.Unlock()
	return id, nil
}

// readingBuilder assembles a sentence reading from words and punctuation.
type readingBuilder struct {
	b        strings.Builder
	lastOpen bool // the last token opened a quote or bracket
	latin    bool // the last token is a run of Latin letters or digits
	quote    bool // an ASCII double quote is open
}

func (b *readingBuilder) String() string { return strings.TrimSpace(b.b.String()) }

// word appends a word, spaced from the previous one.
func (b *readingBuilder) word(w string) {
	if b.b.Len() > 0 && !b.lastOpen {
		b.b.WriteByte(' ')
	}
	b.b.WriteString(w)
	b.lastOpen, b.latin = false, false
}

func (b *readingBuilder) close(p string) {
	b.b.WriteString(p)
	b.lastOpen, b.latin = false, false
}

func (b *readingBuilder) open(p string) {
	if b.b.Len() > 0 && !b.lastOpen {
		b.b.WriteByte(' ')
	}
	b.b.WriteString(p)
	b.lastOpen, b.latin = true, false
}

// kana appends Japanese text as written: no spaces.
func (b *readingBuilder) kana(s string) { b.b.WriteString(s) }

// Chinese punctuation in pinyin text: closing marks attach to the word
// before them, opening marks to the word after.
var (
	zhClose = map[rune]string{
		'，': ",", '。': ".", '？': "?", '！': "!", '：': ":", '；': ";", '、': ",", '）': ")", '」': "”", '』': "”",
		'”': "”", '》': "”", '…': "…", '～': "~", ',': ",", '.': ".", '?': "?", '!': "!", ':': ":", ';': ";", ')': ")",
	}
	zhOpen = map[rune]string{'（': "(", '「': "“", '『': "“", '“': "“", '《': "“", '(': "("}
)

// zhRune appends a character no dictionary word covered; it reports
// false when the reading cannot be written (a Han character).
func (b *readingBuilder) zhRune(r rune) bool {
	if unicode.Is(unicode.Han, r) {
		return false
	}
	if p, ok := zhClose[r]; ok {
		b.close(p)
		return true
	}
	if p, ok := zhOpen[r]; ok {
		b.open(p)
		return true
	}
	switch {
	case r == '"':
		if b.quote {
			b.close("”")
		} else {
			b.open("“")
		}
		b.quote = !b.quote
	case unicode.IsSpace(r) || r == '·' || r == '・':
		b.latin = false
	case r < utf8.RuneSelf && (unicode.IsLetter(r) || unicode.IsDigit(r)) || unicode.Is(unicode.Latin, r) || unicode.IsDigit(r) || isFullwidthAlnum(r):
		s := norm.NFKC.String(string(r))
		if b.latin {
			b.b.WriteString(s)
		} else {
			b.word(s)
			b.latin = true
		}
	default:
		b.close(string(r))
	}
	return true
}

// jaRune appends a character no dictionary word covered: kana and
// punctuation as written; anything else (kanji, Latin, digits, whose
// reading is not certain) reports false.
func (b *readingBuilder) jaRune(r rune) bool {
	if isKana(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) || unicode.IsSpace(r) {
		b.b.WriteRune(r)
		return true
	}
	return false
}

func isFullwidthAlnum(r rune) bool {
	return (r >= '０' && r <= '９') || (r >= 'Ａ' && r <= 'Ｚ') || (r >= 'ａ' && r <= 'ｚ')
}

// isKana is hiragana, katakana, the prolonged sound mark and the
// iteration marks.
func isKana(r rune) bool {
	return unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) || r == 'ー'
}

func allKana(rs []rune) bool {
	for _, r := range rs {
		if !isKana(r) {
			return false
		}
	}
	return true
}

func commonPrefix(a, b []rune) int {
	n := 0
	for n < len(a) && n < len(b) && a[n] == b[n] {
		n++
	}
	return n
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// joinSyllables writes the space-separated syllables of one word
// together, with an apostrophe before a syllable that starts with a, o or
// e (xī ān → xī'ān), as Hanyu Pinyin orthography does.
func joinSyllables(reading string) string {
	syl := strings.Fields(reading)
	var b strings.Builder
	for i, s := range syl {
		if i > 0 {
			first, _ := utf8.DecodeRuneInString(norm.NFD.String(s))
			switch unicode.ToLower(first) {
			case 'a', 'o', 'e':
				b.WriteByte('\'')
			}
		}
		b.WriteString(s)
	}
	return b.String()
}

// sortedReview orders review lines by count, then word.
func sortedReview(counts map[string]int) []string {
	lines := make([]string, 0, len(counts))
	for k := range counts {
		lines = append(lines, k)
	}
	sort.Slice(lines, func(i, j int) bool {
		if counts[lines[i]] != counts[lines[j]] {
			return counts[lines[i]] > counts[lines[j]]
		}
		return lines[i] < lines[j]
	})
	return lines
}
