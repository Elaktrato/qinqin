package dict

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"qinqin/internal/pack"
)

// unihanFile is the data file of a format "unihan" dictionary pack: the
// Unicode Unihan database's line format.
const unihanFile = "dictionary.txt"

// unihanZipFile is the upstream distribution of the Unihan database. The
// members below carry every field the importer parses: kRSUnicode and
// kTotalStrokes live in the IRG sources file (not the Adobe radical-stroke
// file, which carries a different field), variants in the variants file,
// and kDefinition and kTGHZ2013 in the readings file — these three are
// required. kGB0 lives in the other-mappings file and kGradeLevel in the
// dictionary-like-data file; an older archive without them still imports,
// just without those attrs.
const unihanZipFile = "Unihan.zip"

var (
	unihanZipMembers = []string{
		"Unihan_IRGSources.txt",
		"Unihan_Variants.txt",
		"Unihan_Readings.txt",
	}
	unihanZipOptionalMembers = []string{
		"Unihan_OtherMappings.txt",
		"Unihan_DictionaryLikeData.txt",
	}
)

// The built-in dictionary a unihan import registers. The Unihan database
// is one canonical dataset, whatever pack delivered the file, so its row
// is keyed "unihan"; the license and attribution come from the pack's
// manifest so the registry always reflects the bundled source's real
// terms — re-importing any unihan pack replaces the built-in's senses.
const unihanPackID = "unihan"

// UnihanData is what ParseUnihan extracts from a Unihan database file:
// the fields the importer consumes, keyed by character.
type UnihanData struct {
	Radicals     map[string]int      // kRSUnicode: character -> Kangxi radical number, left of the "."
	TradVariants map[string][]string // kTraditionalVariant: character -> its traditional variants
	SimpVariants map[string][]string // kSimplifiedVariant: character -> its simplified variants
	Definitions  map[string]string   // kDefinition: character -> its English definition
	// Attrs holds each character's level and stroke attrs (see
	// unihanAttrKeys): kTotalStrokes, kTGHZ2013, kGB0 and kGradeLevel.
	Attrs map[string]map[string]string
}

// ParseUnihan parses Unihan database lines from r: each data line is a
// tab-separated triple of a U+XXXX codepoint, a field name, and the
// field's value. Comment lines (starting with #) and blank lines are
// skipped, and fields the importer does not consume are ignored — a real
// Unihan file carries dozens more. Any other line that does not match the
// triple shape, or whose value is malformed, is an error naming its line
// number. Codepoints decode to characters; variant values are the
// database's space-separated U+XXXX codepoints, with a bare character
// accepted as the same thing spelled out.
func ParseUnihan(r io.Reader) (UnihanData, error) {
	data := UnihanData{
		Radicals:     map[string]int{},
		TradVariants: map[string][]string{},
		SimpVariants: map[string][]string{},
		Definitions:  map[string]string{},
		Attrs:        map[string]map[string]string{},
	}
	var lineNo int
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		lineNo++
		line := strings.TrimRight(sc.Text(), " \t\r")
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "\t", 3)
		if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
			return UnihanData{}, fmt.Errorf("unihan: line %d (%q) is not a data line", lineNo, line)
		}
		ch, err := unihanChar(parts[0])
		if err != nil {
			return UnihanData{}, fmt.Errorf("unihan: line %d: %w", lineNo, err)
		}
		switch parts[1] {
		case "kRSUnicode":
			data.Radicals[ch], err = parseRadicalCount(parts[2])
		case "kTraditionalVariant":
			data.TradVariants[ch], err = parseVariants(parts[2])
		case "kSimplifiedVariant":
			data.SimpVariants[ch], err = parseVariants(parts[2])
		case "kDefinition":
			data.Definitions[ch], err = parseDefinition(parts[2])
		case "kTotalStrokes", "kTGHZ2013", "kGB0", "kGradeLevel":
			var key, value string
			if key, value, err = parseUnihanAttr(parts[1], parts[2]); err == nil && key != "" {
				if data.Attrs[ch] == nil {
					data.Attrs[ch] = map[string]string{}
				}
				data.Attrs[ch][key] = value
			}
		}
		if err != nil {
			return UnihanData{}, fmt.Errorf("unihan: line %d (%q): %w", lineNo, line, err)
		}
	}
	if err := sc.Err(); err != nil {
		return UnihanData{}, fmt.Errorf("unihan: read: %w", err)
	}
	return data, nil
}

// unihanChar decodes a U+XXXX line key to its character.
func unihanChar(key string) (string, error) {
	if !strings.HasPrefix(key, "U+") {
		return "", fmt.Errorf("key %q is not a U+ codepoint", key)
	}
	cp, err := strconv.ParseUint(strings.TrimPrefix(key, "U+"), 16, 32)
	if err != nil || cp > utf8.MaxRune || (cp >= 0xD800 && cp <= 0xDFFF) {
		return "", fmt.Errorf("key %q is not a character codepoint", key)
	}
	return string(rune(cp)), nil
}

// parseRadicalCount reads a kRSUnicode value: a radical number, a dot,
// and the residual stroke count — the first of possibly several
// space-separated counts. The number may carry apostrophes marking a
// simplified form of the radical (86' is still radical 86); only the
// number, left of the dot, is used.
func parseRadicalCount(value string) (int, error) {
	counts := strings.Fields(value)
	if len(counts) == 0 {
		return 0, fmt.Errorf("kRSUnicode value %q carries no radical count", value)
	}
	left, _, _ := strings.Cut(counts[0], ".")
	n, err := strconv.Atoi(strings.Trim(left, "'"))
	if err != nil {
		return 0, fmt.Errorf("kRSUnicode value %q is not a radical count", value)
	}
	return n, nil
}

// unihanAttrKeys are the attrs a Unihan import owns on a zh character
// entry: a re-import replaces exactly these and keeps any other key.
var unihanAttrKeys = []string{"strokes", "tghz", "gb", "hkgrade"}

// parseUnihanAttr reads one level or stroke field into its attr:
//   - kTotalStrokes "6" or "7 9" -> strokes, the first (preferred) count;
//   - kTGHZ2013 (any value: the character is in the 2013 通用规范汉字表)
//     -> tghz "1";
//   - kGB0 "RRCC", the GB2312 row and cell -> gb "1" for rows 16–55 (level
//     1 hanzi), "2" for rows 56–87 (level 2); any other row is not a hanzi
//     level and yields no attr (key "");
//   - kGradeLevel "1".."6", the Hong Kong primary-school grade -> hkgrade.
//
// kGB0 and kGradeLevel come from the optional zip members: a malformed
// value there yields no attr (key "") instead of failing the import, as a
// missing member does. A malformed kTotalStrokes (a required member) is
// an error.
func parseUnihanAttr(field, value string) (key, attr string, err error) {
	switch field {
	case "kTotalStrokes":
		counts := strings.Fields(value)
		if len(counts) > 0 {
			if n, err := strconv.Atoi(counts[0]); err == nil && n > 0 {
				return "strokes", strconv.Itoa(n), nil
			}
		}
		return "", "", fmt.Errorf("kTotalStrokes value %q is not a stroke count", value)
	case "kTGHZ2013":
		return "tghz", "1", nil
	case "kGB0":
		code, err := strconv.Atoi(value)
		if err != nil || len(value) != 4 || strings.Trim(value, "0123456789") != "" {
			return "", "", nil // malformed optional value: no attr
		}
		switch row := code / 100; {
		case row >= 16 && row <= 55:
			return "gb", "1", nil
		case row >= 56 && row <= 87:
			return "gb", "2", nil
		}
		return "", "", nil
	case "kGradeLevel":
		n, err := strconv.Atoi(value)
		if err != nil || n < 1 {
			return "", "", nil // malformed optional value: no attr
		}
		return "hkgrade", strconv.Itoa(n), nil
	}
	return "", "", nil
}

// parseVariants reads a kSimplifiedVariant or kTraditionalVariant value:
// space-separated characters, as U+XXXX codepoints or spelled out.
func parseVariants(value string) ([]string, error) {
	tokens := strings.Fields(value)
	variants := make([]string, 0, len(tokens))
	for _, token := range tokens {
		if ch, err := unihanChar(token); err == nil {
			variants = append(variants, ch)
			continue
		}
		if utf8.RuneCountInString(token) == 1 {
			variants = append(variants, token)
			continue
		}
		return nil, fmt.Errorf("variant value %q: %q is neither a codepoint nor a character", value, token)
	}
	if len(variants) == 0 {
		return nil, fmt.Errorf("variant value %q carries no character", value)
	}
	return variants, nil
}

// parseDefinition reads a kDefinition value, stripping the double quotes
// the database may write around it. Definition text itself never contains
// a double quote, so the stripping is unambiguous.
func parseDefinition(value string) (string, error) {
	def := strings.TrimSuffix(strings.TrimPrefix(value, `"`), `"`)
	if strings.TrimSpace(def) == "" {
		return "", fmt.Errorf("kDefinition value %q carries no definition", value)
	}
	return def, nil
}

// readUnihanPack reads and parses the data of the format "unihan" pack in
// dir. Two layouts are accepted: the upstream distribution, Unihan.zip,
// from which the members carrying the parsed fields are concatenated
// (see unihanZipMembers; the optional ones only when present),
// and a single plain or gzip-compressed dictionary.txt.
func readUnihanPack(dir string) (UnihanData, error) {
	zipPath := filepath.Join(dir, unihanZipFile)
	if _, err := os.Stat(zipPath); err == nil {
		f, err := openZipMembers(zipPath, unihanZipMembers, unihanZipOptionalMembers)
		if err != nil {
			return UnihanData{}, fmt.Errorf("%w: read %s of %s: %v", pack.ErrInvalidPack, unihanZipFile, dir, err)
		}
		defer f.Close()
		data, err := ParseUnihan(f)
		if err != nil {
			return UnihanData{}, fmt.Errorf("%w: parse %s of %s: %v", pack.ErrInvalidPack, unihanZipFile, dir, err)
		}
		return data, nil
	}
	f, err := openMaybeGz(filepath.Join(dir, unihanFile))
	if err != nil {
		return UnihanData{}, fmt.Errorf("%w: read %s of %s: %v", pack.ErrInvalidPack, unihanFile, dir, err)
	}
	defer f.Close()
	data, err := ParseUnihan(f)
	if err != nil {
		return UnihanData{}, fmt.Errorf("%w: parse %s of %s: %v", pack.ErrInvalidPack, unihanFile, dir, err)
	}
	return data, nil
}
