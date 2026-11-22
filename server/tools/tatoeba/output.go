package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"text/template"
)

// cc0Text is the CC0 1.0 legal code, verbatim (the copy in
// plugins/data/zh-grammar-demo/LICENSE; a test keeps them equal).
//
//go:embed templates/CC0-1.0.txt
var cc0Text string

// The pack's licence and attribution as the manifest states them.
const (
	packLicence     = "CC BY 2.0 FR (some sentences CC0 1.0)"
	packAttribution = "Tatoeba (https://tatoeba.org) and its contributors; each sentence's author and link are in credits.tsv"
)

// manifest is the pack manifest in a fixed field order.
type manifest struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	Type        string `json:"type"`
	Language    string `json:"language"`
	Format      string `json:"format"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
}

type outSentence struct {
	Hanzi       string `json:"hanzi"`
	Pinyin      string `json:"pinyin,omitempty"`
	Translation string `json:"translation"`
}

type outGroup struct {
	Word      string        `json:"word"`
	Sentences []outSentence `json:"sentences"`
}

// readingNote is the notice's sentence on the readings, per language.
var readingNote = map[string]string{
	"zh": "The pinyin was generated from CC-CEDICT ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)) and is left out where a word has several readings.",
	"ja": "The kana readings were generated from JMdict ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), EDRDG) and are given only where every word has one certain reading.",
}

func notice(code, exportDate string) string {
	return "Example sentences from [Tatoeba](https://tatoeba.org), export of " + exportDate +
		", written by Tatoeba's contributors and shared under [CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/); " +
		"some are [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). " +
		"Each sentence's author and its page on Tatoeba are listed in the pack's credits.tsv.\n\n" +
		"qinqin chose these sentences with a program: it kept sentences with an English translation, preferred native speakers, " +
		"and dropped flagged, duplicate and unsuitable ones. " + readingNote[code] +
		" The selection, the readings and the links to dictionary words were made automatically and may contain errors."
}

// writePack writes the language's pack into a staging directory under
// cfg.OutDir and swaps it in for <OutDir>/<pack id> once complete.
func writePack(cfg buildConfig, res *langResult) (string, error) {
	if err := os.MkdirAll(cfg.OutDir, 0o755); err != nil {
		return "", err
	}
	stage, err := os.MkdirTemp(cfg.OutDir, "."+res.rules.PackID+".")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	if err := os.Chmod(stage, 0o755); err != nil {
		return "", err
	}
	files := map[string][]byte{}

	m := manifest{
		ID: res.rules.PackID, Name: res.rules.Name, Version: cfg.Pin.ExportDate, Type: "sentences",
		Language: res.code, Format: "json", License: packLicence, Attribution: packAttribution,
		Notice: notice(res.code, cfg.Pin.ExportDate),
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(m); err != nil {
		return "", err
	}
	files["manifest.json"] = append([]byte(nil), buf.Bytes()...)

	// sentences.json: one word group per line, so a filter change is a
	// readable diff.
	buf.Reset()
	buf.WriteString("{\"entries\":[\n")
	line := json.NewEncoder(&buf)
	line.SetEscapeHTML(false)
	for i, g := range res.groups {
		og := outGroup{Word: g.word}
		for _, c := range g.sentences {
			og.Sentences = append(og.Sentences, outSentence{Hanzi: c.s.Text, Pinyin: c.reading, Translation: c.tr.Text})
		}
		if err := line.Encode(og); err != nil {
			return "", err
		}
		if i < len(res.groups)-1 {
			buf.Truncate(buf.Len() - 1)
			buf.WriteString(",\n")
		}
	}
	buf.WriteString("]}\n")
	files["sentences.json"] = append([]byte(nil), buf.Bytes()...)

	var credits strings.Builder
	credits.WriteString("sentence\tlicence\tauthor\ttranslation\ttranslation_licence\ttranslation_author\n")
	for _, c := range res.bundled {
		fmt.Fprintf(&credits, "%d\t%s\t%s\t%d\t%s\t%s\n", c.s.ID, c.s.Licence, c.s.Owner, c.tr.ID, c.tr.Licence, c.tr.Owner)
	}
	files["credits.tsv"] = []byte(credits.String())

	attribution, err := renderAttribution(cfg, res)
	if err != nil {
		return "", err
	}
	files["ATTRIBUTION.md"] = attribution
	files["LICENSE"] = []byte(licenceText)

	for name, data := range files {
		if err := os.WriteFile(filepath.Join(stage, name), data, 0o644); err != nil {
			return "", err
		}
	}
	dir := filepath.Join(cfg.OutDir, res.rules.PackID)
	if err := os.RemoveAll(dir); err != nil {
		return "", err
	}
	if err := os.Rename(stage, dir); err != nil {
		return "", err
	}
	return dir, nil
}

var licenceText = `Applies to: the sentences and translations in this directory (sentences.json,
credits.tsv), which come from Tatoeba (https://tatoeba.org).

Sentence text on Tatoeba is licensed under the Creative Commons Attribution
2.0 France licence (CC BY 2.0 FR). As that licence allows (section 4a), this
file gives its Uniform Resource Identifier instead of a copy:

    https://creativecommons.org/licenses/by/2.0/fr/legalcode

The authors of each sentence are listed in credits.tsv. Sentences marked
"CC0 1.0" there were also released by Tatoeba under CC0 1.0 Universal, whose
legal code follows, verbatim from
https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt

` + cc0Text

var attributionTemplate = template.Must(template.New("attribution").Parse(`# {{.Name}}

Example sentences with English translations from Tatoeba
(https://tatoeba.org), a collection of sentences and translations written by
its contributors.

- Licence: sentence text CC BY 2.0 FR
  (https://creativecommons.org/licenses/by/2.0/fr/); sentences Tatoeba also
  releases under CC0 1.0 are marked "CC0 1.0" in credits.tsv. See LICENSE.
- Authors: credits.tsv lists every sentence of this pack with its Tatoeba id,
  licence and author (the contributor's Tatoeba username), and the same for
  its English translation. A sentence's page on Tatoeba is
  https://tatoeba.org/en/sentences/show/<id>.
- Source: Tatoeba's export of {{.ExportDate}} ({{.Source}}), files and SHA-256:
{{- range .Archives}}
  - {{.File}} ({{.Member}}): {{.SHA256}}
{{- end}}
- Licence check: Tatoeba's downloads page and terms of use re-read on
  {{.Checked}}: {{.Statement}}
- Changes: qinqin's tool server/tools/tatoeba selected the sentences with
  rules.json (SHA-256 {{.RulesSum}}): only sentences with an English
  translation; orphaned, flagged, negatively reviewed, deny-listed,
  near-duplicate and too short or long sentences dropped; native speakers
  preferred; at most {{.MaxPerWord}} sentences per word. The readings were
  generated with {{.Dictionary}} and are left out where a word has several.
  The sentences are filed under the dictionary words they contain. The
  selection, the readings and the filing were made by a program and may
  contain errors.
- Contents: {{.Sentences}} sentences under {{.Words}} words.
`))

type attributionData struct {
	Name, ExportDate, Source, Checked, Statement, RulesSum, Dictionary string
	Archives                                                           []attributionArchive
	MaxPerWord, Sentences, Words                                       int
}

type attributionArchive struct{ File, Member, SHA256 string }

func renderAttribution(cfg buildConfig, res *langResult) ([]byte, error) {
	d := attributionData{
		Name: res.rules.Name, ExportDate: cfg.Pin.ExportDate, Source: cfg.Pin.Source,
		Checked: cfg.Pin.Licence.Checked, Statement: cfg.Pin.Licence.Statement, RulesSum: cfg.Rules.sum,
		Dictionary: res.dict, MaxPerWord: cfg.Rules.MaxPerWord, Sentences: len(res.bundled), Words: len(res.groups),
	}
	for _, a := range cfg.Pin.Archives {
		d.Archives = append(d.Archives, attributionArchive{File: a.file(), Member: a.Member, SHA256: a.SHA256})
	}
	var buf bytes.Buffer
	if err := attributionTemplate.Execute(&buf, d); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
