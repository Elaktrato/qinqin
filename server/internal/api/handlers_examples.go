package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"qinqin/internal/ai"
	"qinqin/internal/lexicon"
	"qinqin/internal/model"
	"qinqin/internal/sentences"
)

// The AI example sentences of an entry (#186, docs/contracts/examples/).

// maxExamplesBody caps POST /api/entries/{id}/examples: a level and a request id.
const maxExamplesBody = 4 << 10

// errExamplesStored: drafts of the request id are stored already (a retry).
var errExamplesStored = errors.New("api: the request's drafts are stored")

// examplesScope is the signed-in caller and the entry of the path: 401
// before 404, an unknown or malformed entry id 404.
func (s *server) examplesScope(w http.ResponseWriter, r *http.Request) (*model.User, *lexicon.Entry, bool) {
	u := s.requireUser(w, r)
	if u == nil {
		return nil, nil, false
	}
	e, ok := s.entryFromPath(w, r)
	return u, e, ok
}

// pathID is a positive integer path value, or false.
func pathID(r *http.Request, name string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	return id, err == nil && id > 0
}

// reasonOf is the optional ?reason= of a delete; false (and a 400) for an
// unknown one.
func reasonOf(w http.ResponseWriter, r *http.Request) (string, bool) {
	reason := r.URL.Query().Get("reason")
	if reason != "" && !sentences.ValidReason(reason) {
		writeError(w, http.StatusBadRequest, "bad_request", "Unknown report reason.")
		return "", false
	}
	return reason, true
}

// answerExamplesError maps a store error of the examples to its answer.
func answerExamplesError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, sentences.ErrDraftNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Draft not found.")
	case errors.Is(err, sentences.ErrSentenceNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Sentence not found.")
	case errors.Is(err, sentences.ErrExamplesFull):
		writeError(w, http.StatusConflict, "examples_full", "The word has the maximum of kept AI examples; delete one first.")
	case errors.Is(err, sentences.ErrBadReason):
		writeError(w, http.StatusBadRequest, "bad_request", "Unknown report reason.")
	default:
		writeInternal(w, r)
	}
}

// handleGetExamples serves GET /api/entries/{id}/examples: the caller's
// drafts of the entry and their default level.
func (s *server) handleGetExamples(w http.ResponseWriter, r *http.Request) {
	u, e, ok := s.examplesScope(w, r)
	if !ok {
		return
	}
	v, err := sentences.Examples(r.Context(), s.db, u.ID, e.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// handleGenerateExamples serves POST /api/entries/{id}/examples {level,
// requestId}: one provider call with the caller's own key writes example
// sentences, the server checks each (sentences.FilterExamples) and the
// good ones replace the entry's drafts. A request id whose drafts are stored
// answers them without a call (a retry after a lost answer); the drafts and
// the kept count are read again while the call holds the user's one AI slot.
func (s *server) handleGenerateExamples(w http.ResponseWriter, r *http.Request) {
	u, e, ok := s.examplesScope(w, r)
	if !ok {
		return
	}
	body, ok := readBody(w, r, maxExamplesBody)
	if !ok {
		return
	}
	var in struct {
		Level     string `json:"level"`
		RequestID string `json:"requestId"`
	}
	if json.Unmarshal(body, &in) != nil || !ai.ValidLevel(in.Level) || !sentences.ValidRequestID(in.RequestID) {
		writeError(w, http.StatusBadRequest, "bad_request", "The body must be {level, requestId} with a known level and requestId of 1 to 64 letters, digits, '-' or '_'.")
		return
	}
	// precheck is the state the call depends on: a stored answer or the cap.
	precheck := func(ctx context.Context) error {
		if _, found, err := sentences.StoredGeneration(ctx, s.db, u.ID, e.ID, in.RequestID); err != nil {
			return err
		} else if found {
			return errExamplesStored
		}
		n, err := sentences.KeptCount(ctx, s.db, u.ID, e.ID)
		if err != nil {
			return err
		}
		if n >= sentences.MaxKeptPerEntry {
			return sentences.ErrExamplesFull
		}
		return nil
	}
	answerStored := func() {
		stored, _, err := sentences.StoredGeneration(r.Context(), s.db, u.ID, e.ID, in.RequestID)
		if err != nil {
			writeInternal(w, r)
			return
		}
		writeJSON(w, http.StatusOK, stored)
	}
	switch err := precheck(r.Context()); {
	case errors.Is(err, errExamplesStored):
		answerStored()
		return
	case err != nil:
		answerExamplesError(w, r, err)
		return
	}
	segmented := segmentable(e.Language)
	var seg sentences.SegmentFunc
	if segmented {
		seg = s.segmenter().Segment
	}
	var res sentences.GenerationResult
	var storeErr error
	_, err := s.runAI(r, u.ID, "examples", func(ctx context.Context, p ai.Provider, spec ai.ProviderSpec, cr ai.Credentials) (ai.CallResult, error) {
		// Under the slot: the marker and the kept examples as stored now.
		if err := precheck(ctx); err != nil {
			return ai.CallResult{}, fmt.Errorf("%w: %w", errNoProviderCall, err)
		}
		existing, err := sentences.ForEntry(ctx, s.db, e.ID, u.ID)
		if err != nil {
			return ai.CallResult{}, fmt.Errorf("%w: %w", errNoProviderCall, err)
		}
		req := sentences.RequestFor(*e, existing, in.Level, !segmented)
		reply, err := p.Examples(ctx, cr, req)
		call := ai.CallResult{Model: reply.Model, Usage: reply.Usage, Calls: reply.Calls}
		if err != nil {
			return call, err
		}
		// Checked and stored before the slot is released, so a retry with the
		// same request id finds the marker (ctx is detached from the client).
		texts := make([]string, 0, len(existing))
		for _, x := range existing {
			texts = append(texts, x.Hanzi)
		}
		kept, dropped, ferr := sentences.FilterExamples(ctx, seg, sentences.WordOf(*e), req.ReadingSystem, reply.Sentences, texts)
		if ferr != nil {
			storeErr = ferr
			return call, nil
		}
		modelID := reply.Model
		if modelID == "" {
			modelID = cr.Model
		}
		res, storeErr = sentences.StoreGeneration(ctx, s.db, u.ID, e.ID, sentences.Generation{RequestID: in.RequestID, Level: in.Level, Provider: spec.ID, Model: modelID}, kept, dropped)
		return call, nil
	})
	switch {
	case errors.Is(err, errExamplesStored):
		answerStored()
	case errors.Is(err, errNoProviderCall):
		// The cause is wrapped beside errNoProviderCall; the mapper matches it with errors.Is.
		answerExamplesError(w, r, err)
	case err != nil:
		writeAIError(w, err)
	case storeErr != nil:
		log.Printf("ai examples: store: %v", storeErr)
		writeInternal(w, r)
	default:
		writeJSON(w, http.StatusOK, res)
	}
}

// handleKeepExample serves POST /api/entries/{id}/examples/{draftId}/keep:
// 201 with the kept example (an own sentence marked as AI-written).
func (s *server) handleKeepExample(w http.ResponseWriter, r *http.Request) {
	u, e, ok := s.examplesScope(w, r)
	if !ok {
		return
	}
	draftID, ok := pathID(r, "draftId")
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "Draft not found.")
		return
	}
	sent, err := sentences.KeepDraft(r.Context(), s.db, u.ID, e.ID, draftID)
	if err != nil {
		answerExamplesError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, sent)
}

// handleDiscardExample serves DELETE /api/entries/{id}/examples/{draftId}
// [?reason=]: the draft goes; with a reason it is also reported.
func (s *server) handleDiscardExample(w http.ResponseWriter, r *http.Request) {
	u, e, ok := s.examplesScope(w, r)
	if !ok {
		return
	}
	reason, ok := reasonOf(w, r)
	if !ok {
		return
	}
	draftID, ok := pathID(r, "draftId")
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "Draft not found.")
		return
	}
	if err := sentences.DiscardDraft(r.Context(), s.db, u.ID, e.ID, draftID, reason); err != nil {
		answerExamplesError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleDeleteAIExample serves DELETE /api/entries/{id}/sentences/{sentenceId}
// [?reason=]: the caller's kept AI example goes (a tombstone); with a reason
// it is also reported. Any other sentence is 404.
func (s *server) handleDeleteAIExample(w http.ResponseWriter, r *http.Request) {
	u, e, ok := s.examplesScope(w, r)
	if !ok {
		return
	}
	reason, ok := reasonOf(w, r)
	if !ok {
		return
	}
	sentenceID, ok := pathID(r, "sentenceId")
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "Sentence not found.")
		return
	}
	if err := sentences.DeleteAI(r.Context(), s.db, u.ID, e.ID, sentenceID, reason); err != nil {
		answerExamplesError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
