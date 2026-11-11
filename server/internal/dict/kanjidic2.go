package dict

import (
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"strconv"
	"strings"

	"qinqin/internal/model"
)

// kanjidic2File is the data file of a format "kanjidic2" dictionary
// pack: the KANJIDIC2 XML document.
const kanjidic2File = "kanjidic2.xml"

// The built-in dictionary a kanjidic2 import registers. KANJIDIC2 is
// one canonical EDRDG dataset with fixed license terms, whatever pack
// delivered the file, so its row is keyed "kanjidic2" with those terms —
// re-importing any kanjidic2 pack replaces the built-in's senses, like
// the built-in unihan dictionary.
const (
	kanjidic2PackID      = "kanjidic2"
	kanjidic2License     = "CC BY-SA 4.0"
	kanjidic2Attribution = "Electronic Dictionary Research and Development Group (EDRDG)"
)

// kanjidic2Doc is the decoded shape of a KANJIDIC2 file: just the
// characters — the header and every element the importer does not
// consume are skipped.
type kanjidic2Doc struct {
	Characters []kanjidic2Character `xml:"character"`
}

// kanjidic2Character is one <character> element, carrying only the
// fields the importer consumes: the literal, the classical radical, the
// stroke counts, and the readings and meanings of its rmgroup. The
// nanori a character carries in nam_readings outside the rmgroup stay
// out — name readings are not dictionary readings — and so do readings
// in other notations, pinyin among them.
type kanjidic2Character struct {
	Literal string           `xml:"literal"`
	Radical kanjidic2Radical `xml:"radical"`
	Misc    kanjidic2Misc    `xml:"misc"`
	RMGroup kanjidic2RMGroup `xml:"reading_meaning>rmgroup"`
}

// kanjidic2Radical is a character's <radical> element.
type kanjidic2Radical struct {
	RadValues []kanjidic2RadValue `xml:"rad_value"`
}

// kanjidic2RadValue is one <rad_value>: a radical number under a
// numbering scheme, classical or Nelson. Only the classical scheme is
// the Kangxi numbering the radical table keys on.
type kanjidic2RadValue struct {
	RadType string `xml:"rad_type,attr"`
	Value   int    `xml:",chardata"`
}

// kanjidic2Misc is a character's <misc> element.
type kanjidic2Misc struct {
	StrokeCounts []int `xml:"stroke_count"`
}

// kanjidic2RMGroup is the rmgroup of a character's reading_meaning.
type kanjidic2RMGroup struct {
	Readings []kanjidic2Reading `xml:"reading"`
	Meanings []kanjidic2Meaning `xml:"meaning"`
}

// kanjidic2Reading is one <reading> of an rmgroup.
type kanjidic2Reading struct {
	RType string `xml:"r_type,attr"`
	Value string `xml:",chardata"`
}

// kanjidic2Meaning is one <meaning> of an rmgroup — English when it
// carries no m_lang, another language when it does.
type kanjidic2Meaning struct {
	MLang string `xml:"m_lang,attr"`
	Text  string `xml:",chardata"`
}

// ParseKanjidic2 parses a KANJIDIC2 file from r: one raw entry per
// character — its ON readings typed "on" and its KUN readings "kun" as
// written, its English meanings as glosses, its first stroke count in
// Attrs["strokes"], and its classical radical number in Radical. A
// character without a literal, or malformed XML, is an error.
func ParseKanjidic2(r io.Reader) ([]RawEntry, error) {
	var doc kanjidic2Doc
	if err := xml.NewDecoder(r).Decode(&doc); err != nil {
		return nil, fmt.Errorf("kanjidic2: parse: %w", err)
	}
	es := make([]RawEntry, 0, len(doc.Characters))
	for i, c := range doc.Characters {
		if strings.TrimSpace(c.Literal) == "" {
			return nil, fmt.Errorf("kanjidic2: character %d carries no literal", i+1)
		}
		e := RawEntry{Written: c.Literal}
		for _, rv := range c.Radical.RadValues {
			if rv.RadType == "classical" {
				e.Radical = rv.Value
				break
			}
		}
		if len(c.Misc.StrokeCounts) > 0 {
			e.Attrs = map[string]string{"strokes": strconv.Itoa(c.Misc.StrokeCounts[0])}
		}
		for _, rd := range c.RMGroup.Readings {
			switch rd.RType {
			case "ja_on":
				e.Readings = append(e.Readings, model.Reading{Type: "on", Value: strings.TrimSpace(rd.Value)})
			case "ja_kun":
				e.Readings = append(e.Readings, model.Reading{Type: "kun", Value: strings.TrimSpace(rd.Value)})
			}
		}
		for _, mn := range c.RMGroup.Meanings {
			if mn.MLang == "" && strings.TrimSpace(mn.Text) != "" {
				e.Glosses = append(e.Glosses, strings.TrimSpace(mn.Text))
			}
		}
		es = append(es, e)
	}
	return es, nil
}

// readKanjidic2Pack reads and parses the kanjidic2.xml of the format
// "kanjidic2" pack in dir, resolving each character into the pipeline's
// entry shape: kind character, ON and KUN readings as written.
func readKanjidic2Pack(dir string) ([]entry, error) {
	f, err := openMaybeGz(filepath.Join(dir, kanjidic2File))
	if err != nil {
		return nil, fmt.Errorf("%w: read %s of %s: %v", ErrInvalidPack, kanjidic2File, dir, err)
	}
	defer f.Close()
	raw, err := ParseKanjidic2(f)
	if err != nil {
		return nil, fmt.Errorf("%w: parse %s of %s: %v", ErrInvalidPack, kanjidic2File, dir, err)
	}
	es := make([]entry, len(raw))
	for i, r := range raw {
		es[i] = entry{
			Written:  r.Written,
			Kind:     "character",
			Readings: r.Readings,
			Glosses:  r.Glosses,
			Attrs:    r.Attrs,
			Radical:  r.Radical,
		}
	}
	return es, nil
}
