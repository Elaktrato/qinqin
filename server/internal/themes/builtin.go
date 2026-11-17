package themes

import "qinqin/internal/dict"

// BuiltinPack is a theme pack embedded in the binary: always present, never
// stored, never uninstalled. License is its LICENSE text.
type BuiltinPack struct {
	Manifest dict.Manifest
	Themes   []Theme
	License  string
}

// builtinSource returns the built-in packs; tests swap it.
var builtinSource = func() []BuiltinPack { return nil }

// Builtin returns the built-in theme packs in their fixed order.
func Builtin() []BuiltinPack { return builtinSource() }
