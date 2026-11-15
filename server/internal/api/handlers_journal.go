package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"qinqin/internal/ai"
	"qinqin/internal/journal"
	"qinqin/internal/plugins"
)

const (
	maxJournalBody    = 4 << 10 // POST /api/journal/review and /suggestions: two ids
	maxReviewRunes    = 5000
	aiProviderTimeout = 170 * time.Second
)

var errEmptyEntry = &apiError{"empty", "Write something first."}

// aiTarget is what an AI route needs after the common checks.
type aiTarget struct {
	userID   int64
	ws       int64
	language string
	settings journal.Settings
}

// journalTarget resolves the owned workspace, its language and the journal
// settings. A foreign or unknown workspace is a 404.
func (s *server) journalTarget(w http.ResponseWriter, r *http.Request, userID, workspaceID int64) (aiTarget, bool) {
	var lang string
	err := s.db.QueryRowContext(r.Context(), `SELECT language FROM workspaces WHERE id = ? AND user_id = ?`, workspaceID, userID).Scan(&lang)
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "workspace not found", http.StatusNotFound)
		return aiTarget{}, false
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return aiTarget{}, false
	}
	t := aiTarget{userID: userID, ws: workspaceID, language: lang, settings: journal.ParseSettings(nil)}
	d, err := plugins.GetData(r.Context(), s.db, userID, &workspaceID, journal.PluginID, journal.SettingsKey)
	switch {
	case err == nil:
		t.settings = journal.ParseSettings(d.Data)
	case !errors.Is(err, plugins.ErrNotFound):
		http.Error(w, "internal error", http.StatusInternalServerError)
		return aiTarget{}, false
	}
	return t, true
}

// runAI performs one provider call for the user: the hourly limit and the
// one-in-flight lock are taken, the key is decrypted, and the call runs
// detached from the client (a proxy cutting the request must not lose a paid
// answer) with a 170 s timeout. It records the call either way and returns
// the credentials the call used.
func (s *server) runAI(r *http.Request, userID int64, kind string, call func(ctx context.Context, c ai.Credentials) (model string, usage ai.Usage, err error)) (ai.Credentials, error) {
	if err := s.aiUsable(); err != nil {
		return ai.Credentials{}, err
	}
	release, err := s.ai.Limiter.Acquire(r.Context(), userID)
	if err != nil {
		return ai.Credentials{}, err
	}
	defer release()
	// Only a call that may run decrypts the key and stamps last_used_at.
	creds, err := s.ai.Keys.Credentials(r.Context(), userID)
	if err != nil {
		return ai.Credentials{}, err
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), aiProviderTimeout)
	defer cancel()
	_, usage, err := call(ctx, creds)
	if rerr := s.ai.Limiter.Record(ctx, ai.Call{UserID: userID, Kind: kind, Model: creds.Model, OK: err == nil, Usage: usage}); rerr != nil {
		log.Printf("ai: record %s call: %v", kind, rerr)
	}
	if err != nil {
		// Never err.Error(): SDK errors can carry request details.
		log.Printf("ai %s failed: code=%q", kind, ai.Code(err))
		return creds, err
	}
	return creds, nil
}

func (s *server) putJournalDoc(ctx context.Context, userID, ws int64, key string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = plugins.PutData(ctx, s.db, userID, &ws, journal.PluginID, key, b)
	return err
}

// handleJournalReview serves POST /api/journal/review.
func (s *server) handleJournalReview(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	body, ok := readBody(w, r, maxJournalBody)
	if !ok {
		return
	}
	var req struct {
		WorkspaceID int64  `json:"workspaceId"`
		EntryID     string `json:"entryId"`
	}
	if json.Unmarshal(body, &req) != nil || req.EntryID == "" || len(req.EntryID) > 200 {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	t, ok := s.journalTarget(w, r, u.ID, req.WorkspaceID)
	if !ok {
		return
	}
	d, err := plugins.GetData(r.Context(), s.db, u.ID, &t.ws, journal.PluginID, journal.EntryKey(req.EntryID))
	if errors.Is(err, plugins.ErrNotFound) {
		http.Error(w, "entry not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	entry, err := journal.ParseEntry(d.Data)
	if err != nil || entry.ID != req.EntryID {
		http.Error(w, "entry not found", http.StatusNotFound)
		return
	}
	text := entry.Text
	switch {
	case utf8.RuneCountInString(text) > maxReviewRunes:
		writeAIError(w, errTooLong)
		return
	case strings.TrimSpace(text) == "":
		writeAIError(w, errEmptyEntry)
		return
	}

	var reply ai.ReviewReply
	creds, err := s.runAI(r, u.ID, "review", func(ctx context.Context, c ai.Credentials) (string, ai.Usage, error) {
		var err error
		reply, err = s.ai.Provider.Review(ctx, c, ai.ReviewRequest{
			Language: t.language, ExplanationLanguage: t.settings.ExplanationLanguage,
			Guidance: t.settings.Guidance, Text: text,
		})
		return reply.Model, reply.Usage, err
	})
	if err != nil {
		writeAIError(w, err)
		return
	}
	anns, drop := journal.ResolveAnnotations(text, t.language, reply.Annotations)
	if drop.Total() > 0 {
		log.Printf("review dropped: %+v", drop)
	}
	rev := journal.Review{
		EntryID: entry.ID, TextHash: journal.TextHash(text), Annotations: anns, Overall: reply.Overall,
		Model: reply.Model, Dropped: drop, CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if rev.Annotations == nil {
		rev.Annotations = []journal.Annotation{}
	}
	if reply.Model != "" && reply.Model != creds.Model {
		rev.FallbackFrom = creds.Model
	}
	wctx := context.WithoutCancel(r.Context())
	// The entry may have been deleted while the provider worked: do not leave
	// an orphaned review behind. (A delete in the instant between this check
	// and the write is rare and harmless: the review is swept with its entry.)
	if _, err := plugins.GetData(wctx, s.db, u.ID, &t.ws, journal.PluginID, journal.EntryKey(entry.ID)); errors.Is(err, plugins.ErrNotFound) {
		http.Error(w, "entry not found", http.StatusNotFound)
		return
	} else if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if err := s.putJournalDoc(wctx, u.ID, t.ws, journal.ReviewKey(entry.ID), rev); err != nil {
		log.Printf("journal: store review: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, rev)
}

// handleJournalSuggestions serves POST /api/journal/suggestions.
func (s *server) handleJournalSuggestions(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	body, ok := readBody(w, r, maxJournalBody)
	if !ok {
		return
	}
	var req struct {
		WorkspaceID int64 `json:"workspaceId"`
	}
	if json.Unmarshal(body, &req) != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	t, ok := s.journalTarget(w, r, u.ID, req.WorkspaceID)
	if !ok {
		return
	}
	words, recent, err := journal.SuggestionInput(r.Context(), s.db, u.ID, t.ws, time.Now())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	var reply ai.SuggestReply
	_, err = s.runAI(r, u.ID, "suggest", func(ctx context.Context, c ai.Credentials) (string, ai.Usage, error) {
		var err error
		reply, err = s.ai.Provider.Suggest(ctx, c, ai.SuggestRequest{
			Language: t.language, ExplanationLanguage: t.settings.ExplanationLanguage, Words: words, Recent: recent,
		})
		return reply.Model, reply.Usage, err
	})
	if err != nil {
		writeAIError(w, err)
		return
	}
	doc := journal.Suggestions{
		Items: journal.FilterSuggestionWords(reply.Items, words), Model: reply.Model,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if doc.Items == nil {
		doc.Items = []ai.SuggestionItem{}
	}
	if err := s.putJournalDoc(context.WithoutCancel(r.Context()), u.ID, t.ws, journal.SuggestionsKey, doc); err != nil {
		log.Printf("journal: store suggestions: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

// handleJournalCapabilities serves GET /api/journal/capabilities?workspace=.
func (s *server) handleJournalCapabilities(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id, err := strconv.ParseInt(r.URL.Query().Get("workspace"), 10, 64)
	if err != nil {
		http.Error(w, "workspace must be an integer", http.StatusBadRequest)
		return
	}
	t, ok := s.journalTarget(w, r, u.ID, id)
	if !ok {
		return
	}
	st, err := s.ai.Status(r.Context(), u.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ai": st,
		"ocr": map[string]any{
			"available":     s.ocrAvailable(),
			"languageReady": s.ocrAvailable() && s.ocr.HasLanguages(journal.OCRLanguages(t.language)),
			"language":      t.language,
		},
	})
}
