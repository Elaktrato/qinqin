package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"

	"qinqin/internal/ai"
)

const maxAIKeyBody = 4 << 10

// apiError is an error of our own with a stable API code; the provider's
// errors map through ai.Code.
type apiError struct{ code, msg string }

func (e *apiError) Error() string { return e.code }

var (
	errTooLong      = &apiError{"too_long", "The text is longer than 5,000 characters."}
	errInvalidModel = &apiError{"invalid_model", "Choose one of the listed models."}
	errInvalidKey   = &apiError{"invalid_key", "That does not look like an API key."}
	errInvalidProv  = &apiError{"invalid_provider", "Only the anthropic provider is supported."}
)

// errAIDisabled is the 409 for a server without a usable secret or provider;
// reason is a Status reason.
func errAIDisabled(reason string) error {
	switch reason {
	case "invalid_secret":
		return &apiError{"ai_disabled", "QINQIN_SECRET is set but is not 32 bytes of base64."}
	case "no_provider":
		return &apiError{"ai_disabled", "The AI provider is not configured on the server."}
	}
	return &apiError{"ai_disabled", "Set QINQIN_SECRET on the server to store an API key."}
}

// aiMessages are the user-facing texts per code.
var aiMessages = map[string]string{
	"key_rejected":      "The provider rejected the API key.",
	"quota":             "Your provider account is out of credit or over its quota.",
	"busy":              "The provider is busy. Try again in a moment.",
	"model_unavailable": "This model is not available for your key.",
	"refused":           "The AI declined to answer this request.",
	"truncated":         "The answer was cut off. Try a shorter text.",
	"bad_reply":         "The AI answer could not be read. Try again.",
	"bad_request":       "The provider refused the request.",
	"in_flight":         "Another AI request is still running.",
	"no_key":            "Add an API key in Settings → AI first.",
	"key_undecryptable": "Your key was stored with a different QINQIN_SECRET. Enter it again.",
}

// writeAIError is the single mapping from AI errors to HTTP. It never
// answers 401: the web client logs the user out on any 401.
func writeAIError(w http.ResponseWriter, err error) {
	var ae *apiError
	var rl *ai.RateLimitedError
	var busy *ai.BusyError
	code, msg := "", ""
	switch {
	case errors.As(err, &ae):
		code, msg = ae.code, ae.msg
	case errors.Is(err, ai.ErrNoKey):
		code = "no_key"
	case errors.Is(err, ai.ErrKeyUndecryptable):
		code = "key_undecryptable"
	default:
		code = ai.Code(err)
	}
	if code == "" {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	status := http.StatusUnprocessableEntity
	switch code {
	case "no_key", "ai_disabled", "key_undecryptable", "in_flight":
		status = http.StatusConflict
	case "too_long":
		status = http.StatusRequestEntityTooLarge
	case "rate_limited":
		status = http.StatusTooManyRequests
		wait := time.Minute
		if errors.As(err, &rl) {
			wait = rl.RetryAfter
		}
		w.Header().Set("Retry-After", strconv.Itoa(secondsCeil(wait)))
		msg = fmt.Sprintf("You have used %d AI calls this hour. Try again in %d minutes.", ai.HourlyLimit, max(1, int(math.Ceil(wait.Minutes()))))
	case "busy":
		status = http.StatusServiceUnavailable
		wait := 30 * time.Second
		if errors.As(err, &busy) {
			wait = busy.RetryAfter
		}
		w.Header().Set("Retry-After", strconv.Itoa(secondsCeil(wait)))
	}
	if msg == "" {
		msg = aiMessages[code]
	}
	writeJSON(w, status, map[string]string{"error": code, "message": msg})
}

func secondsCeil(d time.Duration) int { return max(1, int(math.Ceil(d.Seconds()))) }

// aiUsable reports why the AI cannot store or use keys, as an error, or nil.
func (s *server) aiUsable() error {
	if s.ai == nil {
		return errAIDisabled("no_secret")
	}
	switch {
	case s.ai.Secret == ai.SecretInvalid:
		return errAIDisabled("invalid_secret")
	case s.ai.Secret != ai.SecretOK || s.ai.Keys == nil:
		return errAIDisabled("no_secret")
	case s.ai.Provider == nil:
		return errAIDisabled("no_provider")
	}
	return nil
}

// handleAIStatus serves GET /api/ai/status.
func (s *server) handleAIStatus(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	st, err := s.ai.Status(r.Context(), u.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// handleGetAIKey serves GET /api/ai/key: what is known about the stored key,
// never the key.
func (s *server) handleGetAIKey(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	if s.ai == nil || s.ai.Keys == nil {
		writeAIError(w, ai.ErrNoKey)
		return
	}
	info, err := s.ai.Keys.Info(r.Context(), u.ID)
	if errors.Is(err, ai.ErrNoKey) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no_key", "message": aiMessages["no_key"]})
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

// handlePutAIKey serves PUT /api/ai/key. With a key it is checked against the
// provider (one call toward the hourly limit) and stored; without one only
// the model changes.
func (s *server) handlePutAIKey(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	body, ok := readBody(w, r, maxAIKeyBody)
	if !ok {
		return
	}
	var req struct {
		Provider string `json:"provider"`
		Key      string `json:"key"`
		Model    string `json:"model"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	if err := s.aiUsable(); err != nil {
		writeAIError(w, err)
		return
	}
	if req.Provider == "" {
		req.Provider = "anthropic"
	}
	if req.Provider != "anthropic" {
		writeAIError(w, errInvalidProv)
		return
	}
	if req.Model != "" && !ai.ValidModel(req.Model) {
		writeAIError(w, errInvalidModel)
		return
	}
	ctx := r.Context()
	if req.Key == "" {
		if req.Model == "" {
			writeAIError(w, errInvalidModel)
			return
		}
		if err := s.ai.Keys.SetModel(ctx, u.ID, req.Model); err != nil {
			writeAIError(w, err)
			return
		}
		s.writeAIStatus(w, r, u.ID)
		return
	}
	key := strings.TrimSpace(req.Key)
	if len(key) < 20 || len(key) > 400 || strings.IndexFunc(key, unicode.IsSpace) >= 0 {
		writeAIError(w, errInvalidKey)
		return
	}
	model := req.Model
	if model == "" {
		model = ai.DefaultModel
		if info, err := s.ai.Keys.Info(ctx, u.ID); err == nil && ai.ValidModel(info.Model) {
			model = info.Model // a new key keeps the model the learner chose
		}
	}
	release, err := s.ai.Limiter.Acquire(ctx, u.ID)
	if err != nil {
		writeAIError(w, err)
		return
	}
	verr := s.ai.Provider.Validate(ctx, ai.Credentials{APIKey: key, Model: model})
	release()
	_ = s.ai.Limiter.Record(ctx, ai.Call{UserID: u.ID, Kind: "validate", Model: model, OK: verr == nil})
	if verr != nil {
		writeAIError(w, verr)
		return
	}
	if err := s.ai.Keys.Put(ctx, u.ID, req.Provider, key, model); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	s.writeAIStatus(w, r, u.ID)
}

func (s *server) writeAIStatus(w http.ResponseWriter, r *http.Request, userID int64) {
	st, err := s.ai.Status(r.Context(), userID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// handleDeleteAIKey serves DELETE /api/ai/key; deleting nothing is fine.
func (s *server) handleDeleteAIKey(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	if s.ai != nil && s.ai.Keys != nil {
		if err := s.ai.Keys.Delete(r.Context(), u.ID); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}
