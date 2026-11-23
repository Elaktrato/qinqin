package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"unicode/utf8"

	"qinqin/internal/lang"
	"qinqin/internal/overlay"
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
		writeError(w, http.StatusBadRequest, "bad_request", "Lang, text and integer offset required.")
		return
	}
	if !lang.Registered(language) {
		writeError(w, http.StatusBadRequest, "bad_request", "Unsupported language.")
		return
	}
	if utf8.RuneCountInString(text) > maxSegmentAtRunes {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "text too long.")
		return
	}
	svc := s.segmenter()
	m, err := svc.MatchAt(r.Context(), language, text, offset)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]*segment.Match{"match": m})
}

// segmentRequest is the body of POST /api/segment.
type segmentRequest struct {
	Lang string `json:"lang"`
	Text string `json:"text"`
	// Readings asks for Match.Reading, with the caller's overlay applied.
	Readings bool `json:"readings"`
}

// handleSegment serves POST /api/segment {lang, text} with every match of
// the text in order, as {"matches": Match[]}. It needs a signed-in user
// (one request can run thousands of lookups; the reader calls it, in
// chunks, only when readings are on); the body is capped at maxSegmentBody.
// With "readings": true each match carries the caller's reading.
func (s *server) handleSegment(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var req segmentRequest
	r.Body = http.MaxBytesReader(w, r.Body, maxSegmentBody)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		badBody(w, err)
		return
	}
	if req.Lang == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "lang required.")
		return
	}
	if !lang.Registered(req.Lang) {
		writeError(w, http.StatusBadRequest, "bad_request", "Unsupported language.")
		return
	}
	if utf8.RuneCountInString(req.Text) > maxSegmentRunes {
		writeError(w, http.StatusRequestEntityTooLarge, "too_large", "text too long.")
		return
	}
	svc := s.segmenter()
	svc.WithReadings = req.Readings
	matches, err := svc.Segment(r.Context(), req.Lang, req.Text)
	if err == nil && req.Readings {
		err = s.overlayReadings(r.Context(), u.ID, matches)
	}
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string][]segment.Match{"matches": matches})
}

// segmenter is the tokenizer over the lookup engine.
func (s *server) segmenter() segment.Service {
	return segment.Service{Lookup: s.lookupService()}
}

// overlayReadings replaces each match's reading by the caller's saved
// readings of its best entry: the matched reading when the overlay still
// lists it, else the first overlay reading of the same type (any type
// when none has it). Other users' overlays never apply.
func (s *server) overlayReadings(ctx context.Context, userID int64, matches []segment.Match) error {
	ids := make([]int64, 0, len(matches))
	for _, m := range matches {
		if len(m.Entries) > 0 {
			ids = append(ids, m.Entries[0].ID)
		}
	}
	patched, err := overlay.Readings(ctx, s.db, userID, ids)
	if err != nil || len(patched) == 0 {
		return err
	}
	for i := range matches {
		m := &matches[i]
		if len(m.Entries) == 0 || m.Reading == nil {
			continue
		}
		rs := patched[m.Entries[0].ID]
		if len(rs) == 0 {
			continue
		}
		pick := rs[0]
		for _, r := range rs {
			if r.Type == m.Reading.Type && r.Value == m.Reading.Value {
				pick = r
				break
			}
			if pick.Type != m.Reading.Type && r.Type == m.Reading.Type {
				pick = r
			}
		}
		m.Reading = &segment.Reading{Type: pick.Type, Value: pick.Value}
	}
	return nil
}
