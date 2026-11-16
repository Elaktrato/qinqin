package api

import (
	"errors"
	"net/http"
	"strconv"

	"qinqin/internal/auth"
)

// Personal access token management (docs/contracts/auth/tokens.json). Every
// route needs a full session: the rows carry no token rule, so tokenGate
// answers an access token 403 token_not_allowed first (a token never mints
// or lists tokens). Nothing here logs; the token string leaves the server
// once, in the create answer.

// tokenCreateBody is the body of POST /api/account/tokens.
type tokenCreateBody struct {
	Name            string `json:"name"`
	Scope           string `json:"scope"`
	WorkspaceID     *int64 `json:"workspaceId"`
	ExpiresInDays   int    `json:"expiresInDays"`
	CurrentPassword string `json:"currentPassword"`
}

// handleCreateToken mints a token: the form is checked (422
// invalid_token_request), the current password is required (403
// current_password_required / wrong_password, counted in reauth), creations
// spend the pat-create budget, and the answer is 201 {token, accessToken}
// with Cache-Control: no-store.
func (s *server) handleCreateToken(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r)
	if p == nil {
		return
	}
	var req tokenCreateBody
	if !readAccountBodyStrict(w, r, &req) {
		return
	}
	treq := auth.TokenRequest{Name: req.Name, Scope: req.Scope, WorkspaceID: req.WorkspaceID, ExpiresInDays: req.ExpiresInDays}
	if !writeTokenRequestError(w, auth.ValidateTokenRequest(treq)) {
		return
	}
	if req.CurrentPassword == "" {
		writeAuthError(w, http.StatusForbidden, "current_password_required", "Enter your current password to continue.")
		return
	}
	if ok, retry := s.authLimiter("pat-create").Allow(int64Key(p.User.ID)); !ok {
		s.logThrottled("pat-create")
		writeRateLimitedAs(w, retry, "new access tokens")
		return
	}
	refund, ok := s.reauth(w, p.User.ID)
	if !ok {
		return
	}
	var good bool
	err := s.withHashGate(r.Context(), func() error {
		var e error
		good, e = auth.VerifyUserPassword(r.Context(), s.db, p.User.ID, req.CurrentPassword)
		return e
	})
	switch {
	case err != nil && r.Context().Err() != nil:
		writeClientGone(w)
		return
	case errors.Is(err, errHashBusy):
		refund()
		writeBusy(w)
		return
	case err != nil:
		refund()
		writeInternal(w, r)
		return
	case !good:
		writeAuthError(w, http.StatusForbidden, "wrong_password", "The current password is wrong.")
		return
	}
	refund()
	token, info, err := auth.CreateToken(r.Context(), s.db, p.User.ID, treq)
	switch {
	case errors.Is(err, auth.ErrWorkspaceNotFound):
		writeAuthError(w, http.StatusNotFound, "not_found", "No such workspace.")
		return
	case errors.Is(err, auth.ErrTokenLimit):
		writeAuthError(w, http.StatusConflict, "token_limit", "You already have 20 access tokens. Revoke one first.")
		return
	case errors.Is(err, auth.ErrTokenRequest):
		writeTokenRequestError(w, err)
		return
	case err != nil:
		writeInternal(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusCreated, struct {
		Token       string         `json:"token"`
		AccessToken auth.TokenInfo `json:"accessToken"`
	}{token, info})
}

// writeTokenRequestError answers a *TokenRequestError as 422 and reports
// false; nil reports true.
func writeTokenRequestError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return true
	}
	var re *auth.TokenRequestError
	msg := "The access token request is invalid."
	if errors.As(err, &re) {
		msg = re.Message
	}
	writeAuthError(w, http.StatusUnprocessableEntity, "invalid_token_request", msg)
	return false
}

// handleListTokens serves GET /api/account/tokens: the caller's tokens,
// newest first, never a token or a hash.
func (s *server) handleListTokens(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r)
	if p == nil {
		return
	}
	list, err := auth.ListTokens(r.Context(), s.db, p.User.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"accessTokens": list})
}

// handleRevokeToken serves DELETE /api/account/tokens/{id} (204); unknown
// and other users' ids are 404.
func (s *server) handleRevokeToken(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r)
	if p == nil {
		return
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err == nil {
		err = auth.RevokeToken(r.Context(), s.db, p.User.ID, id)
	} else {
		err = auth.ErrTokenNotFound
	}
	switch {
	case errors.Is(err, auth.ErrTokenNotFound):
		writeAuthError(w, http.StatusNotFound, "not_found", "No such access token.")
		return
	case err != nil:
		writeInternal(w, r)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleRevokeAllTokens serves DELETE /api/account/tokens: {revoked: n}.
func (s *server) handleRevokeAllTokens(w http.ResponseWriter, r *http.Request) {
	p := s.requirePrincipal(w, r)
	if p == nil {
		return
	}
	n, err := auth.RevokeAllTokens(r.Context(), s.db, p.User.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"revoked": n})
}
