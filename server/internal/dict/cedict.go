package dict

import (
	"bufio"
	"fmt"
	"io"
	"log"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"qinqin/internal/pinyin"
)

// cedictFile is the data file of a format "cedict" dictionary pack: the
// CC-CEDICT line format.
const cedictFile = "dictionary.txt"

// cedictLine matches one CC-CEDICT entry line —
// traditional simplified [pinyin] /gloss/gloss/…/ — exactly.
var cedictLine = regexp.MustCompile(`^(\S+) (\S+) \[([^\]]+)\] /(.*)/$`)

// ParseCedict parses CC-CEDICT lines from r strictly. Comment lines
// (starting with #) and blank lines are skipped; any other line that
// does not match the entry shape, or matches it without a gloss, is an
// error naming its line number. Pinyin stays tone-numbered as written —
// the importer resolves it into the marked reading.
func ParseCedict(r io.Reader) ([]RawEntry, error) {
	p, err := parseCedictLenient(r)
	if err != nil {
		return nil, err
	}
	if p.skipped > 0 {
		return nil, fmt.Errorf("cedict: %s", p.firstSkip)
	}
	return p.entries, nil
}

// cedictParse is the outcome of a lenient parse: the entries read, how
// many lines were skipped as malformed, and the first skip's message.
type cedictParse struct {
	entries   []RawEntry
	skipped   int
	firstSkip string
}

// maxLoggedSkips caps how many skipped lines (or unconverted pinyin) an
// import logs; the rest are only counted.
const maxLoggedSkips = 10

// parseCedictLenient parses CC-CEDICT lines from r, skipping — and
// counting — lines that are not entry lines or carry no glosses instead
// of failing on them. Only a read error fails the parse.
func parseCedictLenient(r io.Reader) (cedictParse, error) {
	var (
		p      cedictParse
		lineNo int
	)
	skip := func(msg string) {
		if p.skipped == 0 {
			p.firstSkip = msg
		}
		p.skipped++
		if p.skipped <= maxLoggedSkips {
			log.Printf("cedict: skipping %s", msg)
		}
	}
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		lineNo++
		line := strings.TrimRight(sc.Text(), " \t")
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		m := cedictLine.FindStringSubmatch(line)
		if m == nil {
			skip(fmt.Sprintf("line %d (%q) is not an entry line", lineNo, line))
			continue
		}
		var glosses []string
		for _, g := range strings.Split(m[4], "/") {
			if g != "" {
				glosses = append(glosses, g)
			}
		}
		if len(glosses) == 0 {
			skip(fmt.Sprintf("line %d (%q) carries no glosses", lineNo, line))
			continue
		}
		p.entries = append(p.entries, RawEntry{
			Written: m[2],
			Trad:    m[1],
			Pinyin:  m[3],
			Glosses: glosses,
		})
	}
	if err := sc.Err(); err != nil {
		return cedictParse{}, fmt.Errorf("cedict: read: %w", err)
	}
	return p, nil
}

// maxSkippedShare is the largest fraction of a cedict file's entry
// lines an import skips as malformed before it concludes the file is not
// CC-CEDICT (an error page, a truncated download) and fails.
const maxSkippedShare = 0.05

// cedictStats are the operational counters of one cedict read.
type cedictStats struct {
	skipped     int // malformed lines skipped
	unconverted int // entries whose pinyin did not convert, kept as written
}

// readCedictLines reads and parses the dictionary.txt of the format
// "cedict" pack in dir and applies the malformed-line policy: lines that
// are not entries are skipped and counted, failing the read only when
// they exceed maxSkippedShare of the file or leave nothing.
func readCedictLines(dir string) (cedictParse, error) {
	f, err := openMaybeGz(filepath.Join(dir, cedictFile))
	if err != nil {
		return cedictParse{}, fmt.Errorf("%w: read %s of %s: %v", ErrInvalidPack, cedictFile, dir, err)
	}
	defer f.Close()
	p, err := parseCedictLenient(f)
	if err != nil {
		return cedictParse{}, fmt.Errorf("%w: parse %s of %s: %v", ErrInvalidPack, cedictFile, dir, err)
	}
	if len(p.entries) == 0 && p.skipped == 0 {
		return cedictParse{}, fmt.Errorf("%w: %s of %s has no entries", ErrInvalidPack, cedictFile, dir)
	}
	if p.skipped > 0 && (len(p.entries) == 0 ||
		float64(p.skipped) > maxSkippedShare*float64(p.skipped+len(p.entries))) {
		return cedictParse{}, fmt.Errorf("%w: %s of %s: %d of %d entry lines are malformed (first: %s)",
			ErrInvalidPack, cedictFile, dir, p.skipped, p.skipped+len(p.entries), p.firstSkip)
	}
	return p, nil
}

// markedPinyin returns the marked pinyin of a cedict line's tone-numbered
// pinyin. Pinyin that does not convert is kept as written and counted in
// stats.unconverted.
func markedPinyin(r RawEntry, stats *cedictStats) string {
	m, err := pinyin.ToMarked(r.Pinyin)
	if err == nil {
		return m
	}
	stats.unconverted++
	if stats.unconverted <= maxLoggedSkips {
		log.Printf("cedict: pinyin %q of %s does not convert; kept as written", r.Pinyin, r.Written)
	}
	return r.Pinyin
}

// cedictKind classifies a CC-CEDICT written form: one hanzi is a
// character entry, several hanzi a word.
func cedictKind(written string) string {
	if utf8.RuneCountInString(written) == 1 {
		return "character"
	}
	return "word"
}
