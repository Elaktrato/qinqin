// Package lang holds the language pack registry. A pack carries one
// language's reading behavior: how readings normalize to a plain search
// form, how search queries normalize, and which extra readings derive
// from the imported ones. Code packs (zh, ja) are compile-time modules
// registered at startup; every other code falls back to the generic pack.
package lang

import (
	"regexp"
	"sort"
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
type Deinflection struct {
	Form string
	// Reason is the inflection chain innermost first, space-joined, e.g.
	// "causative passive negative past" — Reasons reversed.
	Reason string
	// Reasons is the inflection chain in application order: the rule
	// applied to the surface first, the one producing Form last, e.g.
	// negative past, passive, causative for 食べさせられなかった.
	Reasons []string
	// Class is the word class Form must have to be this deinflection
	// (ClassV1, ClassV5, …); see ClassMatches. An intermediate form that
	// is no dictionary form (飲みます) has a class no POS tag matches.
	Class string
}

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

// codePattern is the shape of a language code: a 2-3 letter primary tag
// and up to two subtags, e.g. es, pt-br, zh-hant-tw.
var codePattern = regexp.MustCompile(`^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$`)

// ValidCode normalizes raw (trim, lowercase, "_" to "-") and reports
// whether the result is a well-formed language code.
func ValidCode(raw string) (string, bool) {
	code := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(raw)), "_", "-")
	return code, codePattern.MatchString(code)
}

// Codes returns the codes of the registered code packs, sorted.
func Codes() []string {
	mu.RLock()
	defer mu.RUnlock()
	codes := make([]string, 0, len(packs))
	for c := range packs {
		codes = append(codes, c)
	}
	sort.Strings(codes)
	return codes
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
