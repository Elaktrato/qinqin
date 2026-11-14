package dict

import (
	"context"
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"maps"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/model"
)

// ImportLexicon installs the dictionary pack into the lexicon. It
// dispatches on the pack's format: jmdict, cedict, kanjidic2, unihan and
// json. The whole pack — the dictionaries row and every entry, link and
// sense — is written in ONE transaction, so a failure leaves nothing
// behind; a re-import of identical data writes no lexicon row (see
// lexicon.Store.Put). A language code without a registered code pack
// registers first, outside that transaction, as a data-only language.
// kanjidic2 and unihan register the built-in dictionaries "kanjidic2"
// and "unihan": each one canonical dataset with fixed license terms,
// whatever pack delivered the file.
//
// Result.Entries counts the pack's own lexicon entries and Result.Senses
// the senses written; a bare character entry created only as a radical
// is not counted. The entry shapes are described at jmdictLexiconEntry,
// cedictLexiconEntries, kanjidic2LexiconEntry, importUnihanLexicon and
// jsonLexiconEntry.
func ImportLexicon(ctx context.Context, sqlDB *sql.DB, p *Pack) (Result, error) {
	m := p.Manifest
	m.normalize()
	if err := m.Validate(); err != nil {
		return Result{}, fmt.Errorf("%w: %v", ErrInvalidPack, err)
	}
	if m.Type != TypeDictionary {
		return Result{}, fmt.Errorf("%w: %q is a %s pack", ErrNotDictionary, m.ID, m.Type)
	}

	// The dictionary row the import registers, and what writes the
	// pack's entries into the transaction once it exists. Data is read
	// and parsed before anything is written.
	type source struct {
		packID, license, attribution string
		write                        func(ctx context.Context, tx *sql.Tx, store lexicon.Store, dictID int64) (Result, error)
	}
	src := source{packID: m.ID, license: m.License, attribution: m.Attribution}
	switch m.Format {
	case FormatJMdict:
		src.write = func(ctx context.Context, tx *sql.Tx, store lexicon.Store, dictID int64) (Result, error) {
			return importJMdictLexicon(ctx, tx, store, dictID, m, p.Dir)
		}
	case FormatCedict:
		lines, err := readCedictLines(p.Dir)
		if err != nil {
			return Result{}, err
		}
		es, stats := cedictLexiconEntries(lines, m.Language)
		src.write = func(ctx context.Context, tx *sql.Tx, store lexicon.Store, dictID int64) (Result, error) {
			result := Result{Skipped: stats.skipped, Unconverted: stats.unconverted}
			for _, e := range es {
				// CEDICT owns no attrs: a character keeps Unihan's. Only
				// characters carry other importers' attrs, so a word
				// skips the stored-attrs lookup.
				put := store.PutTx
				if e.Kind == "character" {
					put = func(ctx context.Context, tx *sql.Tx, e *lexicon.Entry, dictID int64) (int64, error) {
						return putOwningAttrs(ctx, tx, store, e, dictID, nil)
					}
				}
				if _, err := put(ctx, tx, e, dictID); err != nil {
					return Result{}, err
				}
				result.Entries++
				result.Senses += len(e.Senses)
			}
			return result, nil
		}
	case FormatKanjidic2:
		es, err := readKanjidic2Pack(p.Dir)
		if err != nil {
			return Result{}, err
		}
		src.packID, src.license, src.attribution = kanjidic2PackID, kanjidic2License, kanjidic2Attribution
		src.write = func(ctx context.Context, tx *sql.Tx, store lexicon.Store, dictID int64) (Result, error) {
			return importKanjidic2Lexicon(ctx, tx, store, dictID, m, es)
		}
	case FormatUnihan:
		data, err := readUnihanPack(p.Dir)
		if err != nil {
			return Result{}, err
		}
		src.packID = unihanPackID
		src.write = func(ctx context.Context, tx *sql.Tx, store lexicon.Store, dictID int64) (Result, error) {
			return importUnihanLexicon(ctx, tx, store, dictID, m, data)
		}
	case FormatJSON:
		es, err := readJSONPack(p.Dir)
		if err != nil {
			return Result{}, err
		}
		src.write = func(ctx context.Context, tx *sql.Tx, store lexicon.Store, dictID int64) (Result, error) {
			var result Result
			for _, le := range jsonLexiconEntries(es, m.Language) {
				if _, err := putMerged(ctx, tx, store, le, dictID, nil); err != nil {
					return Result{}, err
				}
				result.Entries++
				result.Senses += len(le.Senses)
			}
			return result, nil
		}
	default:
		return Result{}, fmt.Errorf("%w: lexicon import of format %q is not implemented", ErrInvalidPack, m.Format)
	}

	if err := registerLanguage(ctx, sqlDB, m); err != nil {
		return Result{}, err
	}
	tx, err := sqlDB.BeginTx(ctx, nil)
	if err != nil {
		return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
	}
	defer tx.Rollback()
	dictID, err := upsertDictionary(ctx, tx, src.packID, m.Name, m.Version, src.license, src.attribution, now())
	if err != nil {
		return Result{}, err
	}
	result, err := src.write(ctx, tx, lexicon.Store{DB: sqlDB}, dictID)
	if err != nil {
		return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
	}
	if err := tx.Commit(); err != nil {
		return Result{}, fmt.Errorf("import dictionary %s: %w", m.ID, err)
	}
	return result, nil
}

// importJMdictLexicon streams the pack's jmdict.xml into the lexicon: one
// entry per ent_seq (see jmdictLexiconEntry).
func importJMdictLexicon(ctx context.Context, tx *sql.Tx, store lexicon.Store, dictID int64, m Manifest, dir string) (Result, error) {
	f, err := openMaybeGz(filepath.Join(dir, jmdictFile))
	if err != nil {
		return Result{}, fmt.Errorf("%w: read %s of %s: %v", ErrInvalidPack, jmdictFile, dir, err)
	}
	defer f.Close()
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
	return result, err
}

// cedictLexiconEntries builds the lexicon entries of a parsed CC-CEDICT
// file, one per simplified written form in order of first appearance:
// Key = the simplified form, Kind "character" for one hanzi else "word".
// The forms are the simplified form first, then the distinct traditional
// forms of its lines (flag "trad", only where they differ from the
// simplified form), so a traditional form shared by several simplified
// entries is a form of each. Homograph lines merge into the one entry:
// its readings are the distinct marked pinyin in file order, followed by
// the bopomofo the language pack derives from each, and it carries one
// sense per line, in file order, holding that line's glosses. Pinyin
// that does not convert is kept as written and counted.
func cedictLexiconEntries(p cedictParse, language string) ([]*lexicon.Entry, cedictStats) {
	pack := lang.For(language)
	stats := cedictStats{skipped: p.skipped}
	var (
		out     []*lexicon.Entry
		at      = map[string]int{}
		pinyins = map[string][]model.Reading{}
	)
	for _, r := range p.entries {
		marked := markedPinyin(r, &stats)
		var e *lexicon.Entry
		if i, ok := at[r.Written]; ok {
			e = out[i]
		} else {
			e = &lexicon.Entry{
				Language: language,
				Kind:     cedictKind(r.Written),
				Key:      r.Written,
				Forms:    []lexicon.Form{{Text: r.Written}},
				Attrs:    map[string]string{},
			}
			at[r.Written] = len(out)
			out = append(out, e)
		}
		for _, trad := range tradForms(r.Written, r.Trad) {
			if !slices.ContainsFunc(e.Forms, func(f lexicon.Form) bool { return f.Text == trad }) {
				e.Forms = append(e.Forms, lexicon.Form{Text: trad, Flags: []string{"trad"}})
			}
		}
		rs := pinyins[r.Written]
		if !slices.ContainsFunc(rs, func(x model.Reading) bool { return x.Value == marked }) {
			pinyins[r.Written] = append(rs, model.Reading{Type: "pinyin", Value: marked})
		}
		e.Senses = append(e.Senses, lexicon.Sense{Glosses: r.Glosses})
	}
	for _, e := range out {
		e.Readings = lexiconReadings(pack, pinyins[e.Key], true)
	}
	return out, stats
}

// lexiconReadings resolves typed readings into lexicon readings through
// the language pack: Plain is the pack's normalized form, and the
// readings the pack derives follow the given ones (a derived reading
// already present is not repeated). With each set, derivation runs per
// given reading, so every pinyin of a homograph entry gets its own
// bopomofo rather than only the first.
func lexiconReadings(pack lang.Pack, given []model.Reading, each bool) []lexicon.Reading {
	groups := [][]model.Reading{given}
	if each {
		groups = groups[:0]
		for _, r := range given {
			groups = append(groups, []model.Reading{r})
		}
	}
	all := slices.Clone(given)
	for _, g := range groups {
		for _, d := range pack.DeriveReadings(slices.Clone(g))[len(g):] {
			if !slices.ContainsFunc(all, func(x model.Reading) bool { return x.Type == d.Type && x.Value == d.Value }) {
				all = append(all, d)
			}
		}
	}
	out := make([]lexicon.Reading, len(all))
	for i, r := range all {
		out[i] = lexicon.Reading{Type: r.Type, Value: r.Value, Plain: pack.NormalizeReading(r.Type, r.Value)}
	}
	return out
}

// bareCharacter is a character entry with just its own form: kind
// character, no readings, no senses.
func bareCharacter(language, hanzi string) *lexicon.Entry {
	return &lexicon.Entry{
		Language: language,
		Kind:     "character",
		Key:      hanzi,
		Forms:    []lexicon.Form{{Text: hanzi}},
		Attrs:    map[string]string{},
	}
}

// existingEntry loads the active entry of (language, kind, key) as the
// transaction sees it, with its forms, readings, ranking and attrs (not
// its senses); nil when there is none. lexicon.Store reads outside the
// import's transaction, so a merge needs its own read.
func existingEntry(ctx context.Context, tx *sql.Tx, language, kind, key string) (*lexicon.Entry, error) {
	e := &lexicon.Entry{Language: language, Kind: kind, Key: key}
	var (
		uk    int
		attrs string
	)
	err := tx.QueryRowContext(ctx, `
		SELECT id, pri, uk, attrs FROM entries
		WHERE language = ? AND kind = ? AND ext_key = ? AND deleted_at IS NULL`,
		language, kind, key).Scan(&e.ID, &e.Pri, &uk, &attrs)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	e.UK = uk != 0
	if err := json.Unmarshal([]byte(attrs), &e.Attrs); err != nil {
		return nil, fmt.Errorf("attrs of %s: %w", key, err)
	}
	decode := func(raw string) ([]string, error) {
		var l []string
		return l, json.Unmarshal([]byte(raw), &l)
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT text, flags, pri FROM forms
		WHERE entry_id = ? AND deleted_at IS NULL ORDER BY ord, id`, e.ID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var (
			f     lexicon.Form
			flags string
		)
		if err = rows.Scan(&f.Text, &flags, &f.Pri); err == nil {
			f.Flags, err = decode(flags)
		}
		if err != nil {
			rows.Close()
			return nil, err
		}
		e.Forms = append(e.Forms, f)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, err
	}
	rows, err = tx.QueryContext(ctx, `
		SELECT type, value, plain, flags, pri FROM readings
		WHERE entry_id = ? AND deleted_at IS NULL ORDER BY ord, id`, e.ID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var (
			r     lexicon.Reading
			flags string
		)
		if err = rows.Scan(&r.Type, &r.Value, &r.Plain, &flags, &r.Pri); err == nil {
			r.Flags, err = decode(flags)
		}
		if err != nil {
			rows.Close()
			return nil, err
		}
		e.Readings = append(e.Readings, r)
	}
	if err := errors.Join(rows.Err(), rows.Close()); err != nil {
		return nil, err
	}
	return e, nil
}

// putMerged writes e like PutTx, except that an entry already in the
// lexicon keeps what other dictionaries gave it: its readings and
// ranking stay, e's forms are added after its own when absent, and its
// attrs merge (see mergeAttrs: e's dictionary owns the keys in owned).
// Put replaces forms and readings wholesale, so a dictionary that does
// not own them (Unihan on a hanzi CEDICT supplied the pinyin of) must
// merge instead of overwrite. Other dictionaries' senses survive Put
// itself.
func putMerged(ctx context.Context, tx *sql.Tx, store lexicon.Store, e *lexicon.Entry, dictID int64, owned []string) (int64, error) {
	old, err := existingEntry(ctx, tx, e.Language, e.Kind, e.Key)
	if err != nil {
		return 0, fmt.Errorf("load entry %s/%s/%s: %w", e.Language, e.Kind, e.Key, err)
	}
	if old != nil {
		e.Forms = unionForms(old.Forms, e.Forms)
		e.Readings = unionReadings(old.Readings, e.Readings)
		e.Pri, e.UK = old.Pri, old.UK
		e.Attrs = mergeAttrs(old.Attrs, e.Attrs, owned)
	}
	return store.PutTx(ctx, tx, e, dictID)
}

// putOwningAttrs writes e like PutTx — its forms, readings and ranking
// replace the stored ones — except for its attrs, which merge into the
// stored entry's (see mergeAttrs): Put replaces attrs wholesale, and an
// entry's attrs come from several dictionaries (a zh character's level
// attrs from Unihan, its readings from CEDICT).
func putOwningAttrs(ctx context.Context, tx *sql.Tx, store lexicon.Store, e *lexicon.Entry, dictID int64, owned []string) (int64, error) {
	var raw string
	err := tx.QueryRowContext(ctx, `
		SELECT attrs FROM entries
		WHERE language = ? AND kind = ? AND ext_key = ? AND deleted_at IS NULL`,
		e.Language, e.Kind, e.Key).Scan(&raw)
	switch {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		return 0, fmt.Errorf("load attrs of %s/%s/%s: %w", e.Language, e.Kind, e.Key, err)
	default:
		var old map[string]string
		if err := json.Unmarshal([]byte(raw), &old); err != nil {
			return 0, fmt.Errorf("attrs of %s/%s/%s: %w", e.Language, e.Kind, e.Key, err)
		}
		e.Attrs = mergeAttrs(old, e.Attrs, owned)
	}
	return store.PutTx(ctx, tx, e, dictID)
}

// mergeAttrs returns the attrs an entry holds after a dictionary that
// owns the keys in owned writes add over old: old's keys outside owned
// stay (other dictionaries' attrs), and the owned keys are exactly add's —
// an owned key add lacks is dropped, so a re-import of a newer source
// leaves no stale value. A dictionary writes only keys it owns.
func mergeAttrs(old, add map[string]string, owned []string) map[string]string {
	out := make(map[string]string, len(old)+len(add))
	for k, v := range old {
		if !slices.Contains(owned, k) {
			out[k] = v
		}
	}
	for k, v := range add {
		out[k] = v
	}
	return out
}

// unionForms returns base followed by the forms of add whose text base
// lacks.
func unionForms(base, add []lexicon.Form) []lexicon.Form {
	for _, f := range add {
		if !slices.ContainsFunc(base, func(x lexicon.Form) bool { return x.Text == f.Text }) {
			base = append(base, f)
		}
	}
	return base
}

// unionReadings returns base followed by the readings of add whose type
// and value base lacks.
func unionReadings(base, add []lexicon.Reading) []lexicon.Reading {
	for _, r := range add {
		if !slices.ContainsFunc(base, func(x lexicon.Reading) bool { return x.Type == r.Type && x.Value == r.Value }) {
			base = append(base, r)
		}
	}
	return base
}

// radicalEntryID returns the id of the character entry of the Kangxi
// radical n in language, creating a bare one when the lexicon has none;
// an existing entry is used as it is. who names the character classified
// under it for the error of a number outside 1-214.
func radicalEntryID(ctx context.Context, tx *sql.Tx, store lexicon.Store, language, who string, n int, cache map[string]int64) (int64, error) {
	radical, ok := kangxiRadicals[n]
	if !ok {
		return 0, fmt.Errorf("%s is under radical %d, outside the Kangxi radicals 1–214", who, n)
	}
	if id, ok := cache[radical]; ok {
		return id, nil
	}
	old, err := existingEntry(ctx, tx, language, "character", radical)
	if err != nil {
		return 0, fmt.Errorf("load entry %s: %w", radical, err)
	}
	var id int64
	if old != nil {
		id = old.ID
	} else if id, err = store.PutTx(ctx, tx, bareCharacter(language, radical), 0); err != nil {
		return 0, err
	}
	cache[radical] = id
	return id, nil
}

// kanjidic2LexiconEntry builds the lexicon entry of a KANJIDIC2
// character: Kind "character", Key and only form the character itself,
// its ON and KUN readings (typed "on" and "kun", Plain through the
// language pack), its level attrs (strokes, grade, freq, src "kd2";
// see kanjidic2Attrs), and one sense of its English meanings when it has
// any.
func kanjidic2LexiconEntry(e entry, language string) *lexicon.Entry {
	le := bareCharacter(language, e.Written)
	le.Readings = lexiconReadings(lang.For(language), e.Readings, false)
	for k, v := range e.Attrs {
		le.Attrs[k] = v
	}
	if len(e.Glosses) > 0 {
		le.Senses = []lexicon.Sense{{Glosses: e.Glosses}}
	}
	return le
}

// importKanjidic2Lexicon writes the KANJIDIC2 characters, each linked
// from the character to its classical Kangxi radical's character entry
// (a bare one is created when missing). It owns the kanjidic2AttrKeys of
// a character's attrs; other keys stay (see putOwningAttrs).
func importKanjidic2Lexicon(ctx context.Context, tx *sql.Tx, store lexicon.Store, dictID int64, m Manifest, es []entry) (Result, error) {
	var (
		result Result
		cache  = map[string]int64{}
	)
	for _, e := range es {
		le := kanjidic2LexiconEntry(e, m.Language)
		id, err := putOwningAttrs(ctx, tx, store, le, dictID, kanjidic2AttrKeys)
		if err != nil {
			return Result{}, err
		}
		result.Entries++
		result.Senses += len(le.Senses)
		if e.Radical == 0 {
			continue
		}
		radicalID, err := radicalEntryID(ctx, tx, store, m.Language, e.Written, e.Radical, cache)
		if err != nil {
			return Result{}, err
		}
		if err := store.LinkTx(ctx, tx, id, radicalID, lexicon.LinkRadical); err != nil {
			return Result{}, err
		}
	}
	return result, nil
}

// importUnihanLexicon writes a character entry for every hanzi the file
// mentions — a field key or a variant counterpart — in sorted order:
// the character as its only form, no readings, its level and stroke
// attrs (the unihanAttrKeys, see parseUnihanAttr), and its kDefinition
// as the one sense under the built-in unihan dictionary. Entries another
// dictionary supplied (CEDICT's readings and forms, other attrs) are
// merged, not overwritten (see putMerged). Simplified/traditional
// counterparts link as variants (both directions) and each character
// links to its Kangxi radical.
func importUnihanLexicon(ctx context.Context, tx *sql.Tx, store lexicon.Store, dictID int64, m Manifest, data UnihanData) (Result, error) {
	seen := make(map[string]bool, len(data.Radicals)+len(data.Definitions))
	for ch := range data.Radicals {
		seen[ch] = true
	}
	for ch := range data.Definitions {
		seen[ch] = true
	}
	for ch := range data.Attrs {
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
	chars := make([]string, 0, len(seen))
	for ch := range seen {
		chars = append(chars, ch)
	}
	slices.Sort(chars)

	var result Result
	ids := make(map[string]int64, len(chars))
	for _, ch := range chars {
		e := bareCharacter(m.Language, ch)
		maps.Copy(e.Attrs, data.Attrs[ch])
		if def, ok := data.Definitions[ch]; ok {
			e.Senses = []lexicon.Sense{{Glosses: []string{def}}}
			result.Senses++
		}
		id, err := putMerged(ctx, tx, store, e, dictID, unihanAttrKeys)
		if err != nil {
			return Result{}, err
		}
		ids[ch] = id
		result.Entries++
	}
	for _, field := range []map[string][]string{data.TradVariants, data.SimpVariants} {
		for _, ch := range chars {
			for _, v := range field[ch] {
				if v == ch {
					continue // a self-pair is not a variant
				}
				if err := store.LinkTx(ctx, tx, ids[ch], ids[v], lexicon.LinkVariant); err != nil {
					return Result{}, err
				}
			}
		}
	}
	cache := map[string]int64{}
	for _, ch := range chars {
		n, ok := data.Radicals[ch]
		if !ok {
			continue
		}
		radicalID, err := radicalEntryID(ctx, tx, store, m.Language, ch, n, cache)
		if err != nil {
			return Result{}, err
		}
		if err := store.LinkTx(ctx, tx, ids[ch], radicalID, lexicon.LinkRadical); err != nil {
			return Result{}, err
		}
	}
	return result, nil
}

// jsonLexiconEntries builds the lexicon entries of a dictionary.json:
// one per distinct (kind, written) in order of first appearance, so
// Result.Entries counts entries, not lines. Lines for one written form
// merge: forms and readings are unioned, and each line contributes its
// own sense.
func jsonLexiconEntries(es []entry, language string) []*lexicon.Entry {
	var (
		out []*lexicon.Entry
		at  = map[string]int{}
	)
	for _, e := range es {
		le := jsonLexiconEntry(e, language)
		key := le.Kind + "\x00" + le.Key
		i, seen := at[key]
		if !seen {
			at[key] = len(out)
			out = append(out, le)
			continue
		}
		m := out[i]
		m.Forms = unionForms(m.Forms, le.Forms)
		m.Readings = unionReadings(m.Readings, le.Readings)
		m.Senses = append(m.Senses, le.Senses...)
	}
	return out
}

// jsonLexiconEntry builds the lexicon entry of one dictionary.json
// line: Key = written, Kind as the pack gives it, the written form then
// its traditional twin (flag "trad") as forms, the readings as given
// with Plain and derived readings through the language pack, and one
// sense of the glosses when there are any.
func jsonLexiconEntry(e entry, language string) *lexicon.Entry {
	le := &lexicon.Entry{
		Language: language,
		Kind:     e.Kind,
		Key:      e.Written,
		Forms:    []lexicon.Form{{Text: e.Written}},
		Readings: lexiconReadings(lang.For(language), e.Readings, false),
		Attrs:    map[string]string{},
	}
	for _, trad := range e.Forms {
		le.Forms = append(le.Forms, lexicon.Form{Text: trad, Flags: []string{"trad"}})
	}
	if len(e.Glosses) > 0 {
		le.Senses = []lexicon.Sense{{Glosses: e.Glosses}}
	}
	return le
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
