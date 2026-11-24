package api

import (
	"net/http"
	"strconv"

	"qinqin/internal/stats"
	"qinqin/internal/studyday"
	"qinqin/internal/workspaces"
)

// maxActivitySpanDays bounds one request's cost: the window may cover
// at most this many days, both ends included.
const maxActivitySpanDays = 366

// sourceJSON describes one activity rule (stats.Rules) so clients can draw
// chips and words: feature is the core feature it belongs to, unit "seconds"
// for measure rules, "count" otherwise. Labels and wordings are client text.
type sourceJSON struct {
	Type    string `json:"type"`
	Feature string `json:"feature"`
	Unit    string `json:"unit"`
}

// activityResponse is the body of GET /api/stats/activity.
type activityResponse struct {
	From     string       `json:"from"`
	To       string       `json:"to"`
	TimeZone string       `json:"timeZone"`
	Sources  []sourceJSON `json:"sources"`
	Cells    []stats.Cell `json:"cells"`
}

// handleActivity serves GET /api/stats/activity: the caller's activity
// by learner day (the caller's time zone history, see studyday),
// workspace and type over from..to (learner dates, inclusive; default
// today and the 90 days before) for the core activity rules (stats.Rules);
// timeZone is the caller's current zone (UTC while none is set).
// An optional workspace restricts the cells; unknown and foreign ones
// are 404. Every rule is listed in sources, also those without cells.
func (s *server) handleActivity(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	hist, _, err := studyday.Load(r.Context(), s.db, u.ID)
	if err != nil {
		writeInternal(w, r)
		return
	}
	q := r.URL.Query()
	to := hist.DayOf(s.now())
	if raw := q.Get("to"); raw != "" {
		d, err := studyday.ParseDate(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "to must be YYYY-MM-DD.")
			return
		}
		to = d
	}
	from := to.AddDays(-90)
	if raw := q.Get("from"); raw != "" {
		d, err := studyday.ParseDate(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "from must be YYYY-MM-DD.")
			return
		}
		from = d
	}
	if to.Before(from) {
		writeError(w, http.StatusBadRequest, "bad_request", "from must not be after to.")
		return
	}
	if from.DaysUntil(to)+1 > maxActivitySpanDays {
		writeError(w, http.StatusBadRequest, "bad_request", "The window may cover at most 366 days.")
		return
	}
	var workspace *int64
	if raw := q.Get("workspace"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "workspace must be an integer.")
			return
		}
		ok, err := workspaces.Owned(r.Context(), s.db, u.ID, id)
		if err != nil {
			writeInternal(w, r)
			return
		}
		if !ok {
			writeError(w, http.StatusNotFound, "workspace_not_found", "No such workspace.")
			return
		}
		workspace = &id
	}
	rules := stats.Rules
	cells, err := stats.Activity(r.Context(), s.db, u.ID, hist.Windows(from, to), workspace, rules)
	if err != nil {
		writeInternal(w, r)
		return
	}
	sources := make([]sourceJSON, 0, len(rules))
	for _, rule := range rules {
		sources = append(sources, sourceJSON{Type: rule.Type, Feature: rule.Feature, Unit: rule.Unit()})
	}
	writeJSON(w, http.StatusOK, activityResponse{
		From: from.String(), To: to.String(), TimeZone: hist.Zone(), Sources: sources, Cells: cells,
	})
}
