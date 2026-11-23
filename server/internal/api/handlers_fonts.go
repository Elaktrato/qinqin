package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"qinqin/internal/fonts"
)

// fontSliceBody is one slice of GET /api/fonts.
type fontSliceBody struct {
	URL          string `json:"url"`
	UnicodeRange string `json:"unicodeRange"`
}

// fontFaceBody is one face of GET /api/fonts (docs/contracts/fonts/fonts-api.json).
type fontFaceBody struct {
	PackID      string          `json:"packId"`
	Face        string          `json:"face"`
	Script      string          `json:"script"`
	Original    string          `json:"original"`
	Weight      string          `json:"weight"`
	Style       string          `json:"style"`
	License     string          `json:"license"`
	Attribution string          `json:"attribution"`
	Slices      []fontSliceBody `json:"slices"`
}

// fontPackBody is one pack's credits on GET /api/fonts.
type fontPackBody struct {
	PackID      string `json:"packId"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
}

type fontsBody struct {
	Faces []fontFaceBody `json:"faces"`
	Packs []fontPackBody `json:"packs"`
}

// handleListFonts serves GET /api/fonts: every face of every installed
// font pack with its slice URLs and unicode ranges, and the packs' credits
// (docs/contracts/fonts/README.md). Signed in; fonts are instance-wide, so
// every user gets the same bytes. Strong ETag with no-cache.
func (s *server) handleListFonts(w http.ResponseWriter, r *http.Request) {
	if u := s.requireUser(w, r); u == nil {
		return
	}
	faces, err := fonts.Faces(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	packs, err := fonts.Packs(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	out := fontsBody{Faces: []fontFaceBody{}, Packs: []fontPackBody{}}
	for _, f := range faces {
		b := fontFaceBody{PackID: f.PackID, Face: f.Face.Face, Script: f.Script, Original: f.Original, Weight: f.Weight,
			Style: f.Style, License: f.License, Attribution: f.Attribution, Slices: make([]fontSliceBody, 0, len(f.Slices))}
		for _, sl := range f.Slices {
			b.Slices = append(b.Slices, fontSliceBody{URL: "/fonts/" + sl.Sha + ".woff2", UnicodeRange: sl.UnicodeRange})
		}
		out.Faces = append(out.Faces, b)
	}
	for _, p := range packs {
		out.Packs = append(out.Packs, fontPackBody{PackID: p.PackID, Name: p.Name, Version: p.Version, License: p.License,
			Attribution: p.Attribution, Notice: p.Notice})
	}
	body, err := json.Marshal(out)
	if err != nil {
		writeInternal(w, r)
		return
	}
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:16]) + `"`
	h := w.Header()
	h.Set("ETag", etag)
	h.Set("Cache-Control", "no-cache")
	if etagListed(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	h.Set("Content-Type", "application/json")
	w.Write(body)
}

// fontFile is the name of a slice: its sha256 in lower-case hex.
var fontFile = regexp.MustCompile(`^([0-9a-f]{64})\.woff2$`)

// handleFontFile serves GET /fonts/{file}: one WOFF2 slice of an installed
// font pack, byte for byte. Public and token-free like /hanzi/{file}:
// browsers fetch @font-face URLs without credentials. The name is the
// content's hash, so the answer is cached for a year as immutable.
func (s *server) handleFontFile(w http.ResponseWriter, r *http.Request) {
	m := fontFile.FindStringSubmatch(r.PathValue("file"))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if m == nil {
		writeError(w, http.StatusNotFound, "not_found", "No such font file.")
		return
	}
	ok, err := fonts.Installed(r.Context(), s.db, m[1])
	if err != nil {
		writeInternal(w, r)
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "No such font file.")
		return
	}
	f, err := os.Open(fonts.BlobPath(filepath.Join(s.dataDir, "fonts"), m[1]))
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "No such font file.") // the row outlived its file: nothing to serve
		return
	}
	defer f.Close()
	h := w.Header()
	h.Set("Content-Type", "font/woff2")
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	h.Set("ETag", `"`+m[1]+`"`)
	serveContent(w, r, time.Time{}, f)
}
