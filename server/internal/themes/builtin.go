package themes

import (
	"embed"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"sync"

	"qinqin/internal/dict"
)

// BuiltinPack is a theme pack embedded in the binary: always present, never
// stored, never uninstalled. License is its LICENSE text.
type BuiltinPack struct {
	Manifest dict.Manifest
	Themes   []Theme
	License  string
}

// The built-in packs, one directory each (manifest.json, themes.json,
// LICENSE copied verbatim from upstream; docs/sources.md "Themes").
//
//go:embed builtin
var builtinFS embed.FS

// builtinOrder is the order GET /api/themes lists the built-in packs in
// (docs/contracts/themes/themes-api.json).
var builtinOrder = []string{"catppuccin", "rose-pine", "nord", "gruvbox", "dracula", "solarized", "tokyo-night", "everforest", "kanagawa"}

var loadBuiltin = sync.OnceValue(func() []BuiltinPack {
	out := make([]BuiltinPack, 0, len(builtinOrder))
	for _, id := range builtinOrder {
		read := func(name string) []byte {
			b, err := builtinFS.ReadFile("builtin/" + id + "/" + name)
			if err != nil {
				// The files are embedded at build time; a miss is a build bug.
				panic(fmt.Sprintf("themes: built-in pack %s: %v", id, err))
			}
			return b
		}
		var m dict.Manifest
		if err := json.Unmarshal(read("manifest.json"), &m); err != nil {
			panic(fmt.Sprintf("themes: built-in pack %s: manifest: %v", id, err))
		}
		m.Notice = strings.TrimSpace(m.Notice)
		if err := checkManifest(m); err != nil || m.ID != id {
			panic(fmt.Sprintf("themes: built-in pack %s: manifest: %v", id, err))
		}
		list, err := ParseFile(read(DataFile))
		if err != nil {
			panic(fmt.Sprintf("themes: built-in pack %s: %s: %v", id, DataFile, err))
		}
		out = append(out, BuiltinPack{Manifest: m, Themes: list, License: string(read("LICENSE"))})
	}
	return out
})

// builtinSource returns the built-in packs; tests swap it.
var builtinSource = loadBuiltin

// Builtin returns the built-in theme packs in their fixed order. The
// slices are copies.
func Builtin() []BuiltinPack {
	src := builtinSource()
	out := make([]BuiltinPack, len(src))
	for i, p := range src {
		p.Themes = slices.Clone(p.Themes)
		for j := range p.Themes {
			p.Themes[j].Accents = slices.Clone(p.Themes[j].Accents)
		}
		out[i] = p
	}
	return out
}
