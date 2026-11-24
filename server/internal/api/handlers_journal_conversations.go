package api

import (
	"context"
	"encoding/json"
	"errors"
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

// handleConversationTurn serves POST /api/journal/conversations/{id}/turn?workspace=
// {text}: one provider call with the learner's own key. The learner's message
// and the partner's reply are stored together once the call succeeded; a
// failed call stores nothing.
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
		Text string `json:"text"`
	}
	if json.Unmarshal(body, &in) != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	c, err := journal.GetConversation(r.Context(), s.db, userID, ws, r.PathValue("id"))
	if err != nil {
		answerConversationError(w, r, err)
		return
	}
	text := strings.TrimSpace(in.Text)
	switch err := journal.CheckTurnText(text, len(c.Messages) > 0); journal.TurnTextCode(err) {
	case "":
	case "empty":
		writeAIError(w, errEmptyEntry)
		return
	case "too_long":
		writeAIError(w, errMessageTooLong)
		return
	default:
		answerConversationError(w, r, err)
		return
	}
	if text != "" && journal.ConversationFull(c) || text == "" && len(c.Messages)+1 > journal.MaxMessages {
		answerConversationError(w, r, journal.ErrConversationFull)
		return
	}
	t, ok := s.journalTarget(w, r, userID, ws)
	if !ok {
		return
	}
	words, _, err := journal.SuggestionInput(r.Context(), s.db, userID, ws, time.Now())
	if err != nil {
		writeInternal(w, r)
		return
	}
	history := make([]ai.Turn, 0, len(c.Messages))
	nextSeq := 1
	for _, m := range c.Messages {
		history = append(history, ai.Turn{Role: m.Role, Text: m.Text})
		nextSeq = max(nextSeq, m.Seq+1)
	}
	var reply ai.ConverseReply
	run, err := s.runAI(r, userID, "converse", func(ctx context.Context, p ai.Provider, _ ai.ProviderSpec, cr ai.Credentials) (ai.CallResult, error) {
		var err error
		reply, err = p.Converse(ctx, cr, ai.ConverseRequest{
			Language: t.language, ExplanationLanguage: t.settings.ExplanationLanguage, Guidance: t.settings.Guidance,
			Level: c.Level, Topic: c.Topic, Words: journal.WordSample(words), History: history, Text: text,
		})
		return ai.CallResult{Model: reply.Model, Usage: reply.Usage, Calls: reply.Calls}, err
	})
	if err != nil {
		writeAIError(w, err)
		return
	}
	partnerText, ok := journal.PartnerReply(t.language, reply.Reply)
	if !ok {
		log.Printf("ai converse: provider=%s code=bad_reply (empty or not in the workspace language)", run.Spec.ID)
		writeAIError(w, ai.ErrBadReply)
		return
	}
	model := reply.Model
	if model == "" {
		model = run.Creds.Model
	}
	partner := journal.Message{Role: "partner", Text: partnerText, Model: model, Provider: run.Spec.ID}
	var learner *journal.Message
	if text != "" {
		learner = &journal.Message{Role: "learner", Text: text, Annotations: journal.TurnAnnotations(text, t.language, nextSeq, reply.Annotations)}
	}
	// The conversation may have been discarded while the provider worked:
	// AppendTurn writes nothing then.
	out, err := journal.AppendTurn(context.WithoutCancel(r.Context()), s.db, userID, ws, c.ID, learner, partner)
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
