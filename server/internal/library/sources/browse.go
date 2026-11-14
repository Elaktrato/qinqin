package sources

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"math/rand/v2"
)

// Browser is the optional capability of a Source to offer an assortment
// of its catalog without a query. Browse returns at most limit works of
// language ("" for any) in an order fixed by seed: the same seed and
// catalog give the same works, another seed another selection, and no
// work twice. An empty catalog is an empty list, not an error.
type Browser interface {
	Browse(ctx context.Context, language, seed string, limit int) ([]Result, error)
}

// Phonetics returns the toneless pinyin of the Han text in text,
// syllables separated by spaces, or "" when it cannot convert any. It
// never fails: a failed conversion is "".
type Phonetics func(ctx context.Context, text string) string

// Assortment returns at most limit of items, picked and ordered by a
// pseudo-random shuffle seeded from seed; items is not modified. It is a
// partial Fisher-Yates shuffle, so no item appears twice.
func Assortment[T any](items []T, seed string, limit int) []T {
	n := min(max(limit, 0), len(items))
	pool := make([]T, len(items))
	copy(pool, items)
	sum := sha256.Sum256([]byte(seed))
	rng := rand.New(rand.NewPCG(binary.LittleEndian.Uint64(sum[:8]), binary.LittleEndian.Uint64(sum[8:16])))
	for i := range n {
		j := i + rng.IntN(len(pool)-i)
		pool[i], pool[j] = pool[j], pool[i]
	}
	return pool[:n:n]
}
