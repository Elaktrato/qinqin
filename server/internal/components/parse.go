// Package components imports character components packs (type
// "components", format "components-tsv"): for each character the parts a
// learner can see in it, from which the radical and part lookup narrows
// a character grid. A pack is shared lookup data, not per-user data.
package components

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"qinqin/internal/lexicon"
)

// Pack file names and caps. A pack file is untrusted: nothing is read
// beyond MaxComponentsBytes, and a character lists at most MaxParts parts.
const (
	ComponentsFile     = "components.tsv"
	PartsFile          = "parts.tsv"
	MaxComponentsBytes = 8 << 20
	MaxParts           = 32
	MaxStrokes         = 64
	// MaxLineBytes caps one line of either file (32 parts need under 200 bytes).
	MaxLineBytes = 4 << 10
)

// maxBytes is the cap per file; a variable so tests can lower it.
var maxBytes int64 = MaxComponentsBytes

// Data is one parsed pack. Chars maps each character to its parts in
// file order, deduplicated, never the character itself. Strokes maps a
// part to its stroke count (1–64) from parts.tsv; it is never nil.
type Data struct {
	Chars   map[string][]string
	Strokes map[string]int
}

// Parse reads components.tsv from components and, when parts is not nil,
// parts.tsv from parts.
//
// components.tsv: one character per line, `語<TAB>言 口 吾 五 二`; the
// character is one Han code point (lexicon.IsHan), each part one
// printable code point separated by spaces. Duplicate parts are kept
// once and the character itself is dropped; at least one and at most
// MaxParts parts remain. A character appears once.
//
// parts.tsv: `言<TAB>7`, one part per line, stroke count 1–64.
//
// In both, blank lines and lines starting with # are skipped, a leading
// byte order mark and trailing CR are ignored, and any malformed line is
// an error naming the file and line number.
func Parse(components io.Reader, parts io.Reader) (Data, error) {
	d := Data{Chars: map[string][]string{}, Strokes: map[string]int{}}
	err := eachLine(components, ComponentsFile, func(line string) error {
		char, list, ok := strings.Cut(line, "\t")
		if !ok {
			return errors.New("want a character, a tab and its parts")
		}
		if !lexicon.IsHan(char) {
			return fmt.Errorf("%q is not one Han character", char)
		}
		if _, dup := d.Chars[char]; dup {
			return fmt.Errorf("%s is listed twice", char)
		}
		var out []string
		seen := make(map[string]bool, MaxParts)
		for _, p := range strings.Fields(list) {
			if !onePart(p) {
				return fmt.Errorf("part %q is not one printable code point", p)
			}
			if p == char || seen[p] {
				continue
			}
			if len(out) == MaxParts {
				return fmt.Errorf("%s has more than %d parts", char, MaxParts)
			}
			seen[p] = true
			out = append(out, p)
		}
		if len(out) == 0 {
			return fmt.Errorf("%s has no parts", char)
		}
		d.Chars[char] = out
		return nil
	})
	if err != nil {
		return Data{}, err
	}
	if parts == nil {
		return d, nil
	}
	err = eachLine(parts, PartsFile, func(line string) error {
		part, num, ok := strings.Cut(line, "\t")
		if !ok {
			return errors.New("want a part, a tab and its stroke count")
		}
		if !onePart(part) {
			return fmt.Errorf("part %q is not one printable code point", part)
		}
		if _, dup := d.Strokes[part]; dup {
			return fmt.Errorf("%s is listed twice", part)
		}
		n, err := strconv.Atoi(strings.TrimSpace(num))
		if err != nil || n < 1 || n > MaxStrokes {
			return fmt.Errorf("stroke count %q is not 1–%d", num, MaxStrokes)
		}
		d.Strokes[part] = n
		return nil
	})
	if err != nil {
		return Data{}, err
	}
	return d, nil
}

// eachLine calls fn with every content line of r (name is the file name
// in errors), reading at most maxBytes.
func eachLine(r io.Reader, name string, fn func(line string) error) error {
	lr := &io.LimitedReader{R: r, N: maxBytes + 1}
	sc := bufio.NewScanner(lr)
	sc.Buffer(make([]byte, 0, MaxLineBytes), MaxLineBytes)
	n := 0
	for n = 1; sc.Scan(); n++ {
		if lr.N <= 0 {
			return fmt.Errorf("%s exceeds the %d-byte limit", name, maxBytes)
		}
		line := strings.TrimSuffix(sc.Text(), "\r")
		if n == 1 {
			line = strings.TrimPrefix(line, "\xef\xbb\xbf")
		}
		if strings.TrimSpace(line) == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if !utf8.ValidString(line) {
			return fmt.Errorf("%s line %d: invalid UTF-8", name, n)
		}
		if err := fn(line); err != nil {
			return fmt.Errorf("%s line %d: %w", name, n, err)
		}
	}
	if lr.N <= 0 {
		return fmt.Errorf("%s exceeds the %d-byte limit", name, maxBytes)
	}
	if err := sc.Err(); errors.Is(err, bufio.ErrTooLong) {
		return fmt.Errorf("%s line %d: longer than %d bytes", name, n, MaxLineBytes)
	} else if err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	return nil
}

// onePart reports whether p is one printable, non-space code point.
func onePart(p string) bool {
	r, size := utf8.DecodeRuneInString(p)
	return size == len(p) && r != utf8.RuneError && unicode.IsGraphic(r) && !unicode.IsSpace(r)
}
