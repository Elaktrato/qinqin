package lookup

import (
	"context"

	"qinqin/internal/lexicon"
)

// Cache memoises the store reads of one request that runs many lookups (a
// segmentation looks up every position of a text, and the same kana
// prefixes recur in every sentence): entries by written form and by
// reading, frequencies per entry, retired entries and dictionary names.
// It changes no result, only how often the database is asked. One cache
// serves one language and one request; nil in Lang means no memo. Not safe
// for concurrent use.
type Cache struct {
	forms, readings map[string][]lexicon.Entry
	freqs           map[int64][]Frequency
	packIDs         []int64
	packsKnown      bool
	retired         map[int64]bool
	names           map[int64]string
}

// NewCache returns an empty request cache.
func NewCache() *Cache {
	return &Cache{
		forms: map[string][]lexicon.Entry{}, readings: map[string][]lexicon.Entry{},
		freqs: map[int64][]Frequency{}, retired: map[int64]bool{}, names: map[int64]string{},
	}
}

// memo returns load(keys) through memo: only the keys memo lacks are
// loaded, and every one of them is remembered (absent ones as nil).
func memo(memo map[string][]lexicon.Entry, keys []string, load func([]string) (map[string][]lexicon.Entry, error)) (map[string][]lexicon.Entry, error) {
	if memo == nil {
		return load(keys)
	}
	var missing []string
	for _, k := range keys {
		if _, ok := memo[k]; !ok {
			missing = append(missing, k)
		}
	}
	if len(missing) > 0 {
		got, err := load(missing)
		if err != nil {
			return nil, err
		}
		for _, k := range missing {
			memo[k] = got[k]
		}
	}
	out := make(map[string][]lexicon.Entry, len(keys))
	for _, k := range keys {
		if es := memo[k]; len(es) > 0 {
			out[k] = es
		}
	}
	return out, nil
}

// byForm is Lexicon.ByForm through the cache.
func (s Service) byForm(ctx context.Context, l Lang, forms []string) (map[string][]lexicon.Entry, error) {
	var m map[string][]lexicon.Entry
	if l.Cache != nil {
		m = l.Cache.forms
	}
	return memo(m, forms, func(keys []string) (map[string][]lexicon.Entry, error) {
		return s.Lexicon.ByForm(ctx, l.Code, keys)
	})
}

// byReadingWord is Lexicon.ByReadingKind for words through the cache.
func (s Service) byReadingWord(ctx context.Context, l Lang, plains []string) (map[string][]lexicon.Entry, error) {
	var m map[string][]lexicon.Entry
	if l.Cache != nil {
		m = l.Cache.readings
	}
	return memo(m, plains, func(keys []string) (map[string][]lexicon.Entry, error) {
		return s.Lexicon.ByReadingKind(ctx, l.Code, kindWord, keys)
	})
}

// cachedFrequencies is frequencies through the cache: the packs are read
// once and each entry's frequencies once per request.
func (s Service) cachedFrequencies(ctx context.Context, l Lang, es []lexicon.Entry) ([][]Frequency, []int64) {
	c := l.Cache
	if c == nil {
		return s.frequencies(ctx, l.Code, es)
	}
	var missing []lexicon.Entry
	for _, e := range es {
		if _, ok := c.freqs[e.ID]; !ok {
			missing = append(missing, e)
		}
	}
	if len(missing) > 0 || !c.packsKnown {
		got, packIDs := s.frequencies(ctx, l.Code, missing)
		c.packIDs, c.packsKnown = packIDs, true
		for i, e := range missing {
			c.freqs[e.ID] = got[i]
		}
	}
	out := make([][]Frequency, len(es))
	for i, e := range es {
		out[i] = c.freqs[e.ID]
	}
	return out, c.packIDs
}

// retiredOf is the remembered retired state of an entry without an active
// sense; false, false without a cache or when not yet asked.
func (c *Cache) retiredOf(id int64) (retired, ok bool) {
	if c == nil {
		return false, false
	}
	retired, ok = c.retired[id]
	return retired, ok
}
