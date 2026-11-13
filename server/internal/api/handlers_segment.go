package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"unicode/utf8"

	"qinqin/internal/lang"
	"qinqin/internal/segment"
)

// handleSegmentAt serves GET /api/segment/at?lang=&text=&offset= with the
// longest dictionary match starting at the code-point offset, as
// {"match": Match|null}. The route is public. lang and text are required
// and offset must be an integer, otherwise 400.
func (s *server) handleSegmentAt(w http.ResponseWriter, r *http.Request) {
	params := r.URL.Query()
	language, text := params.Get("lang"), params.Get("text")
	offset, err := strconv.Atoi(params.Get("offset"))
	if language == "" || text == "" || err != nil {
		http.Error(w, "lang, text and integer offset required", http.StatusBadRequest)
		return
	}
	if !lang.Registered(language) {
		http.Error(w, "unsupported language", http.StatusBadRequest)
		return
	}
	if utf8.RuneCountInString(text) > maxSegmentAtRunes {
		http.Error(w, "text too long", http.StatusRequestEntityTooLarge)
		return
	}
	svc := s.segmenter()
	m, err := svc.MatchAt(r.Context(), language, text, offset)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]*segment.Match{"match": m})
}

// segmentRequest is the body of POST /api/segment.
type segmentRequest struct {
	Lang string `json:"lang"`
	Text string `json:"text"`
}

// handleSegment serves POST /api/segment {lang, text} with every match of
// the text in order, as {"matches": Match[]}. It needs a signed-in user
// (one request can run thousands of lookups; nothing in the web app calls
// it yet); the body is capped at maxSegmentBody.
func (s *server) handleSegment(w http.ResponseWriter, r *http.Request) {
	if s.requireUser(w, r) == nil {
		return
	}
	var req segmentRequest
	r.Body = http.MaxBytesReader(w, r.Body, maxSegmentBody)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badBody(w, err)
		return
	}
	if req.Lang == "" {
		http.Error(w, "lang required", http.StatusBadRequest)
		return
	}
	if !lang.Registered(req.Lang) {
		http.Error(w, "unsupported language", http.StatusBadRequest)
		return
	}
	if utf8.RuneCountInString(req.Text) > maxSegmentRunes {
		http.Error(w, "text too long", http.StatusRequestEntityTooLarge)
		return
	}
	svc := s.segmenter()
	matches, err := svc.Segment(r.Context(), req.Lang, req.Text)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]segment.Match{"matches": matches})
}

// segmenter is the tokenizer over the lookup engine.
func (s *server) segmenter() segment.Service {
	return segment.Service{Lookup: s.lookupService()}
}
