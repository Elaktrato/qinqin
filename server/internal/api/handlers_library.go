package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"qinqin/internal/library"
	"qinqin/internal/library/epub"
)

const (
	// maxEpubBody caps an uploaded epub file.
	maxEpubBody = 20 << 20
	// multipartOverhead is slack for the multipart framing and the
	// small non-file fields around the epub.
	multipartOverhead = 1 << 20
	// maxUploadMemory is how much of the form is held in memory before
	// the multipart reader spills to temp files.
	maxUploadMemory = 1 << 20
	// maxPositionLen caps a stored reading position.
	maxPositionLen = 1 << 10
)

func (s *server) library() library.Store {
	return library.Store{DB: s.db, Dir: filepath.Join(s.dataDir, "books")}
}

// libraryError maps a store error to a response; internal errors never
// leak details.
func libraryError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, library.ErrNotFound):
		http.Error(w, "not found", http.StatusNotFound)
	case errors.Is(err, library.ErrDuplicate):
		http.Error(w, "book already in library", http.StatusConflict)
	case errors.Is(err, library.ErrWorkspaceNotFound):
		http.Error(w, "workspace not found", http.StatusNotFound)
	case errors.As(err, new(*library.LanguageMismatchError)):
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
	default:
		http.Error(w, "internal error", http.StatusInternalServerError)
	}
}

// bookID reads the {id} path value; a malformed id is a missing book.
func bookID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return 0, false
	}
	return id, true
}

// parseWorkspaceID reads a workspace id given as a request parameter: a
// positive integer.
func parseWorkspaceID(raw string) (int64, bool) {
	id, err := strconv.ParseInt(raw, 10, 64)
	return id, err == nil && id > 0
}

// epubLanguage maps a language tag to a supported language code.
func epubLanguage(tag string) string {
	tag = strings.ToLower(strings.TrimSpace(tag))
	for _, code := range []string{"zh", "ja"} {
		if tag == code || strings.HasPrefix(tag, code+"-") || strings.HasPrefix(tag, code+"_") {
			return code
		}
	}
	return ""
}

// handleUploadBook serves POST /api/library/upload: the multipart
// "file" field carries an epub, which is parsed and stored in the
// library of the caller's workspace named by the "workspace" field
// (required; 404 when it is not the caller's). The book's language
// comes from the epub's dc:language, else from the "language" form
// field, and must be the workspace's (422 otherwise).
func (s *server) handleUploadBook(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxEpubBody+multipartOverhead)
	if err := r.ParseMultipartForm(maxUploadMemory); err != nil {
		badBody(w, err)
		return
	}
	defer r.MultipartForm.RemoveAll()
	workspaceID, ok := parseWorkspaceID(r.FormValue("workspace"))
	if !ok {
		http.Error(w, `form field "workspace" with a workspace id required`, http.StatusBadRequest)
		return
	}
	store := s.library()
	// Unknown or foreign workspaces are refused before the epub is parsed.
	if _, err := store.WorkspaceLanguage(r.Context(), u.ID, workspaceID); err != nil {
		libraryError(w, err)
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, `multipart field "file" with the epub required`, http.StatusBadRequest)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxEpubBody+1))
	if err != nil {
		badBody(w, err)
		return
	}
	if len(data) > maxEpubBody {
		http.Error(w, "epub too large", http.StatusRequestEntityTooLarge)
		return
	}

	meta, chapters, err := epub.Parse(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		if errors.Is(err, epub.ErrInvalid) {
			http.Error(w, "not a readable epub", http.StatusUnprocessableEntity)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	// The epub's own language wins when it is supported; otherwise the
	// form field decides.
	language := epubLanguage(meta.Language)
	if language == "" {
		language = epubLanguage(r.FormValue("language"))
	}
	if language == "" {
		http.Error(w, "language must be zh or ja", http.StatusUnprocessableEntity)
		return
	}
	title := meta.Title
	if title == "" {
		title = chapters[0].Title
	}

	sum := sha256.Sum256(data)
	// Create checks the workspace's language against the book's.
	book, err := store.Create(r.Context(), library.Book{
		UserID:      u.ID,
		WorkspaceID: workspaceID,
		Language:    language,
		Title:       title,
		Author:      meta.Author,
		Source:      "upload",
		SourceID:    hex.EncodeToString(sum[:]),
	}, chapters)
	if err != nil {
		libraryError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, book)
}

// handleListBooks serves GET /api/library/books?workspace=<id>: the
// books of one of the caller's workspaces (404 when it is not the
// caller's), or of all the caller's workspaces without the parameter.
func (s *server) handleListBooks(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	store := s.library()
	var workspaceID int64
	if r.URL.Query().Has("workspace") {
		id, ok := parseWorkspaceID(r.URL.Query().Get("workspace"))
		if !ok {
			http.Error(w, "workspace must be a workspace id", http.StatusBadRequest)
			return
		}
		if _, err := store.WorkspaceLanguage(r.Context(), u.ID, id); err != nil {
			libraryError(w, err)
			return
		}
		workspaceID = id
	}
	books, err := store.List(r.Context(), u.ID, workspaceID)
	if err != nil {
		libraryError(w, err)
		return
	}
	if books == nil {
		books = []library.Book{}
	}
	writeJSON(w, http.StatusOK, books)
}

// handleGetBook serves GET /api/library/books/{id}.
func (s *server) handleGetBook(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	book, err := s.library().Get(r.Context(), u.ID, id)
	if err != nil {
		libraryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, book)
}

// handleGetChapter serves GET /api/library/books/{id}/chapters/{n}.
func (s *server) handleGetChapter(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	n, err := strconv.Atoi(r.PathValue("n"))
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	ch, err := s.library().Chapter(r.Context(), u.ID, id, n)
	if err != nil {
		libraryError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ch)
}

// handleSetBookPosition serves PUT /api/library/books/{id}/position
// with the body {"position": string}.
func (s *server) handleSetBookPosition(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2*maxPositionLen)
	var in struct {
		Position string `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		badBody(w, err)
		return
	}
	if len(in.Position) > maxPositionLen {
		http.Error(w, "position too long", http.StatusRequestEntityTooLarge)
		return
	}
	if err := s.library().SetPosition(r.Context(), u.ID, id, in.Position); err != nil {
		libraryError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleDeleteBook serves DELETE /api/library/books/{id}.
func (s *server) handleDeleteBook(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, ok := bookID(w, r)
	if !ok {
		return
	}
	if err := s.library().Delete(r.Context(), u.ID, id); err != nil {
		libraryError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
