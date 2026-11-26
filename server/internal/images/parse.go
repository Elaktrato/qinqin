package images

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	picturesHeader = "concept\tfile\tlabel\tcredit"
	mapHeader      = "language\ttarget\tsense\tconcept\tscore\tbasis\tnote"
)

// conceptPattern is what a concept id may be: it is also the picture's file
// name, so it can never name a path.
var conceptPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// basisPattern is how a mapping was found: name, keyword, gloss, name+gloss,
// manual (free to grow, but a word, not prose).
var basisPattern = regexp.MustCompile(`^[a-z][a-z+-]{0,23}$`)

const (
	maxTargetBytes = 200
	maxLabelBytes  = 200
	maxCreditBytes = 500
	maxSense       = 999
)

// tsvLines splits a TSV file into its data lines after checking the header.
func tsvLines(raw []byte, header, file string) ([]string, error) {
	if !utf8.Valid(raw) {
		return nil, fmt.Errorf("%s: not UTF-8", file)
	}
	text := strings.ReplaceAll(string(raw), "\r\n", "\n")
	lines := strings.Split(text, "\n")
	if lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) == 0 || lines[0] != header {
		return nil, fmt.Errorf("%s: the first line must be the header %q", file, strings.ReplaceAll(header, "\t", `\t`))
	}
	return lines[1:], nil
}

func cleanText(s string, limit int) bool {
	if s == "" || len(s) > limit {
		return false
	}
	for _, r := range s {
		if r < 0x20 || r == 0x7f || (r >= 0x202a && r <= 0x202e) || (r >= 0x2066 && r <= 0x2069) {
			return false
		}
	}
	return true
}

// parsePictures reads pictures.tsv: concept, file, label, credit. The file
// column must be pictures/<concept>.svg: the pack states it, the server
// derives the path from the concept and checks they agree.
func parsePictures(raw []byte) ([]Picture, error) {
	lines, err := tsvLines(raw, picturesHeader, PicturesFile)
	if err != nil {
		return nil, err
	}
	if len(lines) > maxPictures {
		return nil, fmt.Errorf("%s: more than %d pictures", PicturesFile, maxPictures)
	}
	seen := map[string]bool{}
	out := make([]Picture, 0, len(lines))
	for i, line := range lines {
		at := fmt.Sprintf("%s line %d", PicturesFile, i+2)
		f := strings.Split(line, "\t")
		if len(f) != 4 {
			return nil, fmt.Errorf("%s: %d fields, want 4", at, len(f))
		}
		p := Picture{Concept: trimCell(f[0]), Label: trimCell(f[2]), Credit: trimCell(f[3])}
		switch {
		case !conceptPattern.MatchString(p.Concept):
			return nil, fmt.Errorf("%s: concept %q is not a plain id (letters, digits, . _ -; at most 64)", at, p.Concept)
		case seen[p.Concept]:
			return nil, fmt.Errorf("%s: concept %q appears twice", at, p.Concept)
		case f[1] != PicturesDir+"/"+p.Concept+".svg":
			return nil, fmt.Errorf("%s: file %q must be %s/%s.svg", at, f[1], PicturesDir, p.Concept)
		case !cleanText(p.Label, maxLabelBytes):
			return nil, fmt.Errorf("%s: label is empty, too long or has control characters", at)
		case !cleanText(p.Credit, maxCreditBytes):
			return nil, fmt.Errorf("%s: credit is empty, too long or has control characters", at)
		}
		seen[p.Concept] = true
		out = append(out, p)
	}
	return out, nil
}

// parseMap reads map.tsv: language, target, sense, concept, score, basis,
// note (the note is for people and is not stored).
func parseMap(raw []byte, languages []string, concepts map[string]bool) ([]Mapping, error) {
	lines, err := tsvLines(raw, mapHeader, MapFile)
	if err != nil {
		return nil, err
	}
	if len(lines) == 0 {
		return nil, fmt.Errorf("%s: no mappings", MapFile)
	}
	if len(lines) > maxMapRows {
		return nil, fmt.Errorf("%s: more than %d rows", MapFile, maxMapRows)
	}
	type key struct {
		lang, target, concept string
		sense                 int
	}
	seen := make(map[key]bool, len(lines))
	out := make([]Mapping, 0, len(lines))
	for i, line := range lines {
		at := fmt.Sprintf("%s line %d", MapFile, i+2)
		f := strings.Split(line, "\t")
		if len(f) != 7 {
			return nil, fmt.Errorf("%s: %d fields, want 7", at, len(f))
		}
		sense, err1 := strconv.Atoi(f[2])
		score, err2 := strconv.Atoi(f[4])
		m := Mapping{Language: f[0], Target: trimCell(f[1]), Concept: f[3], Basis: f[5], Sense: sense, Score: score}
		switch {
		case !slices.Contains(languages, m.Language):
			return nil, fmt.Errorf("%s: language %q is not one of the manifest's languages", at, m.Language)
		case !cleanText(m.Target, maxTargetBytes):
			return nil, fmt.Errorf("%s: target is empty, too long or has control characters", at)
		case err1 != nil || sense < 0 || sense > maxSense:
			return nil, fmt.Errorf("%s: sense %q is not a number from 0 to %d", at, f[2], maxSense)
		case !concepts[m.Concept]:
			return nil, fmt.Errorf("%s: concept %q is not in %s", at, m.Concept, PicturesFile)
		case err2 != nil || score < 0 || score > 100:
			return nil, fmt.Errorf("%s: score %q is not a number from 0 to 100", at, f[4])
		case !basisPattern.MatchString(m.Basis):
			return nil, fmt.Errorf("%s: basis %q is not a short lower-case word", at, m.Basis)
		}
		k := key{m.Language, m.Target, m.Concept, m.Sense}
		if seen[k] {
			return nil, fmt.Errorf("%s: the row for %s %q sense %d concept %s appears twice", at, m.Language, m.Target, m.Sense, m.Concept)
		}
		seen[k] = true
		out = append(out, m)
	}
	return out, nil
}
