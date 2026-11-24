package packs_test

import (
	"errors"
	"testing"

	"qinqin/internal/audio"
	"qinqin/internal/components"
	"qinqin/internal/dict"
	"qinqin/internal/fonts"
	"qinqin/internal/freq"
	"qinqin/internal/grammar"
	"qinqin/internal/lemmapack"
	"qinqin/internal/levels"
	"qinqin/internal/pack"
	"qinqin/internal/packs"
	"qinqin/internal/sentences"
	"qinqin/internal/strokes"
	"qinqin/internal/themes"
)

// Every pack type's uninstall reports a pack that is not installed with an
// error that is a pack.ErrNotFound, so Uninstall needs one check (#192).
func TestEveryNotFoundErrorIsPackNotFound(t *testing.T) {
	for name, err := range map[string]error{
		"dict": dict.ErrNotFound, "freq": freq.ErrNotFound, "levels": levels.ErrNotFound,
		"sentences": sentences.ErrNotFound, "grammar": grammar.ErrNotFound, "audio": audio.ErrPackNotFound,
		"components": components.ErrNotFound, "strokes": strokes.ErrNotFound, "lemmapack": lemmapack.ErrNotFound,
		"themes": themes.ErrNotFound, "fonts": fonts.ErrNotFound, "packs": packs.ErrNotFound,
	} {
		if !errors.Is(err, pack.ErrNotFound) {
			t.Errorf("%s: %v is not a pack.ErrNotFound", name, err)
		}
	}
}
