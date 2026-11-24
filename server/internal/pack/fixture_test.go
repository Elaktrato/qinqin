package pack_test

import "qinqin/internal/pack"

// fixtureManifest is a valid dictionary manifest (it mirrors
// internal/dict's testdata/mkgloss/manifest.json).
var fixtureManifest = pack.Manifest{
	ID:          "mkgloss",
	Name:        "Mkgloss demo dictionary",
	Version:     "1.0",
	Type:        "dictionary",
	Language:    "zh",
	License:     "CC BY-SA 4.0",
	Attribution: "Qinqin test fixtures",
	Format:      "json",
}
