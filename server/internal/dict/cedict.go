package dict

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"qinqin/internal/entries"
	"qinqin/internal/model"
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

// readCedictPack reads and parses the dictionary.txt of the format
// "cedict" pack in dir, resolving each raw entry into the pipeline's
// entry shape: one hanzi is a character, several are a word, and the
// tone-numbered pinyin becomes the marked pinyin reading. Malformed
// lines are skipped and counted (failing only when they exceed
// maxSkippedShare of the file or leave nothing). Pinyin that does not
// convert is kept as written and counted, leaving the bopomofo
// underived rather than failing the import — the reading pipeline never
// fails on unconvertible input. Homograph lines for one written form
// each upsert in file order: senses accumulate across them, and the
// entry keeps the last line's reading.
func readCedictPack(dir string) ([]entry, cedictStats, error) {
	f, err := os.Open(filepath.Join(dir, cedictFile))
	if err != nil {
		return nil, cedictStats{}, fmt.Errorf("%w: read %s of %s: %v", ErrInvalidPack, cedictFile, dir, err)
	}
	defer f.Close()
	p, err := parseCedictLenient(f)
	if err != nil {
		return nil, cedictStats{}, fmt.Errorf("%w: parse %s of %s: %v", ErrInvalidPack, cedictFile, dir, err)
	}
	if p.skipped > 0 && (len(p.entries) == 0 ||
		float64(p.skipped) > maxSkippedShare*float64(p.skipped+len(p.entries))) {
		return nil, cedictStats{}, fmt.Errorf("%w: %s of %s: %d of %d entry lines are malformed (first: %s)",
			ErrInvalidPack, cedictFile, dir, p.skipped, p.skipped+len(p.entries), p.firstSkip)
	}
	stats := cedictStats{skipped: p.skipped}
	es := make([]entry, len(p.entries))
	for i, r := range p.entries {
		marked := r.Pinyin
		if m, err := pinyin.ToMarked(r.Pinyin); err == nil {
			marked = m
		} else {
			stats.unconverted++
			if stats.unconverted <= maxLoggedSkips {
				log.Printf("cedict: pinyin %q of %s does not convert; kept as written", r.Pinyin, r.Written)
			}
		}
		es[i] = entry{
			Written:  r.Written,
			Forms:    tradForms(r.Written, r.Trad),
			Kind:     cedictKind(r.Written),
			Readings: []model.Reading{{Type: "pinyin", Value: marked}},
			Glosses:  r.Glosses,
		}
	}
	return es, stats, nil
}

// cedictKind classifies a CC-CEDICT written form: one hanzi is a
// character entry, several hanzi a word.
func cedictKind(written string) string {
	if utf8.RuneCountInString(written) == 1 {
		return "character"
	}
	return "word"
}

// linkWordChars links the word entry wordID to a character entry for
// every distinct Han character in written, upserting a bare character
// entry when the dictionary has not supplied one. Linking is
// idempotent — (word, char) is the link's key — so several words may
// share a character and a re-import relinks rather than duplicates.
func linkWordChars(ctx context.Context, store entries.Store, language, written string, wordID int64) error {
	seen := make(map[rune]bool)
	for _, r := range written {
		if !unicode.Is(unicode.Han, r) || seen[r] {
			continue
		}
		seen[r] = true
		charID, err := charEntry(ctx, store, language, string(r))
		if err != nil {
			return err
		}
		if err := store.LinkWordChar(ctx, wordID, charID); err != nil {
			return err
		}
	}
	return nil
}

// charEntry returns the id of the character entry for hanzi in
// language, upserting a bare one — kind character, no readings, no
// senses — when it is absent. An existing entry, however it got there,
// is linked to as-is, so its readings and senses survive.
func charEntry(ctx context.Context, store entries.Store, language, hanzi string) (int64, error) {
	e, err := store.GetByWritten(ctx, hanzi, "character", language)
	if err == nil {
		return e.ID, nil
	}
	if !errors.Is(err, entries.ErrNotFound) {
		return 0, err
	}
	return store.Upsert(ctx, &model.Entry{
		Language: language,
		Kind:     "character",
		Written:  hanzi,
	})
}
