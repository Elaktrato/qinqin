package api

import (
	"net/http"
	"strconv"
	"time"

	"qinqin/internal/plugins"
	"qinqin/internal/stats"
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
	From    string       `json:"from"`
	To      string       `json:"to"`
	Sources []sourceJSON `json:"sources"`
	Cells   []stats.Cell `json:"cells"`
}

// handleActivity serves GET /api/stats/activity: the caller's activity
// by UTC day, workspace and type over from..to (UTC dates, inclusive;
// default the last 91 days) for the rules of the registered plugins.
// An optional workspace restricts the cells; unknown and foreign ones
// are 404. Every rule is listed in sources, also those without cells.
func (s *server) handleActivity(w http.ResponseWriter, r *http.Request) {
	u := s.requireUser(w, r)
	if u == nil {
		return
	}
	const dayLayout = "2006-01-02"
	q := r.URL.Query()
	to := time.Now().UTC().Truncate(24 * time.Hour)
	if raw := q.Get("to"); raw != "" {
		t, err := time.Parse(dayLayout, raw)
		if err != nil {
			http.Error(w, "to must be YYYY-MM-DD", http.StatusBadRequest)
			return
		}
		to = t
	}
	from := to.AddDate(0, 0, -90)
	if raw := q.Get("from"); raw != "" {
		t, err := time.Parse(dayLayout, raw)
		if err != nil {
			http.Error(w, "from must be YYYY-MM-DD", http.StatusBadRequest)
			return
		}
		from = t
	}
	if from.After(to) {
		http.Error(w, "from must not be after to", http.StatusBadRequest)
		return
	}
	if int(to.Sub(from).Hours()/24)+1 > maxActivitySpanDays {
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
	cells, err := stats.Activity(r.Context(), s.db, u.ID, from, to, workspace, rules)
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
		From: from.Format(dayLayout), To: to.Format(dayLayout), Sources: sources, Cells: cells,
	})
}
