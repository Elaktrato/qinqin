package i18n

import (
	"sort"
	"strconv"
	"strings"
)

// DefaultLanguage is the result when no candidate matches.
const DefaultLanguage = "en"

func isAlpha(s string) bool {
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z') {
			return false
		}
	}
	return true
}

func isDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func isScriptSubtag(s string) bool { return len(s) == 4 && isAlpha(s) }
func isRegionSubtag(s string) bool {
	return len(s) == 2 && isAlpha(s) || len(s) == 3 && isDigits(s)
}

// chain is the lookup order of one candidate: itself, the zh script form,
// then trailing subtags dropped one at a time.
func chain(candidate string) []string {
	out := []string{candidate}
	parts := strings.Split(candidate, "-")
	if strings.EqualFold(parts[0], "zh") && !(len(parts) > 1 && isScriptSubtag(parts[1])) {
		region := ""
		if len(parts) > 1 && isRegionSubtag(parts[1]) {
			region = strings.ToUpper(parts[1])
		}
		script := "Hans"
		if region == "TW" || region == "HK" || region == "MO" {
			script = "Hant"
		}
		parts = append([]string{"zh", script}, parts[1:]...)
	}
	for n := len(parts); n >= 1; n-- {
		out = append(out, strings.Join(parts[:n], "-"))
	}
	return out
}

// Negotiate picks the interface language (docs/contracts/i18n/
// negotiate.json): the first candidate with a hit in supported, spelled as
// supported spells it; DefaultLanguage when none hits. Candidates are the
// stored setting if non-empty, else Accept-Language by q-value.
func Negotiate(candidates, supported []string) string {
	bySpelling := make(map[string]string, len(supported))
	for _, s := range supported {
		bySpelling[strings.ToLower(s)] = s
	}
	for _, c := range candidates {
		if c == "" {
			continue
		}
		for _, tag := range chain(c) {
			if hit, ok := bySpelling[strings.ToLower(tag)]; ok {
				return hit
			}
		}
	}
	return DefaultLanguage
}

// MaxAcceptLanguage bounds the Accept-Language header length read (here and
// in a queued mail job); maxAcceptLanguageEntries bounds the entries read.
const (
	MaxAcceptLanguage        = 1024
	maxAcceptLanguageEntries = 32
)

// ParseAcceptLanguage returns the language ranges of an Accept-Language
// header ordered by q-value (highest first, header order among equals).
// `*`, q=0 entries and malformed entries are skipped; a malformed or
// oversized header yields what could be read (possibly nothing).
func ParseAcceptLanguage(header string) []string {
	if len(header) > MaxAcceptLanguage {
		header = header[:MaxAcceptLanguage]
	}
	type entry struct {
		tag string
		q   float64
		at  int
	}
	var entries []entry
	for i, item := range strings.Split(header, ",") {
		if i >= maxAcceptLanguageEntries {
			break
		}
		fields := strings.Split(item, ";")
		tag := strings.TrimSpace(fields[0])
		if tag == "" || tag == "*" || !validRange(tag) {
			continue
		}
		q := 1.0
		ok := true
		for _, param := range fields[1:] {
			k, v, found := strings.Cut(strings.TrimSpace(param), "=")
			if !found || !strings.EqualFold(strings.TrimSpace(k), "q") {
				continue // other parameters are ignored
			}
			f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
			if err != nil || f < 0 || f > 1 {
				ok = false
				break
			}
			q = f
		}
		if !ok || q == 0 {
			continue
		}
		entries = append(entries, entry{tag, q, i})
	}
	sort.SliceStable(entries, func(a, b int) bool { return entries[a].q > entries[b].q })
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.tag)
	}
	return out
}

// validRange accepts a BCP 47 language range: 1-8 alphanumerics per subtag,
// the first alphabetic.
func validRange(tag string) bool {
	for i, sub := range strings.Split(tag, "-") {
		if len(sub) < 1 || len(sub) > 8 {
			return false
		}
		for _, r := range sub {
			if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || i > 0 && r >= '0' && r <= '9') {
				return false
			}
		}
	}
	return true
}

// Pick resolves the language for a server-rendered text (a mail): the
// stored setting if non-empty, else the request's Accept-Language, against
// supported; DefaultLanguage when nothing matches.
func Pick(setting, acceptLanguage string, supported []string) string {
	if setting != "" {
		return Negotiate([]string{setting}, supported)
	}
	return Negotiate(ParseAcceptLanguage(acceptLanguage), supported)
}
