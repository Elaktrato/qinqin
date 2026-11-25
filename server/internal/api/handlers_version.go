package api

import (
	"net/http"
	"time"

	"qinqin/internal/auth"
	"qinqin/internal/update"
)

type bridgeView struct {
	Level    int      `json:"level"`
	Features []string `json:"features"`
}

// handleVersion serves GET /api/version: public, minimal; a valid full session
// also gets the commit and build date.
func (s *server) handleVersion(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{
		"app":      "qinqin",
		"version":  s.buildVersion(),
		"contract": ContractVersion,
		"bridge":   bridgeView{BridgeLevel, bridgeFeatures},
	}
	if s.optionalUser(r) != nil {
		out["commit"] = s.build.Commit
		out["buildDate"] = s.build.BuildDate
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, out)
}

func (s *server) buildVersion() string {
	if s.build.Version == "" {
		return "dev"
	}
	return s.build.Version
}

type installedView struct {
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildDate string `json:"buildDate"`
}

type updateSettingsView struct {
	Enabled     bool `json:"enabled"`
	Prereleases bool `json:"prereleases"`
}

type updateCheckView struct {
	State     string          `json:"state"`
	Error     string          `json:"error,omitempty"`
	Stale     bool            `json:"stale"`
	Latest    *update.Release `json:"latest"`
	Update    string          `json:"update"`
	CheckedAt *string         `json:"checkedAt"`
}

type updateView struct {
	Installed installedView      `json:"installed"`
	Settings  updateSettingsView `json:"settings"`
	Check     updateCheckView    `json:"check"`
}

// updateAnswer builds the admin view; ask lets it contact GitHub (force: check
// now). A disabled check never does.
func (s *server) updateAnswer(r *http.Request, ask, force bool) (updateView, bool) {
	set, err := update.LoadSettings(r.Context(), s.db)
	if err != nil {
		return updateView{}, false
	}
	v := updateView{
		Installed: installedView{s.buildVersion(), s.build.Commit, s.build.BuildDate},
		Settings:  updateSettingsView{set.Enabled, set.Prereleases},
		Check:     updateCheckView{State: update.StateDisabled, Update: update.RelUnknown},
	}
	if !set.Enabled || s.updates == nil {
		if set.Enabled {
			v.Check.State = update.StateUnchecked
		}
		return v, true
	}
	var res update.Result
	if ask {
		res = s.updates.Check(r.Context(), set.Prereleases, force)
	} else {
		res = s.updates.Last(set.Prereleases)
	}
	v.Check.State, v.Check.Error, v.Check.Stale, v.Check.Latest = res.State, res.Error, res.Stale, res.Latest
	if !res.CheckedAt.IsZero() {
		t := res.CheckedAt.UTC().Format(time.RFC3339)
		v.Check.CheckedAt = &t
	}
	if res.Latest != nil {
		v.Check.Update = update.Relation(v.Installed.Version, res.Latest.Version)
	}
	return v, true
}

// handleGetUpdate serves GET /api/admin/update: asks GitHub only when the
// cache is stale (lazy; never in the background).
func (s *server) handleGetUpdate(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	v, ok := s.updateAnswer(r, true, false)
	if !ok {
		writeInternal(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, v)
}

// handlePatchUpdateSettings serves PATCH /api/admin/update/settings.
func (s *server) handlePatchUpdateSettings(w http.ResponseWriter, r *http.Request) {
	ap := s.requireAdminPrincipal(w, r)
	if ap == nil {
		return
	}
	var req struct {
		Enabled     *bool `json:"enabled"`
		Prereleases *bool `json:"prereleases"`
	}
	if !readAccountBodyStrict(w, r, &req) {
		return
	}
	cur, err := update.LoadSettings(r.Context(), s.db)
	if err != nil {
		writeInternal(w, r)
		return
	}
	if _, err := update.SaveSettings(r.Context(), s.db, update.SettingsPatch{Enabled: req.Enabled, Prereleases: req.Prereleases}); err != nil {
		writeInternal(w, r)
		return
	}
	for _, c := range []struct {
		field    string
		from, to *bool
		old      bool
	}{{"update_check", req.Enabled, req.Enabled, cur.Enabled}, {"update_prereleases", req.Prereleases, req.Prereleases, cur.Prereleases}} {
		if c.to != nil && *c.to != c.old {
			if err := auth.Audit(r.Context(), s.db, auth.AuditEvent{Action: "settings_changed", ActorID: ap.User.ID,
				Detail: map[string]any{"field": c.field, "to": *c.to}}); err != nil {
				writeInternal(w, r)
				return
			}
		}
	}
	v, ok := s.updateAnswer(r, req.Enabled != nil || req.Prereleases != nil, false)
	if !ok {
		writeInternal(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, v)
}

// handleCheckUpdate serves POST /api/admin/update/check ("check now", at most
// once per 30 s).
func (s *server) handleCheckUpdate(w http.ResponseWriter, r *http.Request) {
	if s.requireAdmin(w, r) == nil {
		return
	}
	v, ok := s.updateAnswer(r, true, true)
	if !ok {
		writeInternal(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, v)
}
