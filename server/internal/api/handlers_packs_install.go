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
		writeError(w, http.StatusBadRequest, "bad_request", "Malformed request body.")
		return
	}
	token := r.PathValue("token")
	var refusal string // "": the import starts
	found := s.stages().with(token, u.ID, s.now(), func(st *stagedPack) {
		switch {
		case st.status == stageImporting:
			refusal = "importing"
		case st.status != stageStaged:
			refusal = "processed"
		case req.License != st.license:
			refusal = "licence"
		default:
			st.status = stageImporting
		}
	})
	switch {
	case !found:
		writeError(w, http.StatusNotFound, "not_found", "Staged pack not found.")
	case refusal == "importing":
		writeError(w, http.StatusConflict, "pack_import_running", "This pack is already being imported.")
	case refusal == "processed":
		writeError(w, http.StatusConflict, "conflict", "This staged pack was already installed or refused.")
	case refusal == "licence":
		writeError(w, http.StatusConflict, "licence_mismatch", "Confirm the pack's licence: the licence sent is not the staged pack's.")
	default:
		// The job outlives the request: a proxy timeout or a closed tab
		// must not abort or half-apply the import. The server's shutdown
		// does cancel it (#170): the import's transaction rolls back, and
		// the admin stages the pack again.
		ctx, cancel := context.WithCancel(context.WithoutCancel(r.Context()))
		stop := context.AfterFunc(s.bg, cancel)
		s.goBackground(func() {
			defer stop()
			defer cancel()
			s.runStagedImport(ctx, token, u.ID)
		})
		writeJSON(w, http.StatusAccepted, map[string]string{"status": stageImporting})
	}
}

// shutdownImportText is the failure of an import the server's shutdown
// cancelled before it committed.
const shutdownImportText = "The server shut down before the import finished; nothing was installed. Upload the pack again."

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
			// Uploads never carry audio packs (the stage handler refuses them), so no audio store;
			// font packs keep their slices under <data>/fonts.
			importer = func(ctx context.Context, sqlDB *sql.DB, p dict.Pack) (string, error) {
				return packs.Import(ctx, sqlDB, p, packs.WithFontStore(filepath.Join(s.dataDir, "fonts")), packs.WithOnChange(s.packChanged))
			}
		}
		var err error
		if ctx.Err() != nil {
			errMsg = shutdownImportText
			return
		}
		if summary, err = importer(ctx, s.db, st.pack); err != nil {
			errMsg = packErrorText(err, st.dir, s.dataDir)
			if ctx.Err() != nil {
				errMsg = shutdownImportText
			}
			return
		}
		// The import is committed. From here a problem is a warning, not a
		// failure: the pack is installed, and a shutdown no longer stops the
		// few steps left (moving its files, reading its row back).
		ctx = context.WithoutCancel(ctx)
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
		writeError(w, http.StatusNotFound, "not_found", "Staged pack not found.")
		return
	}
	writeJSON(w, http.StatusOK, out)
}
