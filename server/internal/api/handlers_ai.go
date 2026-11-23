package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
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
	errInvalidModel = &apiError{"invalid_model", "That model id is not valid. Use letters, digits and . _ : / @ -, up to 200 characters."}
	errInvalidKey   = &apiError{"invalid_key", "That does not look like an API key."}
	errForbidden    = &apiError{"forbidden", "Only an admin can do that."}
)

// errNoVision is the 409 for reading a photo with a model that cannot see it.
func errNoVision(model, providerName string) error {
	return &apiError{"no_vision", model + " on " + providerName + " can't read photos. Read it offline instead."}
}

// errInvalidEndpoint is the 422 for a refused custom-endpoint field.
func errInvalidEndpoint(why string) error { return &apiError{"invalid_endpoint", why} }

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
	"no_access":         "Your key has no access to this model or action. Check the key's permissions with the provider.",
	"refused":           "The AI declined to answer this request.",
	"truncated":         "The answer was cut off. Try a shorter text.",
	"bad_reply":         "The AI answer could not be read. Try again.",
	"bad_request":       "The provider refused the request.",
	"in_flight":         "Another AI request is still running.",
	"no_key":            "Add an API key in Settings → AI first.",
	"key_undecryptable": "Your key was stored with a different QINQIN_SECRET. Enter it again.",
	"no_selection":      "Choose which provider to use in Settings → AI.",
	"unknown_provider":  "That provider does not exist.",
	"provider_disabled": "This provider is turned off by the server.",
	"endpoint_blocked":  "That address is not allowed.",
	"forbidden":         "Only an admin can do that.",
	"invalid_endpoint":  "That endpoint is not valid.",
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
		writeError(w, http.StatusInternalServerError, "internal", "Internal server error.")
		return
	}
	status := http.StatusUnprocessableEntity
	switch code {
	case "no_key", "ai_disabled", "key_undecryptable", "in_flight", "no_selection", "no_vision", "provider_disabled":
		status = http.StatusConflict
	case "unknown_provider":
		status = http.StatusNotFound
	case "forbidden":
		status = http.StatusForbidden
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
	writeError(w, status, code, msg)
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
	case !s.ai.HasProviders():
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

// providerOut is a provider as the API lists it. Built-in base URLs are never
// shown; a custom endpoint shows its host to everyone and its full URL to
// admins.
type providerOut struct {
	ai.ProviderSpec
	Host string `json:"host,omitempty"`
}

// handleAIProviders serves GET /api/ai/providers.
func (s *server) handleAIProviders(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	out := struct {
		Providers       []providerOut `json:"providers"`
		CanManageCustom bool          `json:"canManageCustom"`
		PrivateAllowed  bool          `json:"privateAllowed"`
	}{Providers: []providerOut{}}
	if s.ai == nil {
		for _, b := range ai.Builtins() {
			b.BaseURL = ""
			out.Providers = append(out.Providers, providerOut{ProviderSpec: b})
		}
		writeJSON(w, http.StatusOK, out)
		return
	}
	all, err := s.ai.AllProviders(r.Context())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	for _, p := range all {
		po := providerOut{ProviderSpec: p}
		if p.Custom {
			if pu, err := url.Parse(p.BaseURL); err == nil {
				po.Host = pu.Host
			}
		}
		if !p.Custom || !u.Admin {
			po.BaseURL = ""
		}
		out.Providers = append(out.Providers, po)
	}
	out.CanManageCustom = u.Admin && s.ai.CustomEnabled()
	out.PrivateAllowed = s.ai.PrivateAllowed()
	writeJSON(w, http.StatusOK, out)
}

// aiProvider resolves the {provider} path value to a usable spec, writing
// the AI error when it is unknown or turned off.
func (s *server) aiProvider(w http.ResponseWriter, r *http.Request) (ai.ProviderSpec, bool) {
	if err := s.aiUsable(); err != nil {
		writeAIError(w, err)
		return ai.ProviderSpec{}, false
	}
	spec, err := s.ai.Lookup(r.Context(), r.PathValue("provider"))
	if err != nil {
		writeAIError(w, err)
		return ai.ProviderSpec{}, false
	}
	return spec, true
}

// validateAIKey checks credentials against the provider: it takes the hourly
// limit and the in-flight lock, makes one call and records it.
func (s *server) validateAIKey(ctx context.Context, userID int64, spec ai.ProviderSpec, apiKey, model string) error {
	release, err := s.ai.Limiter.Acquire(ctx, userID)
	if err != nil {
		return err
	}
	defer release()
	adapter, err := s.ai.Adapter(spec)
	if err != nil {
		return err
	}
	vctx, cancel := context.WithTimeout(ctx, aiProviderTimeout)
	defer cancel()
	creds := ai.Credentials{APIKey: apiKey, Model: model, BaseURL: spec.BaseURL, Provider: spec.ID}
	calls, verr := 1, error(nil)
	if cc, ok := adapter.(ai.CallCounter); ok {
		calls, verr = cc.ValidateCounted(vctx, creds)
	} else {
		verr = adapter.Validate(vctx, creds)
	}
	// One row per provider call: a fallback to a second call counts twice.
	for i := 1; i <= max(calls, 1); i++ {
		ok := verr == nil || i < calls
		_ = s.ai.Limiter.Record(ctx, ai.Call{UserID: userID, Kind: "validate", Model: model, Provider: spec.ID, OK: ok})
	}
	if verr != nil {
		log.Printf("ai validate failed: provider=%s code=%q", spec.ID, ai.Code(verr))
	}
	return verr
}

// handlePutAIKey serves PUT /api/ai/keys/{provider}. With a key it is checked
// against the provider (one call toward the hourly limit) and stored; without
// one only the model changes. The first stored key becomes the active one.
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
		Key   string `json:"key"`
		Model string `json:"model"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	spec, ok := s.aiProvider(w, r)
	if !ok {
		return
	}
	if req.Model != "" && !ai.ValidModelID(req.Model) {
		writeAIError(w, errInvalidModel)
		return
	}
	ctx := context.WithoutCancel(r.Context())
	existing, ierr := s.ai.Keys.Info(ctx, u.ID, spec.ID)
	if ierr != nil && !errors.Is(ierr, ai.ErrNoKey) {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	hasKey := ierr == nil
	key := strings.TrimSpace(req.Key)
	if key == "" && (spec.KeyRequired || hasKey) {
		// Model only.
		if req.Model == "" {
			writeAIError(w, errInvalidModel)
			return
		}
		if err := s.ai.Keys.SetModel(ctx, u.ID, spec.ID, req.Model); err != nil {
			writeAIError(w, err)
			return
		}
		s.writeAIStatus(w, r, u.ID)
		return
	}
	if key != "" && (len(key) < 20 || len(key) > 400 || strings.IndexFunc(key, unicode.IsSpace) >= 0) {
		writeAIError(w, errInvalidKey)
		return
	}
	model := req.Model
	if model == "" {
		model = spec.DefaultModel
		if hasKey && ai.ValidModelID(existing.Model) {
			model = existing.Model // a new key keeps the model the learner chose
		}
	}
	if err := s.validateAIKey(ctx, u.ID, spec, key, model); err != nil {
		writeAIError(w, err)
		return
	}
	if err := s.ai.Keys.Put(ctx, u.ID, spec.ID, key, model, ai.PutOptions{AllowEmptyKey: !spec.KeyRequired}); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if _, err := s.ai.Selection.Active(ctx, u.ID); errors.Is(err, ai.ErrNoSelection) {
		if err := s.ai.Selection.SetActive(ctx, u.ID, spec.ID); err != nil {
			log.Printf("ai: first key became active: %v", err)
		}
	}
	s.writeAIStatus(w, r, u.ID)
}

// handleTestAIKey serves POST /api/ai/keys/{provider}/test: the stored key is
// validated again (one call toward the hourly limit).
func (s *server) handleTestAIKey(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	spec, ok := s.aiProvider(w, r)
	if !ok {
		return
	}
	ctx := context.WithoutCancel(r.Context())
	creds, err := s.ai.Keys.Credentials(ctx, u.ID, spec.ID)
	if err != nil {
		writeAIError(w, err)
		return
	}
	if err := s.validateAIKey(ctx, u.ID, spec, creds.APIKey, creds.Model); err != nil {
		writeAIError(w, err)
		return
	}
	s.writeAIStatus(w, r, u.ID)
}

// handleSetActiveAI serves PUT /api/ai/active.
func (s *server) handleSetActiveAI(w http.ResponseWriter, r *http.Request) {
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
	}
	if err := json.Unmarshal(body, &req); err != nil || req.Provider == "" {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	if err := s.aiUsable(); err != nil {
		writeAIError(w, err)
		return
	}
	spec, err := s.ai.Lookup(r.Context(), req.Provider)
	if err != nil {
		writeAIError(w, err)
		return
	}
	if err := s.ai.Selection.SetActive(context.WithoutCancel(r.Context()), u.ID, spec.ID); err != nil {
		writeAIError(w, err)
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

// handleDeleteAIKey serves DELETE /api/ai/keys/{provider}; deleting nothing is
// fine. A selection on that provider is cleared, never moved to another one.
func (s *server) handleDeleteAIKey(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	id := r.PathValue("provider")
	// Straight on the tables: deleting must work without a usable secret and
	// for a provider that no longer exists.
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()
	for _, q := range []string{
		`DELETE FROM ai_keys WHERE user_id = ? AND provider = ?`,
		`DELETE FROM ai_selection WHERE user_id = ? AND provider = ?`,
	} {
		if _, err := tx.ExecContext(r.Context(), q, u.ID, id); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
