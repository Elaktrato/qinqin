package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"

	"qinqin/internal/auth"
	"qinqin/internal/model"
)

// credentials is the request body of /api/auth/register and /api/auth/login.
type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// handleRegister creates a user. On a fresh database with zero users no
// authentication is required and the new user becomes the instance admin;
// afterwards a valid admin bearer token is mandatory.
func (s *server) handleRegister(w http.ResponseWriter, r *http.Request) {
	body, ok := readBody(w, r, maxAuthBody)
	if !ok {
		return
	}
	var req credentials
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&req); err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	if req.Username == "" || req.Password == "" {
		http.Error(w, "username and password are required", http.StatusBadRequest)
		return
	}
	var count int
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	var (
		u   model.User
		err error
	)
	if count == 0 {
		// The bootstrap insert re-checks emptiness atomically; losing a
		// race to another first registration falls through to the
		// admin-required path.
		u, err = auth.CreateFirstUser(r.Context(), s.db, req.Username, req.Password)
		if errors.Is(err, auth.ErrNotFirst) {
			count = 1
		}
	}
	if count != 0 {
		if s.requireAdmin(w, r) == nil {
			return
		}
		u, err = auth.CreateUser(r.Context(), s.db, req.Username, req.Password, false)
	}
	if errors.Is(err, auth.ErrUsernameTaken) {
		http.Error(w, "username taken", http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

// handleLogin verifies credentials and returns a fresh bearer session token.
func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	body, ok := readBody(w, r, maxAuthBody)
	if !ok {
		return
	}
	var req credentials
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&req); err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	token, err := auth.Login(r.Context(), s.db, req.Username, req.Password)
	if errors.Is(err, auth.ErrBadCredentials) {
		http.Error(w, "bad credentials", http.StatusUnauthorized)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

// handleMe returns the authenticated user.
func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// requireUser resolves the user behind the request's bearer token, writing
// 401 and returning nil when the request is unauthenticated.
func (s *server) requireUser(w http.ResponseWriter, r *http.Request) *model.User {
	u, err := auth.UserFromRequest(r, s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return nil
	}
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return nil
	}
	return u
}

// requireAdmin resolves the user behind the request's bearer token, writing
// 403 and returning nil for unauthenticated and non-admin callers alike:
// either way the caller may not act as admin.
func (s *server) requireAdmin(w http.ResponseWriter, r *http.Request) *model.User {
	u, err := auth.UserFromRequest(r, s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return nil
	}
	if u == nil || !u.Admin {
		http.Error(w, "admin token required", http.StatusForbidden)
		return nil
	}
	return u
}
