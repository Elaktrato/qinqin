package lexicon

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"qinqin/internal/pinyin"
)

// pinyinMaxWord is the longest written form, in characters, Pinyin tries
// at one position.
const pinyinMaxWord = 8

// pinyinQuery returns, for each candidate form, the pinyin readings of
// the active zh entries written with it: the best-ranked entry first,
// then its readings in order. The %s is the IN list.
const pinyinQuery = `
	SELECT f.text, r.value FROM forms f
	CROSS JOIN entries e ON e.id = f.entry_id
	JOIN readings r ON r.entry_id = e.id
	WHERE f.text IN (%s) AND f.deleted_at IS NULL
	  AND e.language = 'zh' AND e.deleted_at IS NULL
	  AND r.type = 'pinyin' AND r.deleted_at IS NULL
	ORDER BY f.text, e.pri DESC, e.id, r.ord`

// Pinyin returns the toneless pinyin of the Han characters in text, one
// space between syllables (紅樓夢 → "hong lou meng"). At each position
// the longest written form (up to 8 characters) of an active zh entry
// wins, so a word reads as the dictionary reads it and any other
// character reads on its own; a form shared by several entries takes the
// highest-priority entry's first pinyin reading. Characters without an
// entry, and everything that is not Han, are skipped. Text with nothing
// to convert gives "".
func (s Store) Pinyin(ctx context.Context, text string) (string, error) {
	var runs [][]rune
	var cur []rune
	for _, r := range text {
		if unicode.Is(unicode.Han, r) {
			cur = append(cur, r)
			continue
		}
		if len(cur) > 0 {
			runs, cur = append(runs, cur), nil
		}
	}
	if len(cur) > 0 {
		runs = append(runs, cur)
	}
	seen := map[string]bool{}
	var keys []string
	for _, run := range runs {
		for i := range run {
			for j := i + 1; j <= min(len(run), i+pinyinMaxWord); j++ {
				if k := string(run[i:j]); !seen[k] {
					seen[k] = true
					keys = append(keys, k)
				}
			}
		}
	}
	readings := map[string]string{}
	for start := 0; start < len(keys); start += childChunk {
		chunk := keys[start:min(start+childChunk, len(keys))]
		args := make([]any, len(chunk))
		for i, k := range chunk {
			args[i] = k
		}
		rows, err := s.DB.QueryContext(ctx, fmt.Sprintf(pinyinQuery, placeholders(len(chunk))), args...)
		if err != nil {
			return "", fmt.Errorf("pinyin of %q: %w", text, err)
		}
		err = eachRow(rows, func() error {
			var form, value string
			if err := rows.Scan(&form, &value); err != nil {
				return err
			}
			if _, ok := readings[form]; !ok {
				readings[form] = value
			}
			return nil
		})
		if err != nil {
			return "", fmt.Errorf("pinyin of %q: %w", text, err)
		}
	}
	var out []string
	for _, run := range runs {
		for i := 0; i < len(run); {
			n := 1
			value, ok := "", false
			for j := min(len(run), i+pinyinMaxWord); j > i; j-- {
				if value, ok = readings[string(run[i:j])]; ok {
					n = j - i
					break
				}
			}
			if ok {
				for _, syl := range strings.Fields(value) {
					if p := pinyin.Plain(syl); p != "" {
						out = append(out, p)
					}
				}
			}
			i += n
		}
	}
	return strings.Join(out, " "), nil
}
