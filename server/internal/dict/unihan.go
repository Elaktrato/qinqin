package dict

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"qinqin/internal/entries"
)

// unihanFile is the data file of a format "unihan" dictionary pack: the
// Unicode Unihan database's line format.
const unihanFile = "dictionary.txt"

// unihanZipFile is the upstream distribution of the Unihan database. The
// members below carry every field the importer parses: kRSUnicode lives
// in the IRG sources file (not the Adobe radical-stroke file, which
// carries a different field), variants in the variants file, and
// kDefinition in the readings file.
const unihanZipFile = "Unihan.zip"

var unihanZipMembers = []string{
	"Unihan_IRGSources.txt",
	"Unihan_Variants.txt",
	"Unihan_Readings.txt",
}

// The built-in dictionary a unihan import registers. The Unihan database
// is one canonical dataset, whatever pack delivered the file, so its row
// is keyed "unihan"; the license and attribution come from the pack's
// manifest so the registry always reflects the bundled source's real
// terms — re-importing any unihan pack replaces the built-in's senses.
const unihanPackID = "unihan"

// UnihanData is what ParseUnihan extracts from a Unihan database file:
// the four fields the importer consumes, keyed by character.
type UnihanData struct {
	Radicals     map[string]int      // kRSUnicode: character -> Kangxi radical number, left of the "."
	TradVariants map[string][]string // kTraditionalVariant: character -> its traditional variants
	SimpVariants map[string][]string // kSimplifiedVariant: character -> its simplified variants
	Definitions  map[string]string   // kDefinition: character -> its English definition
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
// (radical-stroke counts, variants, readings — kDefinition included),
// and a single plain or gzip-compressed dictionary.txt.
func readUnihanPack(dir string) (UnihanData, error) {
	zipPath := filepath.Join(dir, unihanZipFile)
	if _, err := os.Stat(zipPath); err == nil {
		f, err := openZipMembers(zipPath, unihanZipMembers...)
		if err != nil {
			return UnihanData{}, fmt.Errorf("%w: read %s of %s: %v", ErrInvalidPack, unihanZipFile, dir, err)
		}
		defer f.Close()
		data, err := ParseUnihan(f)
		if err != nil {
			return UnihanData{}, fmt.Errorf("%w: parse %s of %s: %v", ErrInvalidPack, unihanZipFile, dir, err)
		}
		return data, nil
	}
	f, err := openMaybeGz(filepath.Join(dir, unihanFile))
	if err != nil {
		return UnihanData{}, fmt.Errorf("%w: read %s of %s: %v", ErrInvalidPack, unihanFile, dir, err)
	}
	defer f.Close()
	data, err := ParseUnihan(f)
	if err != nil {
		return UnihanData{}, fmt.Errorf("%w: parse %s of %s: %v", ErrInvalidPack, unihanFile, dir, err)
	}
	return data, nil
}

// importUnihan installs a format "unihan" pack: character entries for
// every hanzi the file mentions — a field key or a variant counterpart —
// variant links across simplified/traditional pairs in both directions
// (a form may have several counterparts either way), radical
// classification through the Kangxi table, and the kDefinition strings
// as the senses of the built-in "unihan" dictionary. Unihan fields carry
// no pronunciations, so a hanzi entered by another dictionary keeps its
// readings, and one first seen here gets none.
func importUnihan(ctx context.Context, sqlDB *sql.DB, m Manifest, data UnihanData) (Result, error) {
	if err := registerLanguage(ctx, sqlDB, m); err != nil {
		return Result{}, err
	}
	store := entries.Store{DB: sqlDB}

	// Every hanzi the file mentions: a key of any consumed field, or a
	// character named as a variant counterpart.
	seen := make(map[string]bool, len(data.Radicals)+len(data.Definitions))
	for ch := range data.Radicals {
		seen[ch] = true
	}
	for ch := range data.Definitions {
		seen[ch] = true
	}
	for _, field := range []map[string][]string{data.TradVariants, data.SimpVariants} {
		for ch, variants := range field {
			seen[ch] = true
			for _, v := range variants {
				seen[v] = true
			}
		}
	}

	// Entries in sorted order, so an import is deterministic. charEntry
	// reuses a hanzi another dictionary already entered — readings and
	// senses intact — and creates or revives a bare one otherwise.
	chars := make([]string, 0, len(seen))
	for ch := range seen {
		chars = append(chars, ch)
	}
	slices.Sort(chars)
	ids := make(map[string]int64, len(chars))
	for _, ch := range chars {
		id, err := charEntry(ctx, store, m.Language, ch)
		if err != nil {
			return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
		}
		ids[ch] = id
	}

	// Variant pairs from both sides of the mapping: LinkVariant writes
	// both directions and links an existing pair again as a no-op, so a
	// pair named by a kSimplifiedVariant and a kTraditionalVariant line
	// alike links once.
	for _, field := range []map[string][]string{data.TradVariants, data.SimpVariants} {
		for ch, variants := range field {
			for _, v := range variants {
				if v == ch {
					continue // a self-pair is not a variant
				}
				if err := store.LinkVariant(ctx, ids[ch], ids[v]); err != nil {
					return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
				}
			}
		}
	}

	// Radical classification: the count left of the dot is a Kangxi
	// radical number, whose character becomes an entry through the
	// table, so radicals are fetchable and browsable like any hanzi.
	for _, ch := range chars {
		n, ok := data.Radicals[ch]
		if !ok {
			continue
		}
		radical, ok := kangxiRadicals[n]
		if !ok {
			return Result{}, fmt.Errorf("import dictionary %s: %s is under radical %d, outside the Kangxi radicals 1–214", m.ID, ch, n)
		}
		radicalID, err := charEntry(ctx, store, m.Language, radical)
		if err != nil {
			return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
		}
		if err := store.SetRadical(ctx, ids[ch], radicalID); err != nil {
			return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
		}
	}

	// The kDefinition strings become the built-in dictionary's senses,
	// one sense per character.
	senses := make([]senseRow, 0, len(data.Definitions))
	for _, ch := range chars {
		if def, ok := data.Definitions[ch]; ok {
			senses = append(senses, senseRow{entryID: ids[ch], gloss: def})
		}
	}
	if _, err := replaceSenses(ctx, sqlDB, unihanPackID, m.Name, m.Version, m.License, m.Attribution, senses); err != nil {
		return Result{}, err
	}
	return Result{Entries: len(chars), Senses: len(senses)}, nil
}
