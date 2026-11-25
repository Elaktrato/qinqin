// Package keyed is the core's one generic store of keyed settings rows
// (#199, record 0006): small JSON documents per user, scoped to a workspace or
// user-global, synced by the paged pull (collection rows) and the push
// (member rows) under last write wins with tombstones. It replaces the plugin
// data store. It accepts only the key families of
// docs/contracts/keyed/families.json, each in its one scope, so new feature
// data cannot land here without a contract line.
package keyed

import (
	"errors"
	"strings"
)

// Scope is where a family's rows live.
type Scope string

const (
	ScopeWorkspace Scope = "workspace"
	ScopeGlobal    Scope = "user-global"
)

// Family is one accepted key family: the exact key, or (Prefix) the prefix
// followed by at least one character.
type Family struct {
	Key    string
	Prefix bool
	Scope  Scope
}

// Families are the accepted key families (docs/contracts/keyed/families.json).
var Families = []Family{
	{"note:", true, ScopeWorkspace},
	{"notecfg", false, ScopeWorkspace},
	{"lookups", false, ScopeWorkspace},
	{"lookupcfg", false, ScopeGlobal},
	{"known:", true, ScopeWorkspace},
	{"milestone:", true, ScopeWorkspace},
	{"goals:workspace", false, ScopeWorkspace},
	{"study-setup", false, ScopeWorkspace},
	{"vacation:", true, ScopeGlobal},
	{"home-layout", false, ScopeGlobal},
	{"activity-view", false, ScopeGlobal},
	{"widget-options", false, ScopeGlobal},
	{"nav-layout", false, ScopeGlobal},
	{"appearance", false, ScopeGlobal},
	{"reminders", false, ScopeGlobal},
}

// MaxKey caps a key's length in bytes.
const MaxKey = 512

var (
	// ErrUnknownKey reports a key of no accepted family.
	ErrUnknownKey = errors.New("keyed: unknown key")
	// ErrWrongScope reports a key used outside its family's scope.
	ErrWrongScope = errors.New("keyed: key in the wrong scope")
	// ErrNotFound reports a missing or tombstoned row.
	ErrNotFound = errors.New("keyed: not found")
)

// FamilyOf returns the family of a key.
func FamilyOf(key string) (Family, bool) {
	if key == "" || len(key) > MaxKey {
		return Family{}, false
	}
	for _, f := range Families {
		if (f.Prefix && strings.HasPrefix(key, f.Key) && len(key) > len(f.Key)) || (!f.Prefix && key == f.Key) {
			return f, true
		}
	}
	return Family{}, false
}

// Check reports whether key may be stored in the scope workspace names (nil
// = user-global): ErrUnknownKey or ErrWrongScope otherwise.
func Check(key string, workspace *int64) error {
	f, ok := FamilyOf(key)
	if !ok {
		return ErrUnknownKey
	}
	if (workspace == nil) != (f.Scope == ScopeGlobal) {
		return ErrWrongScope
	}
	return nil
}
