// Package lang holds the language pack registry. A pack carries one
// language's reading behavior: how readings normalize to a plain search
// form, how search queries normalize, and which extra readings derive
// from the imported ones. Code packs (zh, ja) are compile-time modules
// registered at startup; every other code falls back to the generic pack.
package lang

import (
	"strings"
	"sync"

	"qinqin/internal/model"
)

// Pack is the behavior of one language.
type Pack interface {
	// Code is the language code, e.g. "zh".
	Code() string
	// NormalizeReading returns the plain search form of one reading:
	// the same form a query must take to match it.
	NormalizeReading(readType, value string) string
	// SearchPlain returns the normalized form of a search query.
	SearchPlain(query string) string
	// DeriveReadings returns readings supplemented with derived ones —
	// the zh pack appends a bopomofo reading when a pinyin reading
	// exists. The input slice is never mutated.
	DeriveReadings(readings []model.Reading) []model.Reading
}

// Deinflection is one possible dictionary form of an inflected surface.
type Deinflection struct{ Form, Reason string }

// Deinflector is implemented by packs whose surface forms inflect.
// Deinflect returns possible dictionary forms for surface (never surface
// itself), most specific first.
type Deinflector interface {
	Deinflect(surface string) []Deinflection
}

var (
	mu    sync.RWMutex
	packs = map[string]Pack{}
)

// Register adds p to the registry under its code, replacing any pack
// registered for the same code. Registration happens at startup, before
// requests are served.
func Register(p Pack) {
	mu.Lock()
	defer mu.Unlock()
	packs[strings.ToLower(p.Code())] = p
}

// Registered reports whether code has a registered code pack (zh, ja, …),
// as opposed to falling back to the generic pack.
func Registered(code string) bool {
	mu.RLock()
	defer mu.RUnlock()
	_, ok := packs[strings.ToLower(code)]
	return ok
}

// For returns the pack registered under code, matched case-insensitively.
// Unknown codes fall back to the generic pack.
func For(code string) Pack {
	mu.RLock()
	p, ok := packs[strings.ToLower(code)]
	mu.RUnlock()
	if ok {
		return p
	}
	return Generic{}
}

// Generic is the fallback pack for languages without a code pack: plain
// forms and search queries are lowercased, and readings never derive
// anything.
type Generic struct{}

// Code is empty: the generic pack stands in for any unregistered code.
func (Generic) Code() string { return "" }

// NormalizeReading lowercases the reading's value.
func (Generic) NormalizeReading(readType, value string) string {
	return strings.ToLower(value)
}

// SearchPlain lowercases the query.
func (Generic) SearchPlain(query string) string {
	return strings.ToLower(query)
}

// DeriveReadings returns its input unchanged.
func (Generic) DeriveReadings(readings []model.Reading) []model.Reading {
	return readings
}
