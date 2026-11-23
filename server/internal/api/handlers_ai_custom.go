package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"qinqin/internal/ai"
	"qinqin/internal/model"
)

const maxCustomBody = 4 << 10

// requireCustomAdmin gates the custom-endpoint routes: 401 without a token
// (the shared auth rule), 403 JSON for a non-admin, 409 provider_disabled
// when the operator turned custom endpoints off.
func (s *server) requireCustomAdmin(w http.ResponseWriter, r *http.Request) (*model.User, bool) {
	p := s.requirePrincipal(w, r)
	if p == nil {
		return nil, false
	}
	// Admin-only: an access token never manages endpoints (tokenGate refuses
	// it first; this holds even if the route row were marked).
	if p.ViaToken() {
		writeError(w, http.StatusForbidden, "token_not_allowed", "Access tokens cannot be used on this route.")
		return nil, false
	}
	u := &p.User
	if !u.Admin {
		writeAIError(w, errForbidden)
		return nil, false
	}
	if s.ai == nil || s.ai.Registry == nil || s.ai.Registry.Custom == nil || !s.ai.CustomEnabled() {
		writeAIError(w, ai.ErrProviderDisabled)
		return nil, false
	}
	return u, true
}

// writeCustomError maps the store's refusals; a blocked URL says which rule
// refused it, without echoing the URL.
func writeCustomError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ai.ErrEndpointBlocked):
		writeAIError(w, &apiError{"endpoint_blocked", blockedMessage(err)})
	case errors.Is(err, ai.ErrInvalidEndpoint):
		writeAIError(w, errInvalidEndpoint(strings.TrimPrefix(err.Error(), "ai: invalid custom endpoint: ")))
	default:
		writeAIError(w, err)
	}
}

func blockedMessage(err error) string {
	switch {
	case strings.Contains(err.Error(), "scheme"):
		return "Use an https address. http is only accepted for local addresses when QINQIN_AI_ALLOW_PRIVATE=1 is set."
	case strings.Contains(err.Error(), "userinfo"), strings.Contains(err.Error(), "query"):
		return "The address must not contain a user name, password, query or fragment."
	case strings.Contains(err.Error(), "host"):
		return "Use a host name or a plain IP address."
	}
	return "That address is never allowed (link-local, cloud metadata, multicast or unspecified)."
}

// privateOrNever tells a private address (blocked only by the switch) from
// one that is never allowed, to give the admin the right hint.
func privateOrNever(raw string, err error) error {
	if !errors.Is(err, ai.ErrEndpointBlocked) || !strings.Contains(err.Error(), "address") {
		return err
	}
	if _, e := ai.CheckEndpointURL(raw, ai.GuardPolicy{AllowPrivate: true}); e == nil {
		return &apiError{"endpoint_blocked", "Private network addresses are off. Set QINQIN_AI_ALLOW_PRIVATE=1 to allow them."}
	}
	return err
}

// handleCreateCustomProvider serves POST /api/ai/custom-providers.
func (s *server) handleCreateCustomProvider(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireCustomAdmin(w, r)
	if !ok {
		return
	}
	body, ok := readBody(w, r, maxCustomBody)
	if !ok {
		return
	}
	var req struct {
		Name            string        `json:"name"`
		BaseURL         string        `json:"baseUrl"`
		DefaultModel    string        `json:"defaultModel"`
		Vision          bool          `json:"vision"`
		KeyRequired     bool          `json:"keyRequired"`
		Structured      ai.Structured `json:"structured"`
		MaxOutputTokens *int          `json:"maxOutputTokens"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	sp, err := s.ai.Registry.Custom.Create(context.WithoutCancel(r.Context()), u.ID, ai.CustomInput{
		Name: req.Name, BaseURL: req.BaseURL, DefaultModel: req.DefaultModel, Vision: req.Vision,
		KeyRequired: req.KeyRequired, Structured: req.Structured, MaxOutputTokens: req.MaxOutputTokens})
	if err != nil {
		if errors.Is(err, ai.ErrEndpointBlocked) {
			if perr := privateOrNever(req.BaseURL, err); perr != err {
				writeAIError(w, perr)
				return
			}
		}
		writeCustomError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, sp)
}

// handlePatchCustomProvider serves PATCH /api/ai/custom-providers/{id}: the
// default model, vision flag, structured mode and token cap only.
func (s *server) handlePatchCustomProvider(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireCustomAdmin(w, r); !ok {
		return
	}
	body, ok := readBody(w, r, maxCustomBody)
	if !ok {
		return
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	for f := range fields {
		switch f {
		case "defaultModel", "vision", "structured", "maxOutputTokens":
		default:
			writeAIError(w, errInvalidEndpoint("Only the default model, photo reading, structured mode and token limit can be changed. Delete and re-add the endpoint to change anything else."))
			return
		}
	}
	var req struct {
		DefaultModel    *string        `json:"defaultModel"`
		Vision          *bool          `json:"vision"`
		Structured      *ai.Structured `json:"structured"`
		MaxOutputTokens *int           `json:"maxOutputTokens"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	clear := string(bytes.TrimSpace(fields["maxOutputTokens"])) == "null" // a JSON null removes the cap
	sp, err := s.ai.Registry.Custom.Update(context.WithoutCancel(r.Context()), r.PathValue("id"), ai.CustomPatch{
		DefaultModel: req.DefaultModel, Vision: req.Vision, Structured: req.Structured, MaxOutputTokens: req.MaxOutputTokens,
		ClearMaxOutputTokens: clear})
	if err != nil {
		writeCustomError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sp)
}

// handleDeleteCustomProvider serves DELETE /api/ai/custom-providers/{id}: the
// endpoint, every user's key for it and every selection on it go together.
func (s *server) handleDeleteCustomProvider(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireCustomAdmin(w, r); !ok {
		return
	}
	id := r.PathValue("id")
	ctx := context.WithoutCancel(r.Context())
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		writeInternal(w, r)
		return
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `DELETE FROM ai_custom_providers WHERE id = ?`, id)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeAIError(w, ai.ErrUnknownProvider)
		return
	}
	for _, q := range []string{`DELETE FROM ai_keys WHERE provider = ?`, `DELETE FROM ai_selection WHERE provider = ?`} {
		if _, err := tx.ExecContext(ctx, q, id); err != nil {
			writeInternal(w, r)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeInternal(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
