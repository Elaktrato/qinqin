package api

import (
	"errors"
	"net/http"

	"qinqin/internal/courses"
)

// handleListCourses serves GET /api/courses[?language=<code>]: the installed course packs with their credits and
// titles (docs/contracts/courses/README.md "Routes"). Signed-in users only, like the filled course.
func (s *server) handleListCourses(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	list, err := courses.List(r.Context(), s.db, r.URL.Query().Get("language"))
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"courses": list})
}

// handleCourse serves GET /api/courses/{id}: the course filled with words from the installed packs, cached per
// server (internal/courses.Cache). The ETag is the answer's `fill`; a matching If-None-Match answers 304. Signed-in
// users only: the words come from the level lists, which are not public data.
func (s *server) handleCourse(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	served, err := s.courses.Get(r.Context(), s.db, r.PathValue("id"))
	if errors.Is(err, courses.ErrNotFound) {
		writeError(w, http.StatusNotFound, "not_found", "No such course.")
		return
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	etag := `"` + served.Fill + `"`
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	if etagMatches(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(served.Body)
}
