// Package webdist embeds the built qinqin web frontend and serves it as a
// single-page application.
package webdist

import (
	"bytes"
	"embed"
	"errors"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"path"
	"strings"
)

// distFS is the whole build output directory. The committed .gitkeep keeps
// the pattern matched (and the package compiling) before a build exists.
//
//go:embed all:dist
var distFS embed.FS

// Dist is the embedded web build, rooted at the build output directory.
var Dist fs.FS = mustSub(distFS, "dist")

// placeholder is served when no web build was bundled (bare Go build). The
// API stays usable; only the browser UI is missing.
const placeholder = "web build not bundled"

func mustSub(fsys fs.FS, dir string) fs.FS {
	sub, err := fs.Sub(fsys, dir)
	if err != nil {
		panic("webdist: embed dist: " + err.Error())
	}
	return sub
}

const (
	cacheNoStore    = "no-store"
	cacheImmutable  = "public, max-age=31536000, immutable"
	immutablePrefix = "_app/immutable/"
)

// extraTypes covers extensions the platform mime table may lack (Alpine
// ships no /etc/mime.types, so fonts would otherwise be octet-stream).
var extraTypes = map[string]string{
	".woff2": "font/woff2",
	".woff":  "font/woff",
	".ttf":   "font/ttf",
	".otf":   "font/otf",
	".txt":   "text/plain; charset=utf-8",
}

func contentType(name string) string {
	ext := strings.ToLower(path.Ext(name))
	if t, ok := extraTypes[ext]; ok {
		return t
	}
	return mime.TypeByExtension(ext)
}

// absent reports whether err means "no such file" rather than an I/O fault.
func absent(err error) bool {
	return errors.Is(err, fs.ErrNotExist) || errors.Is(err, fs.ErrInvalid)
}

// Handler serves a built SvelteKit SPA from fsys: index.html for /, any
// existing file as-is, and index.html for unknown paths (client-side
// routing). Requests never escape fsys. When fsys has no index.html it
// answers 200 text/html with a placeholder instead of a 404, so the
// embedded API remains reachable from a bare build. An I/O error is a 500,
// never a silent SPA fallback. Every response carries nosniff; index.html
// is no-store, content-hashed _app/immutable files are cached for a year.
func Handler(fsys fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")

		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}
		found, err := serveFile(w, r, fsys, name)
		if err != nil {
			serveFailure(w, name, err)
			return
		}
		if found {
			return
		}
		// Unknown paths are SPA routes; unknown assets also get the index,
		// which is what adapter-static's fallback promises.
		serveIndex(w, r, fsys)
	})
}

func serveFailure(w http.ResponseWriter, name string, err error) {
	log.Printf("webdist: serve %s: %v", name, err)
	w.Header().Set("Cache-Control", cacheNoStore)
	http.Error(w, "internal server error", http.StatusInternalServerError)
}

// serveFile writes the named regular file, reporting whether it existed. A
// missing file or directory is (false, nil); any other failure is an error.
// http.ServeContent handles HEAD, ranges, and content length; the type is
// taken from the extension because sniffing would label scripts and styles
// as text/plain.
func serveFile(w http.ResponseWriter, r *http.Request, fsys fs.FS, name string) (bool, error) {
	info, err := fs.Stat(fsys, name)
	if err != nil {
		if absent(err) {
			return false, nil
		}
		return false, err
	}
	if !info.Mode().IsRegular() {
		return false, nil
	}
	data, err := fs.ReadFile(fsys, name)
	if err != nil {
		if absent(err) {
			return false, nil
		}
		return false, err
	}
	if ctype := contentType(name); ctype != "" {
		w.Header().Set("Content-Type", ctype)
	}
	switch {
	case name == "index.html":
		w.Header().Set("Cache-Control", cacheNoStore)
	case strings.HasPrefix(name, immutablePrefix):
		w.Header().Set("Cache-Control", cacheImmutable)
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), bytes.NewReader(data))
	return true, nil
}

// serveIndex serves the SPA entry point, or the placeholder when the build
// does not contain one.
func serveIndex(w http.ResponseWriter, r *http.Request, fsys fs.FS) {
	found, err := serveFile(w, r, fsys, "index.html")
	if err != nil {
		serveFailure(w, "index.html", err)
		return
	}
	if found {
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", cacheNoStore)
	w.WriteHeader(http.StatusOK)
	io.WriteString(w, placeholder)
}
