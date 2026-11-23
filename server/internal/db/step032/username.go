// FROZEN: a verbatim copy of model.UsernameKey (server/internal/model)
// as migration 032 shipped it (#171). Migration 032's Go step must compute
// the username keys of a v0.2.x database the same way forever, whatever
// later releases change in the live rule. Never edit this file; a later
// migration that needs other behaviour gets its own frozen copy.
// testdata/username-keys-032.json pins its results.

package step032

import (
	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

// UsernameKey is the identity of a username for uniqueness: NFKC (so
// compatibility forms such as fullwidth letters collapse) then full case
// folding.
func UsernameKey(name string) string {
	return norm.NFKC.String(cases.Fold().String(norm.NFKC.String(name)))
}
