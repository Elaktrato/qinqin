package freq

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"qinqin/internal/lexicon"
)

// Resolver resolves a word as a list gives it (written form, optional
// reading) to one word entry id; lexicon.Store implements it.
type Resolver interface {
	BestWordReadingID(ctx context.Context, language, form, reading string) (int64, error)
}

// StarterResolver is the resolution of starter decks: a kana row (no
// reading, or the reading equal to the term, the term written only in
// hiragana, katakana and the prolonged mark) first takes the kana-only
// word with a priority (lexicon.Store.KanaOnlyWordID), then, like every
// other row, the level-word rule (BestWordReadingID). Without the first
// step の, で resolve to the usually-kana 乃, 出 and the particles never
// appear; levels keep the level-word rule unchanged.
type StarterResolver struct{ Lexicon lexicon.Store }

// BestWordReadingID implements Resolver.
func (r StarterResolver) BestWordReadingID(ctx context.Context, language, form, reading string) (int64, error) {
	if (reading == "" || reading == form) && lexicon.AllKana(form) {
		id, err := r.Lexicon.KanaOnlyWordID(ctx, language, form)
		if !errors.Is(err, lexicon.ErrNotFound) {
			return id, err
		}
	}
	return r.Lexicon.BestWordReadingID(ctx, language, form, reading)
}

// TopEntry is one word of a starter deck: the entry, the rank of the
// pack row that took it and that row's term (how the list writes it).
type TopEntry struct {
	EntryID int64
	Rank    int
	Term    string
	row     int // position of that row in the rank walk, 0-based
}

// Written is the form a starter deck word is shown and snapshotted as:
// the entry's display form with the row's term as the list form, so a
// kana row shows its kana (contract: frequency/display-form.json).
func Written(e lexicon.Entry, t TopEntry) string { return e.DisplayForm(t.Term) }

// rowCap is how many pack rows a deck of size entries walks at most.
func rowCap(size int) int { return 4 * size }

// Top resolves the pack's first size distinct word entries by rank, then
// row position, stopping after 4*size rows; unresolved rows and entries
// already taken by a better row are skipped. A deck can hold fewer than
// size entries. Contract: docs/contracts/frequency/starter-resolution.json.
func (s Store) Top(ctx context.Context, r Resolver, pack PackInfo, size int) ([]TopEntry, error) {
	if size <= 0 {
		return nil, nil
	}
	rows, err := s.DB.QueryContext(ctx, `
		SELECT term, reading, rank FROM frequency WHERE pack_id = ?
		ORDER BY rank, rowid LIMIT ?`, pack.ID, rowCap(size))
	if err != nil {
		return nil, fmt.Errorf("top of frequency pack %s: %w", pack.PackID, err)
	}
	type termRow struct {
		term, reading string
		rank          int
	}
	var walk []termRow
	for rows.Next() {
		var tr termRow
		if err := rows.Scan(&tr.term, &tr.reading, &tr.rank); err != nil {
			rows.Close()
			return nil, fmt.Errorf("top of frequency pack %s: %w", pack.PackID, err)
		}
		walk = append(walk, tr)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("top of frequency pack %s: %w", pack.PackID, err)
	}

	language := strings.ToLower(pack.Language)
	taken := map[int64]bool{}
	out := []TopEntry{}
	for i, tr := range walk {
		id, err := r.BestWordReadingID(ctx, language, tr.term, tr.reading)
		if errors.Is(err, lexicon.ErrNotFound) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("top of frequency pack %s: %w", pack.PackID, err)
		}
		if taken[id] {
			continue
		}
		taken[id] = true
		out = append(out, TopEntry{EntryID: id, Rank: tr.rank, Term: tr.term, row: i})
		if len(out) == size {
			break
		}
	}
	return out, nil
}

// MaxTopSize is the largest starter deck; TopCache resolves it once per
// pack content and answers every smaller size from it.
const MaxTopSize = 2000

type topKey struct {
	pack    int64
	hash    string
	lexicon string
}

type topSlot struct {
	done    chan struct{}
	entries []TopEntry
	err     error
}

// TopCache memoises Top(…, MaxTopSize) per (pack id, content hash,
// lexicon version — lexicon.Store.CharactersVersion: a dictionary install
// changes what the rows resolve to) and
// answers a smaller size from it exactly as Top(size) would (the first
// size entries taken within 4*size rows). A re-import with other rows
// or a dictionary change changes the key, so the next Get recomputes; concurrent Gets of one
// key share one computation. The zero value is ready; safe for
// concurrent use.
type TopCache struct {
	mu    sync.Mutex
	slots map[topKey]*topSlot
}

// Get returns the pack's top size entries.
func (c *TopCache) Get(ctx context.Context, s Store, r Resolver, pack PackInfo, lexiconVersion string, size int) ([]TopEntry, error) {
	if size > MaxTopSize {
		return s.Top(ctx, r, pack, size)
	}
	key := topKey{pack.ID, pack.ContentHash, lexiconVersion}
	c.mu.Lock()
	if c.slots == nil {
		c.slots = map[topKey]*topSlot{}
	}
	slot, ok := c.slots[key]
	if !ok {
		for k := range c.slots {
			if k.pack == pack.ID {
				delete(c.slots, k) // an older content of the pack or the lexicon
			}
		}
		slot = &topSlot{done: make(chan struct{})}
		c.slots[key] = slot
		c.mu.Unlock()
		c.compute(ctx, slot, key, func(ctx context.Context) ([]TopEntry, error) {
			return s.Top(ctx, r, pack, MaxTopSize)
		})
	} else {
		c.mu.Unlock()
	}
	select {
	case <-slot.done:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if slot.err != nil {
		return nil, slot.err
	}
	out := []TopEntry{}
	for _, e := range slot.entries {
		if len(out) == size || e.row >= rowCap(size) {
			break
		}
		out = append(out, e)
	}
	return out, nil
}

// errTopAborted is what waiters of a computation that panicked get.
var errTopAborted = errors.New("starter deck resolution aborted")

// compute fills slot; the computation is shared, so it runs to completion
// even if this caller goes away. Whatever happens — an error or a panic,
// which still reaches this caller — the waiters are released and a failed
// slot is dropped so the next Get computes afresh.
func (c *TopCache) compute(ctx context.Context, slot *topSlot, key topKey, top func(context.Context) ([]TopEntry, error)) {
	slot.err = errTopAborted
	defer func() {
		if slot.err != nil {
			c.mu.Lock()
			if c.slots[key] == slot {
				delete(c.slots, key)
			}
			c.mu.Unlock()
		}
		close(slot.done)
	}()
	slot.entries, slot.err = top(context.WithoutCancel(ctx))
}
