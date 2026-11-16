package api

import (
	"context"
	"net/http"
	"strconv"

	"qinqin/internal/auth"
)

// Personal access tokens (docs/superpowers/specs/2026-11-16-v030s-access-tokens-design.md).
// Every route row carries a tokenRule; its zero value refuses tokens, so a
// new route is unusable with a token until someone decides otherwise.

// tokenScope is what a route needs of a token: nothing (refused), read or
// write.
type tokenScope int

const (
	tokNone  tokenScope = iota // not usable with an access token
	tokRead                    // a read or write token
	tokWrite                   // a write token
)

// tokenWS is how a route relates to the workspace limit of a token.
type tokenWS int

const (
	// wsNone: the route spans workspaces or addresses objects by id; a
	// workspace-limited token is refused.
	wsNone tokenWS = iota
	// wsGlobal: the route reads no per-workspace data (dictionaries,
	// search); a limited token passes. Only with tokRead.
	wsGlobal
	// wsQuery: the route confines itself to ?workspace=<id>; a limited
	// token must send exactly its own workspace.
	wsQuery
)

// tokenRule is a route's access token decision.
type tokenRule struct {
	scope tokenScope
	ws    tokenWS
}

// The rules a route row uses (the fifth field of route{}).
var (
	noTok         = tokenRule{}
	tokReadGlobal = tokenRule{tokRead, wsGlobal}
	tokReadAny    = tokenRule{tokRead, wsNone}
	tokReadWS     = tokenRule{tokRead, wsQuery}
	tokWriteAny   = tokenRule{tokWrite, wsNone}
	tokWriteWS    = tokenRule{tokWrite, wsQuery}
)

// gatePrincipalKey carries the principal tokenGate resolved to the handler.
type gatePrincipalKey struct{}

// gatePrincipal is the access token principal tokenGate put in the
// request context, or nil.
func gatePrincipal(r *http.Request) *auth.Principal {
	p, _ := r.Context().Value(gatePrincipalKey{}).(*auth.Principal)
	return p
}

// tokenGate wraps a route. Without an access token bearer it is a
// pass-through, so session behaviour is unchanged. With one, in this
// order: a route without a rule is 403 token_not_allowed (before any
// lookup); an unknown, malformed, expired or revoked token or a disabled
// owner is 401 unauthorized (one code, one body); a restricted owner gets
// its restriction; a read token on a writing route is 403 token_read_only;
// a request outside the token's workspace is 403 token_workspace; the
// per-user token budget is 429 rate_limited. Then the use is recorded
// (auth.TouchToken: last_used_at, first use audited) and the handler runs
// with the principal in its context; a refused request is never a use. It is the only caller of
// auth.AuthenticateToken (gate_static_test.go) and logs nothing.
func (s *server) tokenGate(rt route) http.HandlerFunc {
	rule := rt.token
	next := rt.handler
	return func(w http.ResponseWriter, r *http.Request) {
		raw, ok := auth.TokenFromRequest(r)
		if !ok {
			next(w, r)
			return
		}
		if rule.scope == tokNone {
			writeAuthError(w, http.StatusForbidden, "token_not_allowed", "Access tokens cannot be used on this route.")
			return
		}
		p, err := auth.AuthenticateToken(r.Context(), s.db, raw)
		if err != nil {
			writeInternal(w, r)
			return
		}
		if p == nil {
			writeAuthError(w, http.StatusUnauthorized, "unauthorized", "Sign in to continue.")
			return
		}
		if res := p.Restriction(); res != "" {
			code, msg := restrictionError(res)
			writeAuthError(w, http.StatusForbidden, code, msg)
			return
		}
		if rule.scope == tokWrite && p.TokenScope != auth.ScopeWrite {
			writeAuthError(w, http.StatusForbidden, "token_read_only", "This access token is read-only.")
			return
		}
		if p.TokenWorkspace != nil && !insideTokenWorkspace(r, rule.ws, *p.TokenWorkspace) {
			writeAuthError(w, http.StatusForbidden, "token_workspace", "This access token is limited to one workspace and this request is outside it.")
			return
		}
		if allowed, retry := s.authLimiter("pat").Allow(int64Key(p.User.ID)); !allowed {
			writeRateLimitedAs(w, retry, "access token requests")
			return
		}
		// Only a request that passed every check is a use.
		if err := auth.TouchToken(r.Context(), s.db, p); err != nil {
			writeInternal(w, r)
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), gatePrincipalKey{}, p)))
	}
}

// insideTokenWorkspace reports whether a request of a token limited to
// workspace ws stays inside it on a route of the given kind. A wsQuery
// route must carry exactly one workspace parameter that parses (as its
// handler parses it) to ws.
func insideTokenWorkspace(r *http.Request, kind tokenWS, ws int64) bool {
	switch kind {
	case wsGlobal:
		return true
	case wsQuery:
		vals := r.URL.Query()["workspace"]
		if len(vals) != 1 {
			return false
		}
		id, err := strconv.ParseInt(vals[0], 10, 64)
		return err == nil && id == ws
	}
	return false
}
