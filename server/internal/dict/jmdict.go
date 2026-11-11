package dict

import (
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"qinqin/internal/model"
)

// jmdictFile is the data file of a format "jmdict" dictionary pack: the
// JMdict XML document.
const jmdictFile = "jmdict.xml"

// jmdictDoc is the decoded shape of a JMdict file: just the entries —
// every element the importer does not consume, part-of-speech codes and
// cross references among them, is skipped.
type jmdictDoc struct {
	Entries []jmdictEntry `xml:"entry"`
}

// jmdictEntry is one <entry> of a JMdict file: its sequence number, its
// kanji written forms, its kana readings, and its senses. A reading
// restricted to particular kanji forms is treated as a reading of the
// word as a whole — the forms share every reading, like a cedict
// traditional twin does.
type jmdictEntry struct {
	EntSeq int           `xml:"ent_seq"`
	KEles  []jmdictKEle  `xml:"k_ele"`
	REles  []jmdictREle  `xml:"r_ele"`
	Senses []jmdictSense `xml:"sense"`
}

// jmdictKEle is one <k_ele>: a kanji written form of the word.
type jmdictKEle struct {
	KEb string `xml:"keb"`
}

// jmdictREle is one <r_ele>: a kana reading of the word.
type jmdictREle struct {
	Reb string `xml:"reb"`
}

// jmdictSense is one <sense> of the word.
type jmdictSense struct {
	Glosses []jmdictGloss `xml:"gloss"`
}

// jmdictGloss is one <gloss> of a sense — English when it carries no
// xml:lang, another language when it does.
type jmdictGloss struct {
	Lang string `xml:"lang,attr"`
	Text string `xml:",chardata"`
}

// ParseJMdict parses a JMdict file from r: one raw entry per word — its
// first kanji form the written form and the rest variant forms, every
// kana reading typed "kana", and the English glosses of its senses in
// order. A word without a kanji form is written as its first kana
// reading. An entry with neither a form nor a reading, or with no
// English gloss, is an error naming its sequence number.
func ParseJMdict(r io.Reader) ([]RawEntry, error) {
	var doc jmdictDoc
	d := xml.NewDecoder(r)
	// JMdict references entities its DTD declares; undeclared ones pass
	// through as written rather than faulting the parse.
	d.Strict = false
	if err := d.Decode(&doc); err != nil {
		return nil, fmt.Errorf("jmdict: parse: %w", err)
	}
	es := make([]RawEntry, 0, len(doc.Entries))
	for _, x := range doc.Entries {
		var forms, readings []string
		for _, k := range x.KEles {
			if keb := strings.TrimSpace(k.KEb); keb != "" {
				forms = append(forms, keb)
			}
		}
		for _, re := range x.REles {
			if reb := strings.TrimSpace(re.Reb); reb != "" {
				readings = append(readings, reb)
			}
		}
		if len(forms) == 0 {
			if len(readings) == 0 {
				return nil, fmt.Errorf("jmdict: entry %d carries no kanji form and no reading", x.EntSeq)
			}
			// A word without a kanji form is written as its kana.
			forms = []string{readings[0]}
		}
		var glosses []string
		for _, s := range x.Senses {
			for _, g := range s.Glosses {
				if (g.Lang == "" || g.Lang == "eng") && strings.TrimSpace(g.Text) != "" {
					glosses = append(glosses, strings.TrimSpace(g.Text))
				}
			}
		}
		if len(glosses) == 0 {
			return nil, fmt.Errorf("jmdict: entry %d carries no English glosses", x.EntSeq)
		}
		rs := make([]model.Reading, len(readings))
		for i, reb := range readings {
			rs[i] = model.Reading{Type: "kana", Value: reb}
		}
		es = append(es, RawEntry{
			Written:  forms[0],
			Forms:    forms[1:],
			Readings: rs,
			Glosses:  glosses,
		})
	}
	return es, nil
}

// readJMdictPack reads and parses the jmdict.xml of the format "jmdict"
// pack in dir, resolving each word into the pipeline's entry shape:
// kind word, one entry per kanji form, kana readings, glosses.
func readJMdictPack(dir string) ([]entry, error) {
	f, err := openMaybeGz(filepath.Join(dir, jmdictFile))
	if err != nil {
		return nil, fmt.Errorf("%w: read %s of %s: %v", ErrInvalidPack, jmdictFile, dir, err)
	}
	defer f.Close()
	raw, err := ParseJMdict(f)
	if err != nil {
		return nil, fmt.Errorf("%w: parse %s of %s: %v", ErrInvalidPack, jmdictFile, dir, err)
	}
	es := make([]entry, len(raw))
	for i, r := range raw {
		es[i] = entry{
			Written:  r.Written,
			Kind:     "word",
			Readings: r.Readings,
			Glosses:  r.Glosses,
			Forms:    r.Forms,
		}
	}
	return es, nil
}
