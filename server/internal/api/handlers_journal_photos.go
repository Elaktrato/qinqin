package api

import (
	"errors"
	"io"
	"log"
	"net/http"
	"path/filepath"

	"qinqin/internal/journal"
)

const (
	maxPhotoBytes      = 10 << 20 // an uploaded photo
	maxPhotoFormBody   = maxPhotoBytes + 1<<20
	maxPhotoFormMemory = 1 << 20
)

// photoWork bounds the photos decoded at once: a 50 MP decode takes a few
// hundred MiB.
var photoWork = make(chan struct{}, 2)

func (s *server) photos() journal.Photos {
	return journal.Photos{DB: s.db, Dir: filepath.Join(s.dataDir, "journal")}
}

func writeJournalError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]string{"error": code, "message": msg})
}

// handleUploadPhoto serves POST /api/journal/photos.
func (s *server) handleUploadPhoto(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	tooBig := func() {
		writeJournalError(w, http.StatusRequestEntityTooLarge, "photo_too_large", "That photo is larger than 10 MB.")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxPhotoFormBody)
	if err := r.ParseMultipartForm(maxPhotoFormMemory); err != nil {
		var big *http.MaxBytesError
		if errors.As(err, &big) {
			tooBig()
		} else {
			http.Error(w, "malformed request body", http.StatusBadRequest)
		}
		return
	}
	defer r.MultipartForm.RemoveAll()
	wsID, ok := parseWorkspaceID(r.FormValue("workspace"))
	if !ok {
		http.Error(w, `form field "workspace" with a workspace id required`, http.StatusBadRequest)
		return
	}
	if _, ok := s.journalTarget(w, r, u.ID, wsID); !ok {
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, `multipart field "file" with the photo required`, http.StatusBadRequest)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxPhotoBytes+1))
	if err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	if len(data) > maxPhotoBytes {
		tooBig()
		return
	}
	select {
	case photoWork <- struct{}{}:
	case <-r.Context().Done():
		return
	}
	jpegData, err := journal.NormalizePhoto(data)
	<-photoWork
	switch {
	case errors.Is(err, journal.ErrUnsupportedImage):
		writeJournalError(w, http.StatusUnsupportedMediaType, "unsupported_image", "Choose a JPEG, PNG or WebP photo.")
		return
	case errors.Is(err, journal.ErrImageTooLarge):
		writeJournalError(w, http.StatusUnprocessableEntity, "image_too_large", "That photo is larger than 50 megapixels.")
		return
	case err != nil:
		log.Printf("journal: normalise photo: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	ph, err := s.photos().Create(r.Context(), u.ID, wsID, jpegData)
	switch {
	case errors.Is(err, journal.ErrTooManyPhotos):
		writeJournalError(w, http.StatusConflict, "too_many_photos", "You have 10 photo drafts open. Finish or discard one first.")
		return
	case err != nil:
		log.Printf("journal: store photo: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"photoId": ph.ID})
}

func photoNotFound(w http.ResponseWriter, err error) {
	if errors.Is(err, journal.ErrPhotoNotFound) {
		http.Error(w, "photo not found", http.StatusNotFound)
		return
	}
	log.Printf("journal: photo: %v", err)
	http.Error(w, "internal error", http.StatusInternalServerError)
}

// handleGetPhoto serves GET /api/journal/photos/{id}.
func (s *server) handleGetPhoto(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	_, data, err := s.photos().Get(r.Context(), u.ID, r.PathValue("id"))
	if err != nil {
		photoNotFound(w, err)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write(data)
}

// handlePhotoKeepalive serves PUT /api/journal/photos/{id}/keepalive.
func (s *server) handlePhotoKeepalive(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	if err := s.photos().Touch(r.Context(), u.ID, r.PathValue("id")); err != nil {
		photoNotFound(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleDeletePhoto serves DELETE /api/journal/photos/{id}.
func (s *server) handleDeletePhoto(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	if err := s.photos().Delete(r.Context(), u.ID, r.PathValue("id")); err != nil {
		photoNotFound(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
