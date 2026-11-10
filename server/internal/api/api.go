// Package api exposes the qinqin HTTP API on a stdlib ServeMux.
package api

import (
	"database/sql"
	"net/http"
)

// New returns the root HTTP handler with all qinqin routes mounted.
// Domain routes are added to the mux by later tasks, all sharing sqlDB.
func New(db *sql.DB) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handleHealthz)
	return mux
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("ok"))
}
