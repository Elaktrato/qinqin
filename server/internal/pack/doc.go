// Package pack is what every data pack type shares (#192): the manifest
// (Manifest, its validation and the notice rule), loading a pack from a
// directory or a zip (LoadPack, the zip limits), the type and format
// constants, the pack-type table (All) and the errors ErrInvalidPack and
// ErrNotFound.
//
// It imports nothing of the application but internal/lang, so every
// domain package can use it.
package pack
