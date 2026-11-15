package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"qinqin/internal/ai"
	"qinqin/internal/journal"
)

const (
	maxPhotoBytes      = 10 << 20 // an uploaded photo
	maxPhotoFormBody   = maxPhotoBytes + 1<<20
	maxPhotoFormMemory = 1 << 20
)

// photoWork bounds the photos decoded at once: a 25 MP decode takes a
// couple of hundred MiB.
var photoWork = make(chan struct{}, 2)

// normalizeBounded waits for a decode slot, normalises the photo and always
// gives the slot back.
func normalizeBounded(ctx context.Context, data []byte) ([]byte, error) {
	select {
	case photoWork <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer func() { <-photoWork }()
	return journal.NormalizePhoto(data)
}

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
	// Cheap refusals first: the pending cap and the hourly limit come before
	// any pixel is decoded. Create still enforces the cap atomically.
	if n, err := s.photos().Count(r.Context(), u.ID); err == nil && n >= journal.MaxPendingPhotos {
		writeJournalError(w, http.StatusConflict, "too_many_photos", "You have 10 photo drafts open. Finish or discard one first.")
		return
	}
	if ok, wait := s.uploadUse.take(u.ID, time.Now(), photoUploadsHour); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(secondsCeil(wait)))
		writeJournalError(w, http.StatusTooManyRequests, "rate_limited", "You have uploaded "+strconv.Itoa(photoUploadsHour)+" photos this hour. Try again later.")
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
	jpegData, err := normalizeBounded(r.Context(), data)
	switch {
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		return

	case errors.Is(err, journal.ErrUnsupportedImage):
		writeJournalError(w, http.StatusUnsupportedMediaType, "unsupported_image", "Choose a JPEG, PNG or WebP photo.")
		return
	case errors.Is(err, journal.ErrImageTooLarge):
		writeJournalError(w, http.StatusUnprocessableEntity, "image_too_large", "That photo is larger than 25 megapixels.")
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

const (
	maxTranscribeBody = 4 << 10
	offlineReadsHour  = 60
	photoUploadsHour  = 30
)

// hourlyUse counts actions per user over a rolling hour, in memory.
type hourlyUse struct {
	mu        sync.Mutex
	at        map[int64][]time.Time
	lastSweep time.Time
}

// take records an action, or reports how long until one is free. Users who
// have been quiet for an hour are dropped from the map now and then.
func (o *hourlyUse) take(userID int64, now time.Time, limit int) (ok bool, wait time.Duration) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.at == nil {
		o.at = map[int64][]time.Time{}
	}
	cutoff := now.Add(-time.Hour)
	if now.Sub(o.lastSweep) >= time.Minute {
		o.lastSweep = now
		for id, ts := range o.at {
			if len(ts) == 0 || !ts[len(ts)-1].After(cutoff) {
				delete(o.at, id)
			}
		}
	}
	kept := o.at[userID][:0]
	for _, t := range o.at[userID] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= limit {
		o.at[userID] = kept
		return false, kept[0].Add(time.Hour).Sub(now)
	}
	o.at[userID] = append(kept, now)
	return true, 0
}

// refund gives back the action taken at now (a read that never ran).
func (o *hourlyUse) refund(userID int64, now time.Time) {
	o.mu.Lock()
	defer o.mu.Unlock()
	ts := o.at[userID]
	for i := len(ts) - 1; i >= 0; i-- {
		if ts[i].Equal(now) {
			o.at[userID] = append(ts[:i], ts[i+1:]...)
			return
		}
	}
}

func (s *server) ocrAvailable() bool { return s.ocr != nil && s.ocr.Available() }

// handleJournalTranscribe serves POST /api/journal/transcribe. Neither engine
// writes anything but the photo's last_seen_at, and there is no fallback from
// one engine to the other: the learner picks.
func (s *server) handleJournalTranscribe(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	body, ok := readBody(w, r, maxTranscribeBody)
	if !ok {
		return
	}
	var req struct {
		WorkspaceID int64  `json:"workspaceId"`
		PhotoID     string `json:"photoId"`
		Engine      string `json:"engine"`
	}
	if json.Unmarshal(body, &req) != nil || req.PhotoID == "" || len(req.PhotoID) > 64 || (req.Engine != "ai" && req.Engine != "offline") {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	t, ok := s.journalTarget(w, r, u.ID, req.WorkspaceID)
	if !ok {
		return
	}
	ph, jpegData, err := s.photos().Get(r.Context(), u.ID, req.PhotoID)
	if err == nil && ph.WorkspaceID != t.ws {
		err = journal.ErrPhotoNotFound
	}
	if err != nil {
		photoNotFound(w, err)
		return
	}

	if req.Engine == "ai" {
		// A model that cannot see photos is refused before any provider call
		// (a bad selection or key surfaces from runAI as usual).
		if spec, model, err := s.ai.ActiveSpec(r.Context(), u.ID); err == nil && !spec.VisionFor(model) {
			writeAIError(w, errNoVision(model, spec.Name))
			return
		}
		var reply ai.TranscribeReply
		_, err := s.runAI(r, u.ID, "transcribe", func(ctx context.Context, p ai.Provider, _ ai.ProviderSpec, c ai.Credentials) (ai.CallResult, error) {
			var err error
			reply, err = p.Transcribe(ctx, c, ai.TranscribeRequest{Language: t.language, Image: jpegData, MediaType: "image/jpeg"})
			return ai.CallResult{Model: reply.Model, Usage: reply.Usage, Calls: reply.Calls}, err
		})
		if err != nil {
			writeAIError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"text": reply.Text, "engine": "ai", "unreadable": reply.Unreadable})
		return
	}

	if !s.ocrAvailable() {
		writeJournalError(w, http.StatusConflict, "ocr_unavailable", "Offline reading is not installed on this server.")
		return
	}
	langs := journal.OCRLanguages(t.language)
	if !s.ocr.HasLanguages(langs) {
		writeJournalError(w, http.StatusConflict, "ocr_language_missing", "Offline reading has no model for "+ai.LanguageName(t.language)+".")
		return
	}
	usedAt := time.Now()
	if ok, wait := s.ocrUse.take(u.ID, usedAt, offlineReadsHour); !ok {
		w.Header().Set("Retry-After", strconv.Itoa(secondsCeil(wait)))
		writeJournalError(w, http.StatusTooManyRequests, "rate_limited", "You have used "+strconv.Itoa(offlineReadsHour)+" offline reads this hour. Try again later.")
		return
	}
	text, err := s.ocr.Recognize(r.Context(), jpegData, langs)
	switch {
	case errors.Is(err, journal.ErrOCRBusy):
		s.ocrUse.refund(u.ID, usedAt) // the read never ran
		w.Header().Set("Retry-After", "10")
		writeJournalError(w, http.StatusServiceUnavailable, "busy", "Offline reading is busy. Try again in a moment.")
		return
	case errors.Is(err, journal.ErrOCRUnavailable):
		writeJournalError(w, http.StatusConflict, "ocr_unavailable", "Offline reading is not installed on this server.")
		return
	case errors.Is(err, journal.ErrOCRLanguageMissing):
		writeJournalError(w, http.StatusConflict, "ocr_language_missing", "Offline reading has no model for "+ai.LanguageName(t.language)+".")
		return
	case err != nil:
		if r.Context().Err() == nil {
			log.Printf("journal: offline OCR failed")
		}
		writeJournalError(w, http.StatusUnprocessableEntity, "ocr_failed", "Offline reading failed on this photo.")
		return
	}
	text = strings.TrimSpace(text)
	writeJSON(w, http.StatusOK, map[string]any{"text": text, "engine": "offline", "unreadable": text == ""})
}
