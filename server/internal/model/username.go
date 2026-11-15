package model

import (
	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

// UsernameKey is the identity of a username for uniqueness: NFKC (so
// compatibility forms such as fullwidth letters collapse) then full case
// folding. Login still matches the stored username exactly; the key only
// decides whether a new name is taken.
func UsernameKey(name string) string {
	return norm.NFKC.String(cases.Fold().String(norm.NFKC.String(name)))
}
