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
// plugins/data/zh-grammar/LICENSE; a test keeps them equal).
//
//go:embed templates/CC0-1.0.txt
var cc0Text string

// readingSource is the dictionary a language's readings and word filing
// derive from, with its publisher and link; both are CC BY-SA 4.0.
type readingSource struct{ name, publisher, link string }

var readingSources = map[string]readingSource{
	"zh": {"CC-CEDICT", "MDBG and the CC-CEDICT community", "https://cc-cedict.org"},
	"ja": {"JMdict", "the Electronic Dictionary Research and Development Group (EDRDG)", "https://www.edrdg.org/"},
}

const (
	byURI       = "https://creativecommons.org/licenses/by/2.0/fr/"
	bySAURI     = "https://creativecommons.org/licenses/by-sa/4.0/"
	sentenceURL = "https://tatoeba.org/en/sentences/show/"
)

// packLicence is the manifest licence: the sentences', plus the readings'.
func packLicence(code string) string {
	return "CC BY 2.0 FR (some sentences CC0 1.0); readings from " + readingSources[code].name + ", CC BY-SA 4.0"
}

// creditsURL is the published copy of a pack's credits.tsv: the manifest
// attribution names it so the per-sentence credits are one click from the
// Sources page.
func creditsURL(packID string) string {
	return "https://github.com/Elaktrato/qinqin/blob/main/plugins/data/" + packID + "/credits.tsv"
}

func packAttribution(code, packID string) string {
	rs := readingSources[code]
	return "Tatoeba (https://tatoeba.org) and its contributors; each sentence's owner and Tatoeba page: " + creditsURL(packID) +
		"; readings from " + rs.name + " (" + rs.link + ")"
}

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
	"zh": "The pinyin and the filing under words were generated from [CC-CEDICT](https://cc-cedict.org) (MDBG, [CC BY-SA 4.0](" + bySAURI + ")); a reading is left out where a word has several.",
	"ja": "The kana readings and the filing under words were generated from [JMdict](https://www.edrdg.org/) (EDRDG, [CC BY-SA 4.0](" + bySAURI + ")); a reading is given only where every word has one certain reading.",
}

func notice(code, packID, exportDate string) string {
	return "Example sentences from [Tatoeba](https://tatoeba.org), export of " + exportDate +
		", written by Tatoeba's contributors and shared under [CC BY 2.0 FR](" + byURI + "); " +
		"some are [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). " +
		"Each sentence's owner (as listed by Tatoeba) and its page on Tatoeba are listed in the pack's [credits.tsv](" + creditsURL(packID) + ").\n\n" +
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
		Language: res.code, Format: "json", License: packLicence(res.code), Attribution: packAttribution(res.code, res.rules.PackID),
		Notice: notice(res.code, res.rules.PackID, cfg.Pin.ExportDate),
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
	credits.WriteString("sentence\turl\tlicence\towner\ttranslation\ttranslation_url\ttranslation_licence\ttranslation_owner\n")
	for _, c := range res.bundled {
		fmt.Fprintf(&credits, "%d\t%s%d\t%s\t%s\t%d\t%s%d\t%s\t%s\n",
			c.s.ID, sentenceURL, c.s.ID, c.s.Licence, c.s.Owner, c.tr.ID, sentenceURL, c.tr.ID, c.tr.Licence, c.tr.Owner)
	}
	files["credits.tsv"] = []byte(credits.String())

	attribution, err := renderAttribution(cfg, res)
	if err != nil {
		return "", err
	}
	files["ATTRIBUTION.md"] = attribution
	files["LICENSE"] = []byte(licenceText(res.code))

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

func licenceText(code string) string {
	rs := readingSources[code]
	return `Applies to: the sentences and translations in this directory (sentences.json,
credits.tsv), which come from Tatoeba (https://tatoeba.org), and the readings
(the "pinyin" field of sentences.json) and the filing of the sentences under
dictionary words, which qinqin generated from ` + rs.name + `.

Sentence text on Tatoeba is licensed under the Creative Commons Attribution
2.0 France licence (CC BY 2.0 FR). As that licence allows (section 4a), this
file gives its Uniform Resource Identifier instead of a copy:

    https://creativecommons.org/licenses/by/2.0/fr/legalcode

The owner of each sentence (as listed by Tatoeba) and its page are in
credits.tsv. Sentences marked "CC0 1.0" there were also released by Tatoeba
under CC0 1.0 Universal, whose legal code is at the end of this file.

The readings ("pinyin" field) and the word filing derive from ` + rs.name + `
(` + rs.link + `), by ` + rs.publisher + `, licensed under the
Creative Commons Attribution-ShareAlike 4.0 International licence
(CC BY-SA 4.0): ` + bySAURI + `
The full CC BY-SA 4.0 text ships with that dictionary pack
(plugins/data/` + map[string]string{"zh": "cedict", "ja": "jmdict"}[code] + `/LICENSE).

CC0 1.0 Universal, verbatim from
https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt

` + cc0Text
}

var attributionTemplate = template.Must(template.New("attribution").Parse(`# {{.Name}}

Example sentences with English translations from Tatoeba
(https://tatoeba.org), a collection of sentences and translations written by
its contributors.

- Licence: sentence text CC BY 2.0 FR
  (https://creativecommons.org/licenses/by/2.0/fr/); sentences Tatoeba also
  releases under CC0 1.0 are marked "CC0 1.0" in credits.tsv. See LICENSE.
- Owners: credits.tsv lists every sentence of this pack with its Tatoeba id,
  page (https://tatoeba.org/en/sentences/show/<id>), licence and owner (the
  Tatoeba username listed for it), and the same for its English translation.
  Published copy: {{.CreditsURL}}
- Readings: the "pinyin" field and the filing under words were generated from
  {{.ReadingName}} ({{.ReadingLink}}), by {{.ReadingPublisher}}, CC BY-SA 4.0
  (https://creativecommons.org/licenses/by-sa/4.0/).
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
	CreditsURL, ReadingName, ReadingLink, ReadingPublisher             string
	Archives                                                           []attributionArchive
	MaxPerWord, Sentences, Words                                       int
}

type attributionArchive struct{ File, Member, SHA256 string }

func renderAttribution(cfg buildConfig, res *langResult) ([]byte, error) {
	d := attributionData{
		Name: res.rules.Name, ExportDate: cfg.Pin.ExportDate, Source: cfg.Pin.Source,
		Checked: cfg.Pin.Licence.Checked, Statement: cfg.Pin.Licence.Statement, RulesSum: cfg.Rules.sum,
		Dictionary: res.dict, MaxPerWord: cfg.Rules.MaxPerWord, Sentences: len(res.bundled), Words: len(res.groups),
		CreditsURL: creditsURL(res.rules.PackID), ReadingName: readingSources[res.code].name,
		ReadingLink: readingSources[res.code].link, ReadingPublisher: readingSources[res.code].publisher,
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
