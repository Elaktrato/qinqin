package api

import (
	"net/http"
	"strconv"

	"qinqin/internal/plugins"
	"qinqin/internal/stats"
	"qinqin/internal/studyday"
)

// maxActivitySpanDays bounds one request's cost: the window may cover
// at most this many days, both ends included.
const maxActivitySpanDays = 366

// sourceJSON describes one activity rule so clients can draw chips and
// words without knowing the plugins: unit is "seconds" for measure
// rules, "count" otherwise.
type sourceJSON struct {
	Type     string         `json:"type"`
	Plugin   string         `json:"plugin"`
	Label    string         `json:"label"`
	Unit     string         `json:"unit"`
	Describe plugins.Plural `json:"describe"`
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
// today and the 90 days before) for the rules of the registered plugins;
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
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	q := r.URL.Query()
	to := hist.DayOf(s.now())
	if raw := q.Get("to"); raw != "" {
		d, err := studyday.ParseDate(raw)
		if err != nil {
			http.Error(w, "to must be YYYY-MM-DD", http.StatusBadRequest)
			return
		}
		to = d
	}
	from := to.AddDays(-90)
	if raw := q.Get("from"); raw != "" {
		d, err := studyday.ParseDate(raw)
		if err != nil {
			http.Error(w, "from must be YYYY-MM-DD", http.StatusBadRequest)
			return
		}
		from = d
	}
	if to.Before(from) {
		http.Error(w, "from must not be after to", http.StatusBadRequest)
		return
	}
	if from.DaysUntil(to)+1 > maxActivitySpanDays {
		http.Error(w, "the window may cover at most 366 days", http.StatusBadRequest)
		return
	}
	var workspace *int64
	if raw := q.Get("workspace"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			http.Error(w, "workspace must be an integer", http.StatusBadRequest)
			return
		}
		ok, err := s.workspaceOwned(r.Context(), u.ID, id)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if !ok {
			http.Error(w, "workspace not found", http.StatusNotFound)
			return
		}
		workspace = &id
	}
	rules, err := plugins.ActivityRules(r.Context(), s.db)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	cells, err := stats.Activity(r.Context(), s.db, u.ID, hist.Windows(from, to), workspace, rules)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	sources := make([]sourceJSON, 0, len(rules))
	for _, rule := range rules {
		unit := "count"
		if rule.Rule.Kind() == plugins.KindMeasure {
			unit = "seconds"
		}
		sources = append(sources, sourceJSON{
			Type: rule.Type, Plugin: rule.Plugin, Label: rule.Rule.Label,
			Unit: unit, Describe: rule.Rule.Describe,
		})
	}
	writeJSON(w, http.StatusOK, activityResponse{
		From: from.String(), To: to.String(), TimeZone: hist.Zone(), Sources: sources, Cells: cells,
	})
}
