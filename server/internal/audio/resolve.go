package audio

import (
	"context"
	"database/sql"
	"fmt"

	"qinqin/internal/pinyin"
)

// maxSyllableQueries bounds the distinct syllable lookups of one Resolve call.
const maxSyllableQueries = 64

// Clip is one stored recording with its credit.
type Clip struct {
	SHA, Ext, PackID, License, Attribution, Source string
}

// Resolution is what an entry can play. Syllables has one entry per
// reading passed to Resolve, in order: the clips of that reading's
// syllables in sequence, or nil when any syllable has no clip (or the
// reading is not pinyin). It is always nil for languages other than zh.
type Resolution struct {
	Terms     []Clip
	Syllables [][]Clip
}

// Resolve finds the clips for an entry: term clips matching its written
// form and first reading across active packs in import order, and for zh
// a syllable sequence per reading.
func Resolve(ctx context.Context, sqlDB *sql.DB, language, written string, readings []string) (Resolution, error) {
	var res Resolution
	// Rows without a reading match under any; with no readable first reading
	// only those match.
	key := ""
	if len(readings) > 0 {
		key = ReadingKey(language, readings[0])
	}
	terms, err := query(ctx, sqlDB, KindTerm, written, key)
	if err != nil {
		return Resolution{}, err
	}
	res.Terms = terms
	if language != "zh" {
		return res, nil
	}
	res.Syllables = make([][]Clip, len(readings))
	// A request may name many readings (the batch route takes 200 entries): each
	// distinct syllable is looked up once, and at most maxSyllableQueries of them,
	// the rest of the readings simply get no sequence.
	lookups := map[string]*Clip{}
	budget := maxSyllableQueries
	lookup := func(syl string) (*Clip, bool, error) {
		if c, ok := lookups[syl]; ok {
			return c, true, nil
		}
		if budget == 0 {
			return nil, false, nil
		}
		budget--
		found, err := query(ctx, sqlDB, KindSyllable, "", syl)
		if err != nil {
			return nil, false, err
		}
		var c *Clip
		if len(found) > 0 {
			c = &found[0]
		}
		lookups[syl] = c
		return c, true, nil
	}
	for i, reading := range readings {
		syls, err := pinyin.ToNumbered(reading)
		if err != nil {
			continue
		}
		seq := make([]Clip, 0, len(syls))
		for _, syl := range syls {
			c, ok, err := lookup(syl)
			if err != nil {
				return Resolution{}, err
			}
			if !ok || c == nil {
				seq = nil
				break
			}
			seq = append(seq, *c)
		}
		res.Syllables[i] = seq
	}
	return res, nil
}

// query returns the clips of a kind, form and reading key, those matching
// the key exactly before reading-less ones, each group in pack import order.
func query(ctx context.Context, sqlDB *sql.DB, kind, form, key string) ([]Clip, error) {
	rows, err := sqlDB.QueryContext(ctx, `
		SELECT c.sha256, c.ext, p.pack_id, c.license, c.attribution, c.source
		FROM audio_clips c JOIN audio_packs p ON p.id = c.pack_id
		WHERE c.kind = ? AND c.form = ? AND c.reading_key IN (?, '') AND p.deleted_at IS NULL
		ORDER BY (c.reading_key = ''), p.id, c.id`, kind, form, key)
	if err != nil {
		return nil, fmt.Errorf("audio: resolve %s %q: %w", kind, form, err)
	}
	defer rows.Close()
	var out []Clip
	for rows.Next() {
		var c Clip
		if err := rows.Scan(&c.SHA, &c.Ext, &c.PackID, &c.License, &c.Attribution, &c.Source); err != nil {
			return nil, fmt.Errorf("audio: scan clip: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
