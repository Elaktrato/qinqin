package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"qinqin/internal/ai"
	"qinqin/internal/journal"
)

// The conversation partner's routes (#185, docs/contracts/journal/README.md#conversations).

const (
	maxConversationBody = 4 << 10  // POST /api/journal/conversations and /save: a topic and a level, or an id and a date
	maxTurnBody         = 16 << 10 // POST .../turn: a message of at most journal.MaxMessageRunes code points, escaped
)

var errMessageTooLong = &apiError{"too_long", "The message is longer than 1,000 characters."}

// answerConversationError maps a conversation store error to its answer.
func answerConversationError(w http.ResponseWriter, r *http.Request, err error) {
	var inv *journal.InvalidError
	switch {
	case errors.Is(err, journal.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Conversation not found.")
	case errors.Is(err, journal.ErrConversationFull):
		writeError(w, http.StatusConflict, "conversation_full", "The conversation is full; save it or start a new one.")
	case errors.Is(err, journal.ErrConversationLimit):
		writeError(w, http.StatusConflict, "conversation_limit", "Too many open conversations; save or discard one first.")
	case errors.Is(err, journal.ErrNothingToSave):
		writeError(w, http.StatusUnprocessableEntity, "empty", "The conversation has no messages.")
	case errors.As(err, &inv):
		writeError(w, http.StatusBadRequest, "bad_request", inv.Msg)
	default:
		writeInternal(w, r)
	}
}

// handleListConversations serves GET /api/journal/conversations?workspace=.
func (s *server) handleListConversations(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := s.journalScope(w, r)
	if !ok {
		return
	}
	list, err := journal.ListConversations(r.Context(), s.db, userID, ws)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleStartConversation serves POST /api/journal/conversations?workspace=
// {topic, level}: 201 with the new conversation; no AI call.
func (s *server) handleStartConversation(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := s.journalScope(w, r)
	if !ok {
		return
	}
	body, ok := readBody(w, r, maxConversationBody)
	if !ok {
		return
	}
	var in struct {
		Topic string `json:"topic"`
		Level string `json:"level"`
	}
	if json.Unmarshal(body, &in) != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	c, err := journal.CreateConversation(r.Context(), s.db, userID, ws, journal.NewConversationID(), in.Topic, in.Level)
	if err != nil {
		answerConversationError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

// handleGetConversation serves GET /api/journal/conversations/{id}?workspace=.
func (s *server) handleGetConversation(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := s.journalScope(w, r)
	if !ok {
		return
	}
	c, err := journal.GetConversation(r.Context(), s.db, userID, ws, r.PathValue("id"))
	if err != nil {
		answerConversationError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// handleDeleteConversation serves DELETE /api/journal/conversations/{id}?workspace=.
func (s *server) handleDeleteConversation(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := s.journalScope(w, r)
	if !ok {
		return
	}
	if err := journal.DeleteConversation(r.Context(), s.db, userID, ws, r.PathValue("id")); err != nil {
		answerConversationError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// errNoProviderCall marks a turn that ended before the provider was called
// (runAI records no call for it): the conversation changed while the turn
// waited for the user's AI slot.
var errNoProviderCall = errors.New("api: no provider call made")

// errTurnStored: the turn id is stored already (a retry); answer it.
var errTurnStored = errors.New("api: the turn is stored")

// checkTurn applies the turn rules to the conversation as it is.
func checkTurn(c journal.Conversation, text string) error {
	if err := journal.CheckTurnText(text, len(c.Messages) > 0); err != nil {
		return err
	}
	if text != "" && journal.ConversationFull(c) || text == "" && len(c.Messages)+1 > journal.MaxMessages {
		return journal.ErrConversationFull
	}
	return nil
}

// answerTurnError maps a turn rule or store error to its answer.
func answerTurnError(w http.ResponseWriter, r *http.Request, err error) {
	switch journal.TurnTextCode(err) {
	case "empty":
		writeAIError(w, errEmptyEntry)
	case "too_long":
		writeAIError(w, errMessageTooLong)
	default:
		answerConversationError(w, r, err)
	}
}

// handleConversationTurn serves POST /api/journal/conversations/{id}/turn?workspace=
// {text, turnId}: one provider call with the learner's own key. The learner's
// message and the partner's reply are stored together once the call
// succeeded; a failed call stores nothing. turnId is the client's id of the
// turn: a retry with a stored id answers the stored turn without a provider
// call. The conversation the call sends (the history, the next seq) is read
// again while the turn holds the user's one AI slot, so no other turn of the
// user can land in between.
func (s *server) handleConversationTurn(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := s.journalScope(w, r)
	if !ok {
		return
	}
	body, ok := readBody(w, r, maxTurnBody)
	if !ok {
		return
	}
	var in struct {
		Text   string `json:"text"`
		TurnID string `json:"turnId"`
	}
	if json.Unmarshal(body, &in) != nil || !journal.ValidEntryID(in.TurnID) {
		writeError(w, http.StatusBadRequest, "bad_request", "The body must be {text, turnId} with turnId of 1 to 64 letters, digits, '-' or '_'.")
		return
	}
	id := r.PathValue("id")
	c, err := journal.GetConversation(r.Context(), s.db, userID, ws, id)
	if err != nil {
		answerConversationError(w, r, err)
		return
	}
	if journal.HasTurn(c, in.TurnID) {
		writeJSON(w, http.StatusOK, c)
		return
	}
	text := strings.TrimSpace(in.Text)
	if err := checkTurn(c, text); err != nil {
		answerTurnError(w, r, err)
		return
	}
	t, ok := s.journalTarget(w, r, userID, ws)
	if !ok {
		return
	}
	words, err := journal.StudiedWords(r.Context(), s.db, userID, ws, time.Now())
	if err != nil {
		writeInternal(w, r)
		return
	}
	var reply ai.ConverseReply
	run, err := s.runAI(r, userID, "converse", func(ctx context.Context, p ai.Provider, _ ai.ProviderSpec, cr ai.Credentials) (ai.CallResult, error) {
		// Under the slot: the conversation as stored now.
		now, err := journal.GetConversation(ctx, s.db, userID, ws, id)
		switch {
		case err != nil:
			return ai.CallResult{}, fmt.Errorf("%w: %w", errNoProviderCall, err)
		case journal.HasTurn(now, in.TurnID):
			return ai.CallResult{}, fmt.Errorf("%w: %w", errNoProviderCall, errTurnStored)
		}
		if err := checkTurn(now, text); err != nil {
			return ai.CallResult{}, fmt.Errorf("%w: %w", errNoProviderCall, err)
		}
		history := make([]ai.Turn, 0, len(now.Messages))
		for _, m := range now.Messages {
			history = append(history, ai.Turn{Role: m.Role, Text: m.Text})
		}
		reply, err = p.Converse(ctx, cr, ai.ConverseRequest{
			Language: t.language, ExplanationLanguage: t.settings.ExplanationLanguage, Guidance: t.settings.Guidance,
			Level: now.Level, Topic: now.Topic, Words: journal.WordSample(words), History: history, Text: text,
		})
		return ai.CallResult{Model: reply.Model, Usage: reply.Usage, Calls: reply.Calls}, err
	})
	switch {
	case errors.Is(err, errTurnStored):
		stored, gerr := journal.GetConversation(r.Context(), s.db, userID, ws, id)
		if gerr != nil {
			answerConversationError(w, r, gerr)
			return
		}
		writeJSON(w, http.StatusOK, stored)
		return
	case errors.Is(err, errNoProviderCall):
		answerTurnError(w, r, errors.Unwrap(errors.Unwrap(err)))
		return
	case err != nil:
		writeAIError(w, err)
		return
	}
	partnerText, err := journal.PartnerReply(t.language, reply.Reply)
	if err != nil {
		log.Printf("ai converse: provider=%s refused reply: %v", run.Spec.ID, err)
		if errors.Is(err, journal.ErrReplyLanguage) {
			writeError(w, http.StatusUnprocessableEntity, "wrong_language", "The AI did not answer in the workspace language.")
		} else {
			writeAIError(w, ai.ErrBadReply)
		}
		return
	}
	model := reply.Model
	if model == "" {
		model = run.Creds.Model
	}
	partner := journal.Message{Role: "partner", Text: partnerText, Model: model, Provider: run.Spec.ID}
	var learner *journal.Message
	if text != "" {
		learner = &journal.Message{Role: "learner", Text: text, Annotations: journal.TurnAnnotations(text, t.language, reply.Annotations)}
	}
	// The conversation may have been discarded while the provider worked:
	// AppendTurn writes nothing then.
	out, err := journal.AppendTurn(context.WithoutCancel(r.Context()), s.db, userID, ws, id, in.TurnID, learner, partner)
	if err != nil {
		answerConversationError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// handleSaveConversation serves POST /api/journal/conversations/{id}/save?workspace=
// {entryId, date}: the conversation becomes a journal entry and is removed.
func (s *server) handleSaveConversation(w http.ResponseWriter, r *http.Request) {
	userID, ws, ok := s.journalScope(w, r)
	if !ok {
		return
	}
	body, ok := readBody(w, r, maxConversationBody)
	if !ok {
		return
	}
	var in struct {
		EntryID string `json:"entryId"`
		Date    string `json:"date"`
	}
	if json.Unmarshal(body, &in) != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	e, err := journal.SaveConversation(r.Context(), s.db, userID, ws, r.PathValue("id"), in.EntryID, in.Date)
	if err != nil {
		answerConversationError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, e)
}
