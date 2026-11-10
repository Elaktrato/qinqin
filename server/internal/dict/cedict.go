package dict

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
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

// ParseCedict parses CC-CEDICT lines from r. Comment lines (starting
// with #) and blank lines are skipped; any other line that does not
// match the entry shape, or matches it without a gloss, is an error
// naming its line number. Pinyin stays tone-numbered as written — the
// importer resolves it into the marked reading.
func ParseCedict(r io.Reader) ([]RawEntry, error) {
	var (
		parsed []RawEntry
		lineNo int
	)
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		lineNo++
		line := strings.TrimRight(sc.Text(), " \t")
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		m := cedictLine.FindStringSubmatch(line)
		if m == nil {
			return nil, fmt.Errorf("cedict: line %d (%q) is not an entry line", lineNo, line)
		}
		var glosses []string
		for _, g := range strings.Split(m[4], "/") {
			if g != "" {
				glosses = append(glosses, g)
			}
		}
		if len(glosses) == 0 {
			return nil, fmt.Errorf("cedict: line %d (%q) carries no glosses", lineNo, line)
		}
		parsed = append(parsed, RawEntry{
			Written: m[2],
			Trad:    m[1],
			Pinyin:  m[3],
			Glosses: glosses,
		})
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("cedict: read: %w", err)
	}
	return parsed, nil
}

// readCedictPack reads and parses the dictionary.txt of the format
// "cedict" pack in dir, resolving each raw entry into the pipeline's
// entry shape: one hanzi is a character, several are a word, and the
// tone-numbered pinyin becomes the marked pinyin reading. Pinyin that
// does not convert is kept as written, leaving the bopomofo underived
// rather than failing the import — the reading pipeline never fails on
// unconvertible input.
func readCedictPack(dir string) ([]entry, error) {
	f, err := os.Open(filepath.Join(dir, cedictFile))
	if err != nil {
		return nil, fmt.Errorf("%w: read %s of %s: %v", ErrInvalidPack, cedictFile, dir, err)
	}
	defer f.Close()
	raw, err := ParseCedict(f)
	if err != nil {
		return nil, fmt.Errorf("%w: parse %s of %s: %v", ErrInvalidPack, cedictFile, dir, err)
	}
	es := make([]entry, len(raw))
	for i, r := range raw {
		marked := r.Pinyin
		if m, err := pinyin.ToMarked(r.Pinyin); err == nil {
			marked = m
		}
		es[i] = entry{
			Written:  r.Written,
			Forms:    tradForms(r.Written, r.Trad),
			Kind:     cedictKind(r.Written),
			Readings: []model.Reading{{Type: "pinyin", Value: marked}},
			Glosses:  r.Glosses,
		}
	}
	return es, nil
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
