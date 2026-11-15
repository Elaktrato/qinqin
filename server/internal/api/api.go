// Package api exposes the qinqin HTTP API on a stdlib ServeMux.
package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"qinqin/internal/ai"
	"qinqin/internal/dict"
	"qinqin/internal/journal"
	"qinqin/internal/library/sources"
)

// server carries the shared database handle and data directory for all
// route handlers.
type server struct {
	db        *sql.DB
	dataDir   string
	sources   []sources.Source
	ai        *ai.Service // nil: AI is off (status reads "no_secret")
	ocr       journal.OCR // nil: offline reading is not installed
	ocrUse    hourlyUse   // offline reads per user and hour
	uploadUse hourlyUse   // photo uploads per user and hour

	importMu  sync.Mutex
	importing map[int64]bool // users with an import in flight

	// packMu serializes pack imports and uninstalls of every type, the
	// legacy per-type routes included.
	packMu sync.Mutex

	stageOnce  sync.Once
	stageStore *stageStore
	clock      func() time.Time                                          // nil: time.Now (tests set it)
	importDone chan string                                               // test hook: receives a stage token when its import job ends
	importPack func(context.Context, *sql.DB, dict.Pack) (string, error) // nil: packs.Import
	sweepCtx   context.Context
	sweepEvery time.Duration

	chars charactersCache // GET /api/characters payloads
}

// Option configures optional parts of the server.
type Option func(*server)

// WithAI mounts the AI service the /api/ai routes use; without it they
// report AI as disabled.
func WithAI(svc *ai.Service) Option { return func(s *server) { s.ai = svc } }

// WithOCR mounts the offline reader the transcribe route and the
// capabilities use; without it offline reading is unavailable.
func WithOCR(o journal.OCR) Option { return func(s *server) { s.ocr = o } }

// New returns the root HTTP handler with all qinqin routes mounted.
// Uploaded packs are stored under dataDir/packs/. Domain routes are
// added to the mux by later tasks, all sharing sqlDB. srcs are the
// public-domain text sources the library can search and import from.
func New(sqlDB *sql.DB, dataDir string, srcs []sources.Source, opts ...Option) http.Handler {
	s := &server{db: sqlDB, dataDir: dataDir, sources: srcs}
	for _, o := range opts {
		o(s)
	}
	if s.sweepCtx != nil && s.sweepEvery > 0 {
		go s.runStageSweeper()
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handleHealthz)
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("GET /api/auth/me", s.handleMe)
	mux.HandleFunc("GET /api/entries/{id}", s.handleGetEntry)
	mux.HandleFunc("GET /api/entries/{id}/chars", s.handleCharsUnderRadical)
	mux.HandleFunc("PUT /api/entries/{id}", s.handlePutEntry)
	mux.HandleFunc("POST /api/entries/{id}/sentences", s.handleAddSentence)
	mux.HandleFunc("GET /api/search", s.handleSearch)
	mux.HandleFunc("GET /api/segment/at", s.handleSegmentAt)
	mux.HandleFunc("POST /api/segment", s.handleSegment)
	mux.HandleFunc("GET /api/lookup", s.handleLookup)
	mux.HandleFunc("GET /api/sync/pull", s.handleSyncPull)
	mux.HandleFunc("POST /api/sync/push", s.handleSyncPush)
	mux.HandleFunc("POST /api/workspaces", s.handleCreateWorkspace)
	mux.HandleFunc("GET /api/workspaces", s.handleListWorkspaces)
	mux.HandleFunc("PUT /api/workspaces/{id}", s.handleUpdateWorkspace)
	mux.HandleFunc("DELETE /api/workspaces/{id}", s.handleDeleteWorkspace)
	mux.HandleFunc("GET /api/languages", s.handleListLanguages)
	mux.HandleFunc("POST /api/admin/languages", s.handleRegisterLanguage)
	mux.HandleFunc("DELETE /api/admin/languages/{code}", s.handleDeleteLanguage)
	mux.HandleFunc("GET /api/admin/languages/usage", s.handleLanguageUsage)
	mux.HandleFunc("GET /api/characters", s.handleListCharacters)
	mux.HandleFunc("POST /api/events/batch", s.handleEventBatch)
	mux.HandleFunc("GET /api/events", s.handleListEvents)
	mux.HandleFunc("GET /api/stats/activity", s.handleActivity)
	mux.HandleFunc("GET /api/dictionaries", s.handleListDictionaries)
	mux.HandleFunc("POST /api/admin/dictionaries", s.handleInstallDictionary)
	mux.HandleFunc("DELETE /api/admin/dictionaries/{id}", s.handleUninstallDictionary)
	mux.HandleFunc("GET /api/frequency-packs", s.handleListFrequencyPacks)
	mux.HandleFunc("GET /api/grammar", s.handleListGrammar)
	mux.HandleFunc("GET /api/grammar/{pack}/{lesson}", s.handleGrammarLesson)
	mux.HandleFunc("GET /api/schemes", s.handleListSchemes)
	mux.HandleFunc("GET /api/schemes/{id}/entries", s.handleSchemeEntries)
	mux.HandleFunc("GET /api/schemes/{id}/characters", s.handleSchemeCharacters)
	mux.HandleFunc("DELETE /api/admin/schemes/{id}", s.handleUninstallScheme)
	mux.HandleFunc("DELETE /api/admin/sentences/{pack}", s.handleUninstallSentences)
	mux.HandleFunc("GET /api/admin/packs", s.handleListPacks)
	mux.HandleFunc("POST /api/admin/packs", s.handleStagePack)
	mux.HandleFunc("POST /api/admin/packs/staged/{token}", s.handleInstallStaged)
	mux.HandleFunc("GET /api/admin/packs/staged/{token}", s.handleStagedStatus)
	mux.HandleFunc("DELETE /api/admin/packs/staged/{token}", s.handleDiscardStaged)
	mux.HandleFunc("DELETE /api/admin/packs/{type}/{packId}", s.handleUninstallPack)
	mux.HandleFunc("GET /api/sentence-packs", s.handleListSentencePacks)
	mux.HandleFunc("POST /api/admin/plugins", s.handleRegisterPlugin)
	mux.HandleFunc("GET /api/ai/status", s.handleAIStatus)
	mux.HandleFunc("GET /api/ai/key", s.handleGetAIKey)
	mux.HandleFunc("PUT /api/ai/key", s.handlePutAIKey)
	mux.HandleFunc("DELETE /api/ai/key", s.handleDeleteAIKey)
	mux.HandleFunc("POST /api/journal/review", s.handleJournalReview)
	mux.HandleFunc("POST /api/journal/suggestions", s.handleJournalSuggestions)
	mux.HandleFunc("GET /api/journal/capabilities", s.handleJournalCapabilities)
	mux.HandleFunc("POST /api/journal/transcribe", s.handleJournalTranscribe)
	mux.HandleFunc("POST /api/journal/photos", s.handleUploadPhoto)
	mux.HandleFunc("GET /api/journal/photos/{id}", s.handleGetPhoto)
	mux.HandleFunc("PUT /api/journal/photos/{id}/keepalive", s.handlePhotoKeepalive)
	mux.HandleFunc("DELETE /api/journal/photos/{id}", s.handleDeletePhoto)
	mux.HandleFunc("GET /api/plugins", s.handleListPlugins)
	mux.HandleFunc("POST /api/library/upload", s.handleUploadBook)
	mux.HandleFunc("GET /api/library/books", s.handleListBooks)
	mux.HandleFunc("GET /api/library/books/{id}", s.handleGetBook)
	mux.HandleFunc("GET /api/library/books/{id}/chapters/{n}", s.handleGetChapter)
	mux.HandleFunc("PUT /api/library/books/{id}/position", s.handleSetBookPosition)
	mux.HandleFunc("DELETE /api/library/books/{id}", s.handleDeleteBook)
	mux.HandleFunc("GET /api/library/books/{id}/bookmarks", s.handleListBookmarks)
	mux.HandleFunc("POST /api/library/books/{id}/bookmarks", s.handleAddBookmark)
	mux.HandleFunc("PUT /api/library/books/{id}/bookmarks/{bid}", s.handleRenameBookmark)
	mux.HandleFunc("DELETE /api/library/books/{id}/bookmarks/{bid}", s.handleDeleteBookmark)
	mux.HandleFunc("GET /api/library/books/{id}/highlights", s.handleListHighlights)
	mux.HandleFunc("POST /api/library/books/{id}/highlights", s.handleAddHighlight)
	mux.HandleFunc("PUT /api/library/books/{id}/highlights/{hid}", s.handleUpdateHighlight)
	mux.HandleFunc("DELETE /api/library/books/{id}/highlights/{hid}", s.handleDeleteHighlight)
	mux.HandleFunc("GET /api/library/sources", s.handleListSources)
	mux.HandleFunc("GET /api/library/sources/{source}/search", s.handleSearchSource)
	mux.HandleFunc("GET /api/library/sources/{source}/browse", s.handleBrowseSource)
	mux.HandleFunc("POST /api/library/sources/{source}/import", s.handleImportSource)
	mux.HandleFunc("PUT /api/plugins/{id}/state", s.handleSetPluginState)
	mux.HandleFunc("GET /api/plugins/{id}/data", s.handleListPluginData)
	mux.HandleFunc("GET /api/plugins/{id}/data/{key}", s.handleGetPluginData)
	mux.HandleFunc("PUT /api/plugins/{id}/data/{key}", s.handlePutPluginData)
	mux.HandleFunc("DELETE /api/plugins/{id}/data/{key}", s.handleDeletePluginData)
	return mux
}

// Request size limits: body caps of the bulk write routes (the largest
// bodies the API accepts) and the code-point caps on segmented text.
const (
	maxBatchBody = 4 << 20 // POST /api/events/batch
	maxPushBody  = 8 << 20 // POST /api/sync/push

	// Small JSON bodies. Every route that reads a body caps it, so an
	// oversized request is a 413 after at most the cap is read, never a
	// 30 MB read (or a 30 MB row served back on every list and pull).
	maxAuthBody           = 4 << 10  // POST /api/auth/login and /register: a username and a password
	maxWorkspaceBody      = 16 << 10 // POST /api/workspaces and PUT /api/workspaces/{id}: a name and a settings patch
	maxWorkspaceSettings  = 64 << 10 // the merged settings object stored per workspace (the web client stores none today)
	maxPluginManifestBody = 64 << 10 // POST /api/admin/plugins: the bundled manifests are under 0.5 KiB
	maxPluginStateBody    = 64 << 10 // PUT /api/plugins/{id}/state: {"enabled","order"}, a few dozen bytes
	maxEntryBody          = 64 << 10 // PUT /api/entries/{id}: one user's patch of an entry (written, readings, glosses)
	// maxPluginDataValue caps one plugin data value, on PUT
	// /api/plugins/{id}/data/{key} and per item in a sync push. Real
	// values are far smaller: a flashcards card or deck row is under
	// 2 KiB, reader preferences a few hundred bytes; the headroom leaves
	// room for a plugin that keeps a list in one key.
	maxPluginDataValue = 256 << 10

	maxSegmentBody    = 256 << 10 // POST /api/segment body bytes
	maxSegmentRunes   = 5000      // POST /api/segment text code points
	maxSegmentAtRunes = 64        // GET /api/segment/at text code points (the client sends <= 16)
	maxLookupRunes    = 64        // GET /api/lookup text code points
)

// badBody answers a request body that failed to decode: 413 when it
// exceeded its cap, 400 when it was malformed.
func badBody(w http.ResponseWriter, err error) {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		return
	}
	http.Error(w, "malformed request body", http.StatusBadRequest)
}

// writeTooLarge answers 413 with the JSON error body of the limited
// routes.
func writeTooLarge(w http.ResponseWriter) {
	writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request body too large"})
}

// readBody reads the whole request body, at most limit bytes. Beyond
// the cap it stops reading, answers 413 itself (writeTooLarge) and
// reports false; another read failure is a 400.
func readBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, bool) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
	if err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeTooLarge(w)
		} else {
			http.Error(w, "malformed request body", http.StatusBadRequest)
		}
		return nil, false
	}
	return body, true
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
