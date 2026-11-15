// Package audio imports pronunciation packs into a content-addressed clip
// store and resolves dictionary entries to clips.
package audio

import (
	"bufio"
	"fmt"
	"io"
	"regexp"
	"strings"

	"qinqin/internal/dict"
	"qinqin/internal/lang"
	"qinqin/internal/pinyin"
)

// Row kinds of an index.tsv.
const (
	KindTerm     = "term"
	KindSyllable = "syllable"
)

// LicensePerFile is the manifest licence meaning every row names its own.
const LicensePerFile = "per file"

// Row is one parsed index.tsv line with the manifest's terms filled in.
type Row struct {
	Kind, Form, Reading, File, License, Attribution, Source string
}

const indexHeader = "kind\tform\treading\tfile\tlicense\tattribution\tsource"

var (
	filePattern     = regexp.MustCompile(`^audio/[^/\\]+\.(opus|ogg|mp3)$`)
	syllablePattern = regexp.MustCompile(`^[a-z]+[1-5]$`)
)

// ParseIndex reads an audio pack's index.tsv. Empty license and
// attribution inherit the manifest's; a manifest licence of "per file"
// requires every row to carry its own. Errors name the line.
func ParseIndex(r io.Reader, m dict.Manifest) ([]Row, error) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	if !sc.Scan() || strings.TrimRight(sc.Text(), "\r") != indexHeader {
		return nil, fmt.Errorf("audio: index header must be %q", indexHeader)
	}
	var rows []Row
	for line := 2; sc.Scan(); line++ {
		text := strings.TrimRight(sc.Text(), "\r")
		if strings.TrimSpace(text) == "" {
			continue
		}
		f := strings.Split(text, "\t")
		if len(f) != 7 {
			return nil, fmt.Errorf("audio: index line %d: want 7 tab-separated fields, got %d", line, len(f))
		}
		row := Row{Kind: f[0], Form: f[1], Reading: f[2], File: f[3], License: f[4], Attribution: f[5], Source: f[6]}
		if err := checkRow(row, m); err != nil {
			return nil, fmt.Errorf("audio: index line %d: %w", line, err)
		}
		if row.License == "" {
			if strings.EqualFold(m.License, LicensePerFile) {
				return nil, fmt.Errorf("audio: index line %d: licence is required (the pack's licence is %q)", line, LicensePerFile)
			}
			row.License = m.License
		}
		if row.Attribution == "" {
			row.Attribution = m.Attribution
		}
		rows = append(rows, row)
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("audio: read index: %w", err)
	}
	return rows, nil
}

func checkRow(r Row, m dict.Manifest) error {
	if !filePattern.MatchString(r.File) || strings.Contains(r.File, "..") {
		return fmt.Errorf("file %q must be audio/<name>.opus, .ogg or .mp3", r.File)
	}
	switch r.Kind {
	case KindTerm:
		// A term without a reading (a recording that knows only its word)
		// matches the form under any reading.
		if strings.TrimSpace(r.Form) == "" {
			return fmt.Errorf("term needs a form")
		}
	case KindSyllable:
		if m.Language != "zh" {
			return fmt.Errorf("syllable rows are for zh packs, not %q", m.Language)
		}
		if r.Form != "" {
			return fmt.Errorf("syllable rows have an empty form, got %q", r.Form)
		}
		if got, err := pinyin.ToNumbered(r.Reading); !syllablePattern.MatchString(r.Reading) || err != nil || len(got) != 1 || got[0] != r.Reading {
			return fmt.Errorf("syllable reading %q must be one numbered pinyin syllable such as ni3", r.Reading)
		}
	default:
		return fmt.Errorf("kind %q must be term or syllable", r.Kind)
	}
	return nil
}

// ReadingKey is the match key of a reading: ja folds katakana to hiragana
// and drops spaces; zh is the joined numbered syllables (ni3hao3). An
// unparsable zh reading gives "".
func ReadingKey(language, reading string) string {
	if language == "zh" {
		syls, err := pinyin.ToNumbered(reading)
		if err != nil {
			return ""
		}
		return strings.Join(syls, "")
	}
	return strings.Join(strings.Fields(lang.ToHiragana(reading)), "")
}
