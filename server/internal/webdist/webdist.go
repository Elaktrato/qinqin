// Package webdist embeds the built qinqin web frontend and serves it as a
// single-page application.
package webdist

import (
	"bytes"
	"embed"
	"io"
	"io/fs"
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

// Handler serves a built SvelteKit SPA from fsys: index.html for /, any
// existing file as-is, and index.html for unknown paths (client-side
// routing). Requests never escape fsys. When fsys has no index.html it
// answers 200 text/html with a placeholder instead of a 404, so the
// embedded API remains reachable from a bare build.
func Handler(fsys fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}
		if serveFile(w, r, fsys, name) {
			return
		}
		// Unknown paths are SPA routes; unknown assets also get the index,
		// which is what adapter-static's fallback promises.
		serveIndex(w, r, fsys)
	})
}

// serveFile writes the named regular file, reporting whether it existed.
// http.ServeContent handles HEAD, ranges, and content length; the type is
// taken from the extension because sniffing would label scripts and styles
// as text/plain.
func serveFile(w http.ResponseWriter, r *http.Request, fsys fs.FS, name string) bool {
	info, err := fs.Stat(fsys, name)
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	data, err := fs.ReadFile(fsys, name)
	if err != nil {
		return false
	}
	if ctype := mime.TypeByExtension(path.Ext(name)); ctype != "" {
		w.Header().Set("Content-Type", ctype)
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), bytes.NewReader(data))
	return true
}

// serveIndex serves the SPA entry point, or the placeholder when the build
// does not contain one.
func serveIndex(w http.ResponseWriter, r *http.Request, fsys fs.FS) {
	if serveFile(w, r, fsys, "index.html") {
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	io.WriteString(w, placeholder)
}
