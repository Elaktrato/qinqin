package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"qinqin/internal/entries"
	"qinqin/internal/model"
	"qinqin/internal/sentences"
)

// sentenceRequest is the request body of POST /api/entries/{id}/sentences.
type sentenceRequest struct {
	Hanzi       string `json:"hanzi"`
	Pinyin      string `json:"pinyin"`
	Translation string `json:"translation"`
}

// handleAddSentence serves POST /api/entries/{id}/sentences: it stores
// the authenticated caller's example sentence on the entry — owned by
// them, never touched by pack imports — and responds with the stored
// sentence. Unknown and malformed ids are 404, unauthenticated calls
// 401, malformed bodies 400.
func (s *server) handleAddSentence(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		http.Error(w, "entry not found", http.StatusNotFound)
		return
	}
	var req sentenceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Hanzi) == "" || strings.TrimSpace(req.Pinyin) == "" || strings.TrimSpace(req.Translation) == "" {
		http.Error(w, "a sentence needs a hanzi, pinyin, and translation", http.StatusBadRequest)
		return
	}
	store := entries.Store{DB: s.db}
	_, err = store.GetByID(r.Context(), id)
	if errors.Is(err, entries.ErrNotFound) {
		http.Error(w, "entry not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	sid, err := sentences.AddUser(r.Context(), s.db, u.ID, id, model.Sentence{
		Hanzi: req.Hanzi, Pinyin: req.Pinyin, Translation: req.Translation,
	})
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	// The stored row is read back so the response carries the sentence
	// exactly as persisted, timestamps included.
	list, err := sentences.ForEntry(r.Context(), s.db, id)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	for _, stored := range list {
		if stored.ID == sid {
			writeJSON(w, http.StatusCreated, stored)
			return
		}
	}
	http.Error(w, "internal error", http.StatusInternalServerError)
}

// handleUninstallSentences serves DELETE /api/admin/sentences/{pack}:
// the pack's sentences are soft-deleted; user-owned ones never carry a
// source pack and survive. Admin upload routes dispatch packs by
// manifest type, so sentence packs install through their own importer —
// the seed CLI wires it.
func (s *server) handleUninstallSentences(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	if err := sentences.Uninstall(r.Context(), s.db, r.PathValue("pack")); err != nil {
		if errors.Is(err, sentences.ErrNotFound) {
			http.Error(w, "sentence pack not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
