package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"

	"qinqin/internal/dict"
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
		case req.License != st.license:
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

// filesWarning is shown when the import was committed but its files
// could not be moved into place.
const filesWarning = "Installed, but the pack files could not be moved into place — see the server log"

// runStagedImport imports the staged pack under the pack mutex, moves its
// files into <data>/packs/<type>/<id>/<version>/ and records the outcome.
// Whatever happens — an error, a panic — the pack mutex is released, the
// stage directory removed, the status set and the done hook told.
func (s *server) runStagedImport(ctx context.Context, token string, userID int64) {
	var st stagedPack
	s.stages().with(token, userID, s.now(), func(p *stagedPack) { st = *p })

	var (
		summary, warning, errMsg string
		installed                *packs.Installed
	)
	func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("pack import of %s panicked: %v\n%s", st.pack.ID, r, debug.Stack())
				errMsg, installed, summary, warning = "import failed — see the server log", nil, "", ""
			}
		}()
		s.packMu.Lock()
		defer s.packMu.Unlock()
		importer := s.importPack
		if importer == nil {
			// Uploads never carry audio packs (the stage handler refuses them), so no store directory.
			importer = func(ctx context.Context, sqlDB *sql.DB, p dict.Pack) (string, error) {
				return packs.Import(ctx, sqlDB, p, packs.WithOnChange(s.packChanged))
			}
		}
		var err error
		if summary, err = importer(ctx, s.db, st.pack); err != nil {
			errMsg = packErrorText(err, st.dir, s.dataDir)
			return
		}
		// The import is committed. From here a problem is a warning, not a
		// failure: the pack is installed.
		if err := placePack(filepath.Join(s.dataDir, "packs"), st.pack.Manifest, st.root, token); err != nil {
			log.Printf("pack %s: move files into place: %v", st.pack.ID, err)
			warning = filesWarning
		}
		found, err := packs.Find(ctx, s.db, st.pack.Type, st.registryID)
		if err != nil {
			log.Printf("pack %s: read back registry row: %v", st.pack.ID, err)
			warning = filesWarning
			return
		}
		installed = &found
	}()
	os.RemoveAll(st.dir)

	s.stages().with(token, userID, s.now(), func(p *stagedPack) {
		p.expires = s.now().Add(stageTTL)
		if errMsg != "" {
			p.status, p.errMsg = stageFailed, errMsg
			return
		}
		p.status, p.summary, p.result, p.warning = stageDone, summary, installed, warning
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
		Warning string           `json:"warning,omitempty"`
	}
	found := s.stages().with(r.PathValue("token"), u.ID, s.now(), func(st *stagedPack) {
		out.Status, out.Pack, out.Summary, out.Error, out.Warning = st.status, st.result, st.summary, st.errMsg, st.warning
	})
	if !found {
		http.Error(w, "staged pack not found", http.StatusNotFound)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
