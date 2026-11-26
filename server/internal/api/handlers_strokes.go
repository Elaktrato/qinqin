package api

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"qinqin/internal/strokes"
)

// strokeFile is the name of a stroke file: U + the code point in uppercase
// hex without leading zeros (strokeData.ts writes exactly this).
var strokeFile = regexp.MustCompile(`^U([1-9A-F][0-9A-F]{0,5})\.json$`)

// handleStrokeFile serves GET /hanzi/{file}: the stroke JSON of one
// character from the installed strokes packs, byte for byte as the
// hanzi-writer-data file. Public and token-free like the static files it
// replaces; anything but the canonical name of a code point with data is 404.
// The optional ?lang=ja asks for the shapes of that language where packs differ
// (strokes.LookupFor); a malformed code is 400.
func (s *server) handleStrokeFile(w http.ResponseWriter, r *http.Request) {
	m := strokeFile.FindStringSubmatch(r.PathValue("file"))
	if m == nil {
		writeError(w, http.StatusNotFound, "not_found", "No such stroke file.")
		return
	}
	cp, err := strconv.ParseUint(m[1], 16, 32)
	if err != nil || !utf8.ValidRune(rune(cp)) { // surrogates and beyond U+10FFFF
		writeError(w, http.StatusNotFound, "not_found", "No such stroke file.")
		return
	}
	lang, valid := strokeLang(r)
	if !valid {
		writeError(w, http.StatusBadRequest, "bad_request", "The language is a lower-case code of two or three letters.")
		return
	}
	data, ok, err := strokes.LookupFor(r.Context(), s.db, string(rune(cp)), lang)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "No such stroke file.")
		return
	}
	sum := sha256.Sum256(data)
	h := w.Header()
	h.Set("Content-Type", "application/json")
	h.Set("X-Content-Type-Options", "nosniff") // the 404s carry it too
	h.Set("Cache-Control", "public, max-age=86400")
	h.Set("ETag", `"`+hex.EncodeToString(sum[:16])+`"`)
	serveContent(w, r, time.Time{}, strings.NewReader(string(data)))
}

// strokeLangRE is a language code the stroke lookup accepts: two or three lower-case letters.
var strokeLangRE = regexp.MustCompile(`^[a-z]{2,3}$`)

// strokeLang reads the optional ?lang= of a stroke request: "" when it is absent, the code when it is well
// formed, valid false when it is empty, repeated or malformed. Other parameters are ignored.
func strokeLang(r *http.Request) (lang string, valid bool) {
	vals, present := r.URL.Query()["lang"]
	if !present {
		return "", true
	}
	if len(vals) != 1 || !strokeLangRE.MatchString(vals[0]) {
		return "", false
	}
	return vals[0], true
}

// strokePackBody is one row of GET /api/stroke-packs: the credits of an
// installed strokes pack (the component-packs row with languages instead
// of language).
type strokePackBody struct {
	PackID      string   `json:"packId"`
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Languages   []string `json:"languages"`
	License     string   `json:"license"`
	Attribution string   `json:"attribution"`
	Notice      string   `json:"notice"`
}

// handleListStrokePacks serves GET /api/stroke-packs: every installed
// strokes pack's credits, in lookup order (the first serves a character
// several packs carry).
func (s *server) handleListStrokePacks(w http.ResponseWriter, r *http.Request) {
	list, err := strokes.Packs(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	out := make([]strokePackBody, 0, len(list))
	for _, p := range list {
		out = append(out, strokePackBody{PackID: p.PackID, Name: p.Name, Version: p.Version, Languages: p.Languages,
			License: p.License, Attribution: p.Attribution, Notice: p.Notice})
	}
	writeJSON(w, http.StatusOK, out)
}
