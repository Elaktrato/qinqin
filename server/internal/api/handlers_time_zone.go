package api

import (
	"errors"
	"net/http"
	"time"

	"qinqin/internal/studyday"
)

// maxTimeZoneBody bounds the PUT /api/me/time-zone body.
const maxTimeZoneBody = 1 << 10

type zoneChangeJSON struct {
	Zone string  `json:"zone"`
	From *string `json:"from"`
}

// timeZoneJSON is the body of both /api/me/time-zone routes: zone is the
// current zone (null while the user has none, the server then computes
// in UTC) and history lists every change in effect order.
type timeZoneJSON struct {
	Zone    *string          `json:"zone"`
	History []zoneChangeJSON `json:"history"`
}

func timeZoneBody(changes []studyday.Change) timeZoneJSON {
	out := timeZoneJSON{History: make([]zoneChangeJSON, 0, len(changes))}
	for _, c := range changes {
		j := zoneChangeJSON{Zone: c.Zone}
		if c.From != nil {
			s := c.From.UTC().Format(time.RFC3339)
			j.From = &s
		}
		out.History = append(out.History, j)
	}
	if n := len(changes); n > 0 {
		z := changes[n-1].Zone
		out.Zone = &z
	}
	return out
}

// jsonError writes the {"error","message"} body the new routes use.
func jsonError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": code, "message": message})
}

// handleGetTimeZone serves GET /api/me/time-zone: the caller's own zone
// history. Zones are never logged.
func (s *server) handleGetTimeZone(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	_, changes, err := studyday.Load(r.Context(), s.db, u.ID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, timeZoneBody(changes))
}

// handlePutTimeZone serves PUT /api/me/time-zone: records the caller's
// zone, effective from the server's now (never backdated); see
// studyday.Set for the first-zone, ifUnset and same-zone rules.
func (s *server) handlePutTimeZone(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	var req struct {
		Zone    string `json:"zone"`
		IfUnset bool   `json:"ifUnset"`
	}
	if err := decodeStrictJSON(w, r, &req, maxTimeZoneBody); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			jsonError(w, http.StatusRequestEntityTooLarge, "too_large", "request body too large")
			return
		}
		jsonError(w, http.StatusBadRequest, "bad_request", "invalid request body")
		return
	}
	changes, err := studyday.Set(r.Context(), s.db, u.ID, req.Zone, req.IfUnset, s.now())
	switch {
	case errors.Is(err, studyday.ErrUnknownZone):
		jsonError(w, http.StatusBadRequest, "unknown_time_zone", "unknown time zone")
	case errors.Is(err, studyday.ErrTooManyChanges):
		jsonError(w, http.StatusConflict, "too_many_changes", "too many time zone changes")
	case err != nil:
		http.Error(w, "internal error", http.StatusInternalServerError)
	default:
		writeJSON(w, http.StatusOK, timeZoneBody(changes))
	}
}
