// Package api exposes the qinqin HTTP API on a stdlib ServeMux.
package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
)

// server carries the shared database handle and data directory for all
// route handlers.
type server struct {
	db      *sql.DB
	dataDir string
}

// New returns the root HTTP handler with all qinqin routes mounted.
// Uploaded packs are stored under dataDir/packs/. Domain routes are
// added to the mux by later tasks, all sharing sqlDB.
func New(sqlDB *sql.DB, dataDir string) http.Handler {
	s := &server{db: sqlDB, dataDir: dataDir}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handleHealthz)
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("GET /api/auth/me", s.handleMe)
	mux.HandleFunc("GET /api/entries/{id}", s.handleGetEntry)
	mux.HandleFunc("PUT /api/entries/{id}", s.handlePutEntry)
	mux.HandleFunc("POST /api/workspaces", s.handleCreateWorkspace)
	mux.HandleFunc("GET /api/workspaces", s.handleListWorkspaces)
	mux.HandleFunc("PUT /api/workspaces/{id}", s.handleUpdateWorkspace)
	mux.HandleFunc("GET /api/dictionaries", s.handleListDictionaries)
	mux.HandleFunc("POST /api/admin/dictionaries", s.handleInstallDictionary)
	mux.HandleFunc("DELETE /api/admin/dictionaries/{id}", s.handleUninstallDictionary)
	return mux
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("ok"))
}

// writeJSON writes v as a JSON response body with the given status.
func writeJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(body)
}
