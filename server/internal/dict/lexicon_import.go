package dict

import (
	"context"
	"database/sql"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strconv"
	"strings"

	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/model"
)

// ImportLexicon installs the dictionary pack into the lexicon (the lx_*
// tables), alongside the legacy Import it will replace. It dispatches on
// the pack's format; only "jmdict" is implemented. The whole pack — the
// dictionaries row and every entry — is written in ONE transaction, so a
// failure leaves nothing behind; a re-import of identical data writes no
// lexicon row (see lexicon.Store.Put). A data-only language registers
// first, outside that transaction, like the legacy import does.
//
// A jmdict pack becomes one lexicon entry per ent_seq (see
// jmdictLexiconEntry); Result.Entries counts them and Result.Senses the
// senses written.
func ImportLexicon(ctx context.Context, sqlDB *sql.DB, p *Pack) (Result, error) {
	m := p.Manifest
	m.normalize()
	if err := m.Validate(); err != nil {
		return Result{}, fmt.Errorf("%w: %v", ErrInvalidPack, err)
	}
	if m.Type != TypeDictionary {
		return Result{}, fmt.Errorf("%w: %q is a %s pack", ErrNotDictionary, m.ID, m.Type)
	}
	if m.Format != FormatJMdict {
		return Result{}, fmt.Errorf("%w: lexicon import of format %q is not implemented", ErrInvalidPack, m.Format)
	}
	if err := registerLanguage(ctx, sqlDB, m); err != nil {
		return Result{}, err
	}

	f, err := openMaybeGz(filepath.Join(p.Dir, jmdictFile))
	if err != nil {
		return Result{}, fmt.Errorf("%w: read %s of %s: %v", ErrInvalidPack, jmdictFile, p.Dir, err)
	}
	defer f.Close()

	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
	}
	defer tx.Rollback()

	var dictID int64
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (pack_id) DO UPDATE SET
			name = excluded.name,
			version = excluded.version,
			license = excluded.license,
			attribution = excluded.attribution,
			updated_at = excluded.updated_at,
			deleted_at = NULL
		RETURNING id`,
		m.ID, m.Name, m.Version, m.License, m.Attribution, now()).Scan(&dictID); err != nil {
		return Result{}, fmt.Errorf("register dictionary %s: %w", m.ID, err)
	}

	store := lexicon.Store{DB: sqlDB}
	var result Result
	err = streamJMdict(f, func(x jmdictEntry) error {
		e, err := jmdictLexiconEntry(x, m.Language)
		if err != nil {
			return err
		}
		if _, err := store.PutTx(ctx, tx, e, dictID); err != nil {
			return err
		}
		result.Entries++
		result.Senses += len(e.Senses)
		return nil
	})
	if err != nil {
		return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
	}
	if err := tx.Commit(); err != nil {
		return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
	}
	return result, nil
}

// streamJMdict decodes the JMdict document in r one <entry> at a time
// and calls fn for each, so the 200k-entry file never sits in memory.
// Entity references pass through as text exactly as in ParseJMdict.
func streamJMdict(r io.Reader, fn func(jmdictEntry) error) error {
	d := xml.NewDecoder(r)
	d.Strict = false
	for {
		tok, err := d.Token()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("jmdict: parse: %w", err)
		}
		start, ok := tok.(xml.StartElement)
		if !ok || start.Name.Local != "entry" {
			continue
		}
		var x jmdictEntry
		if err := d.DecodeElement(&x, &start); err != nil {
			return fmt.Errorf("jmdict: parse: %w", err)
		}
		if err := fn(x); err != nil {
			return err
		}
	}
}

// jmdictLexiconEntry builds the lexicon entry of one JMdict <entry>: key
// "j:<ent_seq>", kind word, every keb a form and every reb a kana
// reading (with the language pack's derived romaji after them), one
// sense per <sense> with English glosses. Blank forms and readings are
// dropped; an entry with no reading, or no English gloss, is an error
// naming its sequence number.
//
// A word with no kanji form has an empty Forms list: consumers fall back
// to the first reading as the headword.
//
// A sense without its own <pos> inherits the previous sense's (the JMdict
// DTD: "the part-of-speech of an earlier sense will apply to later
// senses unless there is a new part-of-speech indicated"). Pri is the
// best score among forms and readings; a uk word's kanji forms follow
// the rK-exempt rule of ParseJMdict (see kanjiFormScore).
func jmdictLexiconEntry(x jmdictEntry, language string) (*lexicon.Entry, error) {
	pack := lang.For(language)
	e := &lexicon.Entry{
		Language: language,
		Kind:     "word",
		Key:      "j:" + strconv.Itoa(x.EntSeq),
		Attrs:    map[string]string{},
	}

	var senseUK bool
	var pos []string
	for _, s := range x.Senses {
		if len(s.Pos) > 0 {
			pos = entityNames(s.Pos)
		}
		var glosses []string
		for _, g := range s.Glosses {
			if text := strings.TrimSpace(g.Text); (g.Lang == "" || g.Lang == "eng") && text != "" {
				glosses = append(glosses, text)
			}
		}
		tags := entityNames(s.Misc)
		for _, t := range tags {
			senseUK = senseUK || t == "uk"
		}
		if len(glosses) == 0 {
			continue
		}
		e.Senses = append(e.Senses, lexicon.Sense{
			POS:     append([]string{}, pos...),
			Tags:    tags,
			Glosses: glosses,
			Xrefs:   trimmed(s.Xref),
		})
	}
	if len(e.Senses) == 0 {
		return nil, fmt.Errorf("jmdict: entry %d carries no English glosses", x.EntSeq)
	}
	e.UK = senseUK

	kanaScore := 0
	var kana []model.Reading
	var readingMeta []lexicon.Reading
	for _, re := range x.REles {
		reb := strings.TrimSpace(re.Reb)
		if reb == "" {
			continue
		}
		pri := formScore(re.Pri, re.Inf)
		kanaScore = max(kanaScore, pri)
		kana = append(kana, model.Reading{Type: "kana", Value: reb})
		readingMeta = append(readingMeta, lexicon.Reading{
			Type: "kana", Value: reb, Plain: pack.NormalizeReading("kana", reb),
			Flags: entityNames(re.Inf), Pri: pri,
		})
	}
	if len(kana) == 0 {
		return nil, fmt.Errorf("jmdict: entry %d carries no reading", x.EntSeq)
	}
	e.Readings = readingMeta
	seen := map[string]bool{}
	for _, r := range pack.DeriveReadings(kana)[len(kana):] {
		if r.Type != "romaji" || seen[r.Value] {
			continue
		}
		seen[r.Value] = true
		e.Readings = append(e.Readings, lexicon.Reading{
			Type: "romaji", Value: r.Value, Plain: pack.NormalizeReading("romaji", r.Value),
		})
	}

	e.Pri = kanaScore
	for _, k := range x.KEles {
		keb := strings.TrimSpace(k.KEb)
		if keb == "" {
			continue
		}
		pri := kanjiFormScore(k, e.UK, kanaScore)
		e.Pri = max(e.Pri, pri)
		e.Forms = append(e.Forms, lexicon.Form{Text: keb, Flags: entityNames(k.Inf), Pri: pri})
	}
	return e, nil
}

// entityNames returns the names of the entity references in l ("&uk;"
// -> "uk"), never nil.
func entityNames(l []string) []string {
	out := make([]string, 0, len(l))
	for _, s := range l {
		out = append(out, entityName(s))
	}
	return out
}

// trimmed returns the non-blank values of l, trimmed, never nil.
func trimmed(l []string) []string {
	out := make([]string, 0, len(l))
	for _, s := range l {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}
