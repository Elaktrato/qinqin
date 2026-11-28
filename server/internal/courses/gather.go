package courses

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"

	"qinqin/internal/freq"
	"qinqin/internal/grammar"
	"qinqin/internal/levels"
	"qinqin/internal/lexicon"
	"qinqin/internal/topics"
)

// maxEstimateWords caps the frequency rows a level estimate resolves (the last cut-off, at most this many).
const maxEstimateWords = 20000

// readingTypes are the reading types a course word shows, best first.
var readingTypes = []string{"pinyin", "kana"}

// gathered is what Fill reads from the installed packs, and the fingerprint of all of it.
type gathered struct {
	in          Input
	fingerprint string
}

// wordOf is the course word of an entry: its key, display form and first pinyin or kana reading.
func wordOf(e lexicon.Entry) ListWord {
	w := ListWord{Key: e.Key, Form: e.Headword(), EntryID: e.ID}
	rs := append([]lexicon.Reading(nil), e.Readings...)
	sort.SliceStable(rs, func(i, j int) bool { return rs[i].Ord < rs[j].Ord })
	for _, typ := range readingTypes {
		for _, r := range rs {
			if r.Type == typ {
				w.Reading = r.Value
				return w
			}
		}
	}
	if len(rs) > 0 {
		w.Reading = rs[0].Value
	}
	return w
}

// entries loads entries by id, in the order of ids, skipping ids no live entry has.
func entries(ctx context.Context, store lexicon.Store, ids []int64) ([]lexicon.Entry, error) {
	const chunk = 500
	byID := map[int64]lexicon.Entry{}
	for at := 0; at < len(ids); at += chunk {
		es, err := store.GetMany(ctx, ids[at:min(at+chunk, len(ids))])
		if err != nil {
			return nil, err
		}
		for _, e := range es {
			byID[e.ID] = e
		}
	}
	out := make([]lexicon.Entry, 0, len(ids))
	for _, id := range ids {
		if e, ok := byID[id]; ok {
			out = append(out, e)
		}
	}
	return out, nil
}

// gather reads the inputs of a course's fill from the installed packs (README "Inputs"): the course's level scheme,
// else the frequency estimate; the ranks of the language's first frequency pack; the topic labels; the installed
// grammar points.
func gather(ctx context.Context, sqlDB *sql.DB, p Pack, c *Course) (gathered, error) {
	store := lexicon.Store{DB: sqlDB}
	fs := freq.Store{DB: sqlDB}
	lexVersion, err := store.CharactersVersion(ctx)
	if err != nil {
		return gathered{}, err
	}
	fp := []string{"course:" + p.hash, "lexicon:" + lexVersion}
	var g gathered

	// The frequency pack: the first live pack of the language in priority order.
	var fpack *freq.PackInfo
	packs, err := fs.Packs(ctx)
	if err != nil {
		return gathered{}, err
	}
	for i := range packs {
		if strings.EqualFold(packs[i].Language, c.Language) {
			fpack = &packs[i]
			break
		}
	}
	if fpack != nil {
		fp = append(fp, fmt.Sprintf("frequency:%s:%d:%s", fpack.PackID, fpack.ID, fpack.ContentHash))
	}

	scheme := ""
	if c.Levels != nil {
		scheme = c.Levels.Scheme
	}
	var words levels.Words
	if scheme != "" {
		words, err = levels.SchemeWords(ctx, sqlDB, scheme, c.Language)
		if err != nil && !errors.Is(err, levels.ErrNotFound) {
			return gathered{}, err
		}
	}
	switch {
	case err == nil && scheme != "":
		fp = append(fp, fmt.Sprintf("levels:%s:%d:%s", scheme, words.SchemeID, words.Version))
		li := &LevelInput{Pack: scheme}
		var all []lexicon.Entry
		for _, lv := range words.Levels {
			es, err := entries(ctx, store, lv.EntryIDs)
			if err != nil {
				return gathered{}, err
			}
			ws := make([]ListWord, 0, len(es))
			for _, e := range es {
				ws = append(ws, wordOf(e))
			}
			li.Levels = append(li.Levels, struct {
				Name  string     `json:"name"`
				Words []ListWord `json:"words"`
			}{lv.Name, ws})
			all = append(all, es...)
		}
		g.in.Levels = li
		if fpack != nil {
			if g.in.Frequency, err = ranksOf(ctx, fs, *fpack, all); err != nil {
				return gathered{}, err
			}
		}
	case fpack != nil && c.Levels != nil && len(c.Levels.Estimate) > 0:
		size := min(c.Levels.Estimate[len(c.Levels.Estimate)-1], maxEstimateWords)
		top, err := fs.Top(ctx, freq.StarterResolver{Lexicon: store}, *fpack, size)
		if err != nil {
			return gathered{}, err
		}
		ids := make([]int64, len(top))
		for i, t := range top {
			ids[i] = t.EntryID
		}
		es, err := entries(ctx, store, ids)
		if err != nil {
			return gathered{}, err
		}
		byID := map[int64]lexicon.Entry{}
		for _, e := range es {
			byID[e.ID] = e
		}
		fi := &FrequencyInput{Pack: fpack.PackID, Rows: []RankedWord{}}
		for _, t := range top {
			if e, ok := byID[t.EntryID]; ok {
				w := wordOf(e)
				w.Form = freq.Written(e, t)
				fi.Rows = append(fi.Rows, RankedWord{ListWord: w, Rank: t.Rank})
			}
		}
		g.in.Frequency = fi
	}

	if labels, err := topics.Load(c.Language); err != nil {
		return gathered{}, err
	} else if labels != nil {
		g.in.Topics = labels.TopicsForKey
	}

	gps, err := grammar.ListPacks(ctx, sqlDB, c.Language)
	if err != nil {
		return gathered{}, err
	}
	g.in.Grammar = map[string]bool{}
	for _, gp := range gps {
		fp = append(fp, "grammar:"+gp.PackID+":"+gp.Version)
		for _, l := range gp.Lessons {
			g.in.Grammar[gp.PackID+":"+l.ID] = true
		}
	}
	sum := sha256.Sum256([]byte(strings.Join(fp, "\n")))
	g.fingerprint = hex.EncodeToString(sum[:])
	return g, nil
}

// ranksOf looks up the frequency ranks of entries in the pack: the best rank of any of an entry's written forms
// (a word without forms: its kana readings), with its kana readings for Japanese.
func ranksOf(ctx context.Context, fs freq.Store, p freq.PackInfo, es []lexicon.Entry) (*FrequencyInput, error) {
	var terms []string
	readings := map[string][]string{}
	termsOf := func(e lexicon.Entry) ([]string, []string) {
		var ts, rs []string
		for _, f := range e.Forms {
			ts = append(ts, f.Text)
		}
		for _, r := range e.Readings {
			if r.Type == "kana" {
				rs = append(rs, r.Value)
			}
		}
		if len(ts) == 0 {
			ts = rs
		}
		return ts, rs
	}
	for _, e := range es {
		ts, rs := termsOf(e)
		terms = append(terms, ts...)
		for _, t := range ts {
			readings[t] = append(readings[t], rs...)
		}
	}
	hits, err := fs.Lookup(ctx, terms, readings)
	if err != nil {
		return nil, err
	}
	fi := &FrequencyInput{Pack: p.PackID, Rows: []RankedWord{}}
	for _, e := range es {
		best := 0
		ts, _ := termsOf(e)
		for _, t := range ts {
			for _, h := range hits[t] {
				if h.PackID == p.ID && (best == 0 || h.Rank < best) {
					best = h.Rank
				}
			}
		}
		if best > 0 {
			fi.Rows = append(fi.Rows, RankedWord{ListWord: wordOf(e), Rank: best})
		}
	}
	return fi, nil
}

// Answer is the body of GET /api/courses/{id}: the pack's credits, the fill's hash and the filled course.
type Answer struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
	// Fill identifies the filled content: it changes exactly when the answer does (the route's ETag).
	Fill string `json:"fill"`
	Filled
}

// Served is one cached answer.
type Served struct {
	Body []byte
	Fill string
}

// Cache fills courses on demand and keeps each answer while its inputs' fingerprint holds (per server, in memory).
// The zero value is ready to use.
type Cache struct {
	mu      sync.Mutex
	entries map[string]cacheEntry
}

type cacheEntry struct {
	fingerprint string
	served      Served
}

// Get returns the filled course packID: from the cache when nothing it was filled from changed, else filled anew
// (and its unplaced words logged). An unknown or uninstalled course is ErrNotFound.
func (c *Cache) Get(ctx context.Context, sqlDB *sql.DB, packID string) (Served, error) {
	p, err := get(ctx, sqlDB, packID)
	if err != nil {
		return Served{}, err
	}
	course, err := Parse([]byte(p.raw))
	if err != nil {
		return Served{}, fmt.Errorf("courses: stored course %s: %w", packID, err)
	}
	// One fill at a time: a fill reads a few thousand rows, and two requests for a changed course fill it once.
	c.mu.Lock()
	defer c.mu.Unlock()
	g, err := gather(ctx, sqlDB, p, course)
	if err != nil {
		return Served{}, fmt.Errorf("courses: gather %s: %w", packID, err)
	}
	fingerprint := g.fingerprint + "\n" + p.Name + "\n" + p.Version + "\n" + p.License + "\n" + p.Attribution + "\n" + p.Notice
	if e, ok := c.entries[packID]; ok && e.fingerprint == fingerprint {
		return e.served, nil
	}
	filled := Fill(course, g.in)
	raw, err := json.Marshal(filled)
	if err != nil {
		return Served{}, err
	}
	sum := sha256.Sum256(append(raw, fingerprint...))
	a := Answer{ID: p.ID, Name: p.Name, Version: p.Version, License: p.License, Attribution: p.Attribution, Notice: p.Notice,
		Fill: hex.EncodeToString(sum[:8]), Filled: filled}
	body, err := json.Marshal(a)
	if err != nil {
		return Served{}, err
	}
	if n := len(filled.Unplaced); n > 0 {
		keys := make([]string, 0, min(n, 20))
		for _, u := range filled.Unplaced[:min(n, 20)] {
			keys = append(keys, u.Form)
		}
		log.Printf("courses: %s: %d of %d words could not be placed (%s): %s", packID, n, filled.Counts.Candidates, ReasonCharacterLater, strings.Join(keys, " "))
	}
	if c.entries == nil {
		c.entries = map[string]cacheEntry{}
	}
	served := Served{Body: body, Fill: a.Fill}
	c.entries[packID] = cacheEntry{fingerprint: fingerprint, served: served}
	return served, nil
}
