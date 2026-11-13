package lexicon

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// CharacterRow is one character of a language's character universe (the
// cells of the mastery map) in compact form. A zero number or empty string
// means the field is absent.
type CharacterRow struct {
	ID   int64
	Char string // the entry's first written form (simplified for zh)

	Strokes int
	// ja (KANJIDIC2): grade, JLPT level on the old 1–4 scale, newspaper
	// frequency rank.
	Grade, JLPT, Freq int
	// zh (Unihan): 1 when in the 通用规范汉字表, GB2312 level (1|2), Hong
	// Kong primary grade. HKGrade is the lowest grade of the character and
	// its variant partners: Unihan grades the traditional form (愛), and
	// the partner shares the simplified cell (爱).
	TGHZ, GB, HKGrade int

	Reading  string   // first reading, at most MaxCharacterReading runes
	Gloss    string   // first gloss, at most MaxCharacterGloss runes
	Variants []string // written forms of the variant partners, deduplicated
}

// CharacterSet is a language's character universe. Stale reports a
// database seeded before the importers kept the level attrs: the set then
// comes from the fallback rule (see characterUniverses) and lacks the
// grade/level fields.
type CharacterSet struct {
	Rows  []CharacterRow
	Stale bool
}

// Rune caps of CharacterRow.Reading and Gloss; a longer value is cut and
// ends in "…".
const (
	MaxCharacterReading = 16
	MaxCharacterGloss   = 48
)

// characterUniverse is how one language picks its characters, as
// conditions over entries e: marker is the attr condition a current seed
// sets; where selects the universe when some character carries the
// marker, stale when none does (an old database). reading is the
// expression of the first reading (scalar subqueries on e).
type characterUniverse struct {
	marker, where, stale, reading string
}

// characterUniverses are the languages with a character universe.
//   - ja: every KANJIDIC2 character (src = kd2). Stale: every character
//     with a stroke count or an on/kun reading, which KANJIDIC2 gave
//     before src existed.
//   - zh: every character on the 通用规范汉字表 (tghz = 1) or with a
//     pinyin reading (a CC-CEDICT line). Stale: the pinyin rule alone.
//
// The first reading is ja's first on reading, else its first kun; zh's
// first pinyin.
var characterUniverses = map[string]characterUniverse{
	"ja": {
		marker: `json_extract(e.attrs, '$.src') = 'kd2'`,
		where:  `json_extract(e.attrs, '$.src') = 'kd2'`,
		stale: `(json_extract(e.attrs, '$.strokes') IS NOT NULL OR EXISTS (
			SELECT 1 FROM readings r
			WHERE r.entry_id = e.id AND r.type IN ('on', 'kun') AND r.deleted_at IS NULL))`,
		reading: `COALESCE(` + fmt.Sprintf(firstReadingOf, "on") + `, ` + fmt.Sprintf(firstReadingOf, "kun") + `)`,
	},
	"zh": {
		marker: `json_extract(e.attrs, '$.tghz') = '1'`,
		where: `(json_extract(e.attrs, '$.tghz') = '1' OR EXISTS (
			SELECT 1 FROM readings r
			WHERE r.entry_id = e.id AND r.type = 'pinyin' AND r.deleted_at IS NULL))`,
		stale: `EXISTS (
			SELECT 1 FROM readings r
			WHERE r.entry_id = e.id AND r.type = 'pinyin' AND r.deleted_at IS NULL)`,
		reading: fmt.Sprintf(firstReadingOf, "pinyin"),
	},
}

// firstReadingOf is e's first live reading of type %s, in reading order:
// the walk of e's reading index stops at the first match, no sort.
const firstReadingOf = `(SELECT r.value FROM readings r
	WHERE r.entry_id = e.id AND r.deleted_at IS NULL AND r.type = '%s'
	ORDER BY r.ord, r.id LIMIT 1)`

// HasCharacterUniverse reports whether language has a character universe
// (ja, zh); Characters of any other language is empty.
func HasCharacterUniverse(language string) bool {
	_, ok := characterUniverses[language]
	return ok
}

// liveCharacters is the prefix every universe condition extends: the
// language's live characters, a walk of the (language, kind) prefix of
// the entries key.
const liveCharacters = `
	FROM entries e
	WHERE e.language = ? AND e.kind = 'character' AND e.deleted_at IS NULL`

// firstFormOf is the first live written form of the entry aliased %s.
const firstFormOf = `(SELECT f.text FROM forms f
	WHERE f.entry_id = %[1]s.id AND f.deleted_at IS NULL
	ORDER BY f.ord, f.id LIMIT 1)`

// characterMarkerQuery reports whether any live character of the language
// (bound) carries the universe's marker; it stops at the first.
func characterMarkerQuery(language string) (string, bool) {
	u, ok := characterUniverses[language]
	if !ok {
		return "", false
	}
	return `SELECT EXISTS (SELECT 1 ` + liveCharacters + ` AND ` + u.marker + `)`, true
}

// charactersQuery is the one statement that lists a language's universe
// (the stale rule when stale), bound to the language: per character its
// attrs, first form, first reading, first gloss (the first non-empty live
// sense of a live dictionary, in dictionary then sense order) and its
// variant partners (links of both directions, live on both ends) as a
// JSON array of [id, form, hkgrade]. Each per-row value is an index seek
// on the child table's entry index.
func charactersQuery(language string, stale bool) (string, bool) {
	u, ok := characterUniverses[language]
	if !ok {
		return "", false
	}
	where := u.where
	if stale {
		where = u.stale
	}
	partner := func(near, far string) string {
		return `SELECT t.id AS id, COALESCE(` + fmt.Sprintf(firstFormOf, "t") + `, t.ext_key) AS text,
				json_extract(t.attrs, '$.hkgrade') AS hk
			FROM entry_links l
			JOIN entries t ON t.id = l.` + far + ` AND t.deleted_at IS NULL
			WHERE l.` + near + ` = e.id AND l.type = 'variant' AND l.deleted_at IS NULL`
	}
	return `
		SELECT e.id,
			COALESCE(` + fmt.Sprintf(firstFormOf, "e") + `, e.ext_key),
			e.attrs,
			` + u.reading + `,
			(SELECT json_extract(s.glosses, '$[0]') FROM senses s
				JOIN dictionaries d ON d.id = s.dictionary_id AND d.deleted_at IS NULL
				WHERE s.entry_id = e.id AND s.deleted_at IS NULL AND json_array_length(s.glosses) > 0
				ORDER BY s.dictionary_id, s.ord, s.id LIMIT 1),
			(SELECT json_group_array(json_array(v.id, v.text, v.hk)) FROM (
				` + partner("from_id", "to_id") + `
				UNION ALL
				` + partner("to_id", "from_id") + `
			) v)` + liveCharacters + `
			AND ` + where, true
}

// charactersVersionQuery reads the latest stamp and id of every table a
// character list reads from that can change without its entry's stamp:
// entries (whose Put also stamps its forms, readings and senses), links
// and dictionaries (an uninstall changes glosses but no entry). Every
// write stamps updated_at; every insert raises the max id. Each value is
// one seek at an end of an index or the rowid.
const charactersVersionQuery = `
	SELECT
		(SELECT COALESCE(MAX(updated_at), '') FROM entries),
		(SELECT COALESCE(MAX(id), 0) FROM entries),
		(SELECT COALESCE(MAX(updated_at), '') FROM entry_links),
		(SELECT COALESCE(MAX(rowid), 0) FROM entry_links),
		(SELECT COALESCE(MAX(updated_at), '') FROM dictionaries),
		(SELECT COALESCE(MAX(id), 0) FROM dictionaries)`

// CharactersVersion returns a value that changes on every write that can
// change any language's Characters result, in a few index seeks: callers
// cache a list under it. Read it before the list, so a write in between
// leaves the version older than the list, never newer. Stamps have
// second resolution: an update (not an insert) committed in the same
// second as the previous latest stamp can go unnoticed until the next
// write.
func (s Store) CharactersVersion(ctx context.Context) (string, error) {
	var (
		entryStamp, linkStamp, dictStamp string
		entryID, linkID, dictID          int64
	)
	if err := s.DB.QueryRowContext(ctx, charactersVersionQuery).Scan(
		&entryStamp, &entryID, &linkStamp, &linkID, &dictStamp, &dictID); err != nil {
		return "", fmt.Errorf("characters version: %w", err)
	}
	return fmt.Sprintf("%s/%d/%s/%d/%s/%d", entryStamp, entryID, linkStamp, linkID, dictStamp, dictID), nil
}

// Characters returns language's character universe (see
// characterUniverses) in code point order of the written form, then id.
// A language without a universe gets an empty set. Rows is never nil.
func (s Store) Characters(ctx context.Context, language string) (CharacterSet, error) {
	set := CharacterSet{Rows: []CharacterRow{}}
	marker, ok := characterMarkerQuery(language)
	if !ok {
		return set, nil
	}
	var current bool
	if err := s.DB.QueryRowContext(ctx, marker, language).Scan(&current); err != nil {
		return CharacterSet{}, fmt.Errorf("characters %s: %w", language, err)
	}
	set.Stale = !current
	query, _ := charactersQuery(language, set.Stale)
	rows, err := s.DB.QueryContext(ctx, query, language)
	if err != nil {
		return CharacterSet{}, fmt.Errorf("characters %s: %w", language, err)
	}
	err = eachRow(rows, func() error {
		var (
			r                        CharacterRow
			attrs                    string
			reading, gloss, variants *string
		)
		if err := rows.Scan(&r.ID, &r.Char, &attrs, &reading, &gloss, &variants); err != nil {
			return err
		}
		if !isHan(r.Char) {
			return nil
		}
		var a characterAttrs
		if err := json.Unmarshal([]byte(attrs), &a); err != nil {
			return fmt.Errorf("attrs of entry %d: %w", r.ID, err)
		}
		r.Strokes = positiveInt(a.Strokes)
		r.Grade, r.JLPT, r.Freq = positiveInt(a.Grade), positiveInt(a.JLPT), positiveInt(a.Freq)
		r.TGHZ, r.GB, r.HKGrade = positiveInt(a.TGHZ), positiveInt(a.GB), positiveInt(a.HKGrade)
		if reading != nil {
			r.Reading = cutRunes(*reading, MaxCharacterReading)
		}
		if gloss != nil {
			r.Gloss = cutRunes(*gloss, MaxCharacterGloss)
		}
		if variants != nil && *variants != "[]" {
			if err := r.addVariants(*variants); err != nil {
				return fmt.Errorf("variants of entry %d: %w", r.ID, err)
			}
		}
		set.Rows = append(set.Rows, r)
		return nil
	})
	if err != nil {
		return CharacterSet{}, fmt.Errorf("characters %s: %w", language, err)
	}
	slices.SortFunc(set.Rows, func(a, b CharacterRow) int {
		return cmp.Or(strings.Compare(a.Char, b.Char), cmp.Compare(a.ID, b.ID))
	})
	return set, nil
}

// characterAttrs are the attrs keys a CharacterRow reads (decoding into a
// struct skips the map allocations of a full attrs decode).
type characterAttrs struct {
	Strokes string `json:"strokes"`
	Grade   string `json:"grade"`
	JLPT    string `json:"jlpt"`
	Freq    string `json:"freq"`
	TGHZ    string `json:"tghz"`
	GB      string `json:"gb"`
	HKGrade string `json:"hkgrade"`
}

// addVariants sets r.Variants from the [id, form, hkgrade] partner array:
// forms in partner id order, without r itself, its own form and
// duplicates. r.HKGrade becomes the lowest grade of r and its partners.
func (r *CharacterRow) addVariants(raw string) error {
	var partners [][3]any
	if err := json.Unmarshal([]byte(raw), &partners); err != nil {
		return err
	}
	type partner struct {
		id   int64
		text string
		hk   int
	}
	list := make([]partner, 0, len(partners))
	for _, p := range partners {
		id, _ := p[0].(float64)
		text, _ := p[1].(string)
		hk, _ := p[2].(string)
		if int64(id) != r.ID {
			list = append(list, partner{int64(id), text, positiveInt(hk)})
		}
	}
	slices.SortFunc(list, func(a, b partner) int { return cmp.Compare(a.id, b.id) })
	for _, p := range list {
		if p.hk > 0 && (r.HKGrade == 0 || p.hk < r.HKGrade) {
			r.HKGrade = p.hk
		}
		if p.text != "" && p.text != r.Char && !slices.Contains(r.Variants, p.text) {
			r.Variants = append(r.Variants, p.text)
		}
	}
	return nil
}

// isHan reports whether s is one Han character. CC-CEDICT has a few
// single-letter lines (A, B, □, ○) that are character entries with a
// pinyin reading but no place in a Hanzi grid; the ideographic marks
// 々 and 〇 and the Suzhou numerals are Han and stay.
func isHan(s string) bool {
	r, size := utf8.DecodeRuneInString(s)
	return size == len(s) && unicode.Is(unicode.Han, r)
}

// positiveInt parses s as a positive decimal integer, or returns 0, so a
// malformed attr value is left out rather than sent.
func positiveInt(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return 0
	}
	return n
}

// cutRunes returns s, or its first max-1 runes and "…" when s is longer
// than max runes.
func cutRunes(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	return string(runes[:max-1]) + "…"
}
