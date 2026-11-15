package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"qinqin/internal/packs"
)

const maxInstallBody = 4 << 10 // {"license": "..."}

// handleInstallStaged serves POST /api/admin/packs/staged/{token}: the
// body must echo the staged manifest's licence string exactly, which
// proves the admin was shown the licence the server parsed. The import
// then runs in the background and the route answers 202.
func (s *server) handleInstallStaged(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	body, ok := readBody(w, r, maxInstallBody)
	if !ok {
		return
	}
	var req struct {
		License string `json:"license"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}
	token := r.PathValue("token")
	var code int
	var msg string
	found := s.stages().with(token, u.ID, s.now(), func(st *stagedPack) {
		switch {
		case st.status != stageStaged:
			code, msg = http.StatusConflict, "already importing"
			if st.status != stageImporting {
				msg = "already processed"
			}
		case req.License != st.pack.License:
			code, msg = http.StatusConflict, "confirm the pack's licence"
		default:
			st.status = stageImporting
			code = http.StatusAccepted
		}
	})
	switch {
	case !found:
		http.Error(w, "staged pack not found", http.StatusNotFound)
	case code != http.StatusAccepted:
		http.Error(w, msg, code)
	default:
		// The job outlives the request: a proxy timeout or a closed tab
		// must not abort or half-apply the import.
		go s.runStagedImport(context.WithoutCancel(r.Context()), token, u.ID)
		writeJSON(w, http.StatusAccepted, map[string]string{"status": stageImporting})
	}
}

// runStagedImport imports the staged pack under the pack mutex, moves its
// files into <data>/packs/<id>-<version>/ and records the outcome.
func (s *server) runStagedImport(ctx context.Context, token string, userID int64) {
	var st stagedPack
	s.stages().with(token, userID, s.now(), func(p *stagedPack) { st = *p })

	s.packMu.Lock()
	summary, err := packs.Import(ctx, s.db, st.pack)
	var installed packs.Installed
	if err == nil {
		packsDir := filepath.Join(s.dataDir, "packs")
		var dest string
		if dest, err = packDir(packsDir, st.pack.Manifest); err == nil {
			if err = os.RemoveAll(dest); err == nil {
				err = os.Rename(st.root, dest)
			}
		}
		if err == nil {
			installed, err = packs.Find(ctx, s.db, st.pack.Type, st.pack.ID)
		}
	}
	s.packMu.Unlock()
	os.RemoveAll(st.dir)

	s.stages().with(token, userID, s.now(), func(p *stagedPack) {
		p.expires = s.now().Add(stageTTL)
		if err != nil {
			p.status, p.errMsg = stageFailed, packErrorText(err, st.dir, s.dataDir)
			return
		}
		p.status, p.summary, p.result = stageDone, summary, &installed
	})
	if s.importDone != nil {
		s.importDone <- token
	}
}

// handleStagedStatus serves GET /api/admin/packs/staged/{token}.
func (s *server) handleStagedStatus(w http.ResponseWriter, r *http.Request) {
	u := s.requireAdmin(w, r)
	if u == nil {
		return
	}
	var out struct {
		Status  string           `json:"status"`
		Pack    *packs.Installed `json:"pack,omitempty"`
		Summary string           `json:"summary,omitempty"`
		Error   string           `json:"error,omitempty"`
	}
	found := s.stages().with(r.PathValue("token"), u.ID, s.now(), func(st *stagedPack) {
		out.Status, out.Pack, out.Summary, out.Error = st.status, st.result, st.summary, st.errMsg
	})
	if !found {
		http.Error(w, "staged pack not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
