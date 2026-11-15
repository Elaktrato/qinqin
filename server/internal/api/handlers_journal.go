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

// aiRun is what a finished provider call used.
type aiRun struct {
	Creds ai.Credentials
	Spec  ai.ProviderSpec
}

// runAI performs one provider call for the user with the provider the user
// selected: the hourly limit and the one-in-flight lock are taken, the active
// provider and its key are resolved (a user can only ever reach their own
// selection and their own keys), and the call runs detached from the client
// (a proxy cutting the request must not lose a paid answer) with a 170 s
// timeout. Every provider call the action made is recorded, repairs included.
func (s *server) runAI(r *http.Request, userID int64, kind string, call func(ctx context.Context, p ai.Provider, spec ai.ProviderSpec, c ai.Credentials) (ai.CallResult, error)) (aiRun, error) {
	if err := s.aiUsable(); err != nil {
		return aiRun{}, err
	}
	release, err := s.ai.Limiter.Acquire(r.Context(), userID)
	if err != nil {
		return aiRun{}, err
	}
	defer release()
	// Only a call that may run decrypts the key and stamps last_used_at.
	provider, spec, creds, err := s.ai.For(r.Context(), userID)
	if err != nil {
		return aiRun{}, err
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), aiProviderTimeout)
	defer cancel()
	res, err := call(ctx, provider, spec, creds)
	s.recordAICalls(ctx, userID, kind, spec.ID, creds.Model, res, err)
	run := aiRun{Creds: creds, Spec: spec}
	if err != nil {
		// Never err.Error(): provider errors can carry request details.
		log.Printf("ai %s failed: provider=%s code=%q", kind, spec.ID, ai.Code(err))
		return run, err
	}
	return run, nil
}

// recordAICalls writes one ai_calls row per provider call the action made.
// An adapter that reports no Calls made one call.
func (s *server) recordAICalls(ctx context.Context, userID int64, kind, provider, model string, res ai.CallResult, callErr error) {
	if res.Model != "" {
		model = res.Model
	}
	calls := res.Calls
	if len(calls) == 0 {
		calls = []ai.CallUsage{{Kind: kind, Usage: res.Usage}}
	}
	for i, c := range calls {
		ok := callErr == nil || i < len(calls)-1
		if rerr := s.ai.Limiter.Record(ctx, ai.Call{UserID: userID, Kind: c.Kind, Model: model, Provider: provider, OK: ok, Usage: c.Usage}); rerr != nil {
			log.Printf("ai: record %s call: %v", c.Kind, rerr)
		}
	}
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
	run, err := s.runAI(r, u.ID, "review", func(ctx context.Context, p ai.Provider, _ ai.ProviderSpec, c ai.Credentials) (ai.CallResult, error) {
		var err error
		reply, err = p.Review(ctx, c, ai.ReviewRequest{
			Language: t.language, ExplanationLanguage: t.settings.ExplanationLanguage,
			Guidance: t.settings.Guidance, Text: text,
		})
		return ai.CallResult{Model: reply.Model, Usage: reply.Usage, Calls: reply.Calls}, err
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
		Model: reply.Model, Provider: run.Spec.ID, Dropped: drop, CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if rev.Annotations == nil {
		rev.Annotations = []journal.Annotation{}
	}
	rev.FallbackFrom = reply.FallbackFrom
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
	run, err := s.runAI(r, u.ID, "suggest", func(ctx context.Context, p ai.Provider, _ ai.ProviderSpec, c ai.Credentials) (ai.CallResult, error) {
		var err error
		reply, err = p.Suggest(ctx, c, ai.SuggestRequest{
			Language: t.language, ExplanationLanguage: t.settings.ExplanationLanguage, Words: words, Recent: recent,
		})
		return ai.CallResult{Model: reply.Model, Usage: reply.Usage, Calls: reply.Calls}, err
	})
	if err != nil {
		writeAIError(w, err)
		return
	}
	doc := journal.Suggestions{
		Items: journal.FilterSuggestionWords(reply.Items, words), Model: reply.Model, Provider: run.Spec.ID,
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
