// Package api exposes the qinqin HTTP API on a stdlib ServeMux.
package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/netip"
	"sync"
	"time"

	"qinqin/internal/ai"
	"qinqin/internal/auth"
	"qinqin/internal/dict"
	"qinqin/internal/journal"
	"qinqin/internal/library/sources"
	"qinqin/internal/mail"
	"qinqin/internal/secretbox"
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

	// langMu serializes workspace creation that may register a language
	// with admin language removal.
	langMu sync.Mutex

	stageOnce  sync.Once
	stageStore *stageStore
	clock      func() time.Time                                          // nil: time.Now (tests set it)
	importDone chan string                                               // test hook: receives a stage token when its import job ends
	importPack func(context.Context, *sql.DB, dict.Pack) (string, error) // nil: packs.Import
	sweepCtx   context.Context
	sweepEvery time.Duration

	chars charactersCache // GET /api/characters payloads

	forwardedOnce sync.Once      // logs the first honoured X-Forwarded-For
	trusted       []netip.Prefix // proxies whose X-Forwarded-For is believed; nil: DefaultTrustedProxies

	authPolicy  *AuthPolicy // nil: DefaultAuthPolicy
	limits      *authLimits // sign-in throttling state, built by New
	hash        hashers     // password hashing entry points (tests swap them)
	mfa         *auth.MFA   // TOTP secrets and recovery codes (always set; no sealer = unavailable)
	sealCur     *secretbox.Sealer
	sealPrev    *secretbox.Sealer
	mailDownLog sync.Once     // logs the mail-outage sign-in refusal once per start
	mail        *mail.Service // nil: mail is not configured and cannot be
	users       *auth.Users   // admin changes of the users table (last-admin rule, deletion)

	tickets *ticketStore // single-use download tickets (personal export, admin backup)
	backups backupState  // in-flight exports, restores and server backups
}

// Option configures optional parts of the server.
type Option func(*server)

// WithAI mounts the AI service the /api/ai routes use; without it they
// report AI as disabled.
func WithAI(svc *ai.Service) Option { return func(s *server) { s.ai = svc } }

// WithSecrets hands the sealers derived from QINQIN_SECRET (and the
// previous one, for rotation) to the two-factor store. Without a current
// sealer an authenticator cannot be enrolled or verified.
func WithSecrets(current, previous *secretbox.Sealer) Option {
	return func(s *server) { s.sealCur, s.sealPrev = current, previous }
}

// WithMail mounts the mail service (SMTP settings, queue); without it every
// mail-dependent feature is hidden.
func WithMail(svc *mail.Service) Option { return func(s *server) { s.mail = svc } }

// WithOCR mounts the offline reader the transcribe route and the
// capabilities use; without it offline reading is unavailable.
func WithOCR(o journal.OCR) Option { return func(s *server) { s.ocr = o } }

// New returns the root HTTP handler with all qinqin routes mounted.
// Uploaded packs are stored under dataDir/packs/. Domain routes are
// added to the mux by later tasks, all sharing sqlDB. srcs are the
// public-domain text sources the library can search and import from.
func New(sqlDB *sql.DB, dataDir string, srcs []sources.Source, opts ...Option) http.Handler {
	return newServer(sqlDB, dataDir, srcs, opts...).handler()
}

// newServer builds the server state New and the in-package tests share.
func newServer(sqlDB *sql.DB, dataDir string, srcs []sources.Source, opts ...Option) *server {
	s := &server{db: sqlDB, dataDir: dataDir, sources: srcs, hash: defaultHashers()}
	for _, o := range opts {
		o(s)
	}
	policy := DefaultAuthPolicy()
	if s.authPolicy != nil {
		policy = *s.authPolicy
	}
	s.limits = newAuthLimits(policy)
	s.users = auth.NewUsers(sqlDB)
	s.tickets = newTicketStore()
	s.backups = newBackupState()
	s.mfa = &auth.MFA{DB: sqlDB, Current: s.sealCur, Previous: s.sealPrev}
	auth.Warm() // the first unknown-user login must cost one argon2 run, like the rest
	if s.sweepCtx != nil && s.sweepEvery > 0 {
		go s.runStageSweeper()
	}
	return s
}

// handler mounts routes() on a fresh mux. It is the only place routes are
// registered (a static test fails on any other mux registration).
func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	for _, rt := range s.routes() {
		mux.HandleFunc(rt.pattern, rt.handler)
	}
	return mux
}

// access is the route's declared policy, checked against the handler's real
// behaviour by the route walk in gate_test.go.
type access string

const (
	accPublic access = "public" // no session needed; a restricted session is treated as anonymous
	accUser   access = "user"   // requireUser: a full session
	accAdmin  access = "admin"  // requireAdmin: a full admin session
	// accAdminSignedIn is accAdmin for routes that tell an anonymous caller 401
	// (sign in) and a signed-in non-admin 403 forbidden: the AI custom endpoints.
	accAdminSignedIn access = "admin-signed-in"
	accSession       access = "session" // requirePrincipal with the restrictions listed in route.allow
)

// route is one mounted pattern, its handler and its declared policy.
type route struct {
	pattern string
	handler http.HandlerFunc
	access  access
	allow   []string // accSession: the restrictions the handler accepts
}

// routes is the whole route table.
func (s *server) routes() []route {
	return []route{
		{"GET /healthz", handleHealthz, accPublic, nil},
		{"POST /api/auth/register", s.handleRegister, accPublic, nil},
		{"POST /api/auth/login", s.handleLogin, accPublic, nil},
		{"POST /api/auth/login/mfa", s.handleLoginMFA, accPublic, nil},
		{"POST /api/auth/login/mfa/email", s.handleLoginMFAEmail, accPublic, nil},
		{"POST /api/auth/email-login/start", s.handleEmailLoginStart, accPublic, nil},
		{"POST /api/auth/email-login/verify", s.handleEmailLoginVerify, accPublic, nil},
		{"POST /api/auth/logout", s.handleLogout, accSession, []string{restrictionPasswordChange, restrictionMFAEnrollment}},
		{"POST /api/account/password", s.handleChangePassword, accSession, []string{restrictionPasswordChange}},
		{"GET /api/account/sessions", s.handleListSessions, accUser, nil},
		{"DELETE /api/account/sessions/{id}", s.handleRevokeSession, accUser, nil},
		{"POST /api/account/sessions/revoke", s.handleRevokeSessions, accUser, nil},
		{"GET /api/auth/options", s.handleAuthOptions, accPublic, nil},
		{"GET /api/admin/settings/auth", s.handleGetAuthSettings, accAdmin, nil},
		{"PATCH /api/admin/settings/auth", s.handlePatchAuthSettings, accAdmin, nil},
		{"GET /api/admin/settings/smtp", s.handleGetSMTP, accAdmin, nil},
		{"PUT /api/admin/settings/smtp", s.handlePutSMTP, accAdmin, nil},
		{"DELETE /api/admin/settings/smtp", s.handleDeleteSMTP, accAdmin, nil},
		{"POST /api/admin/settings/smtp/test", s.handleTestSMTP, accAdmin, nil},
		{"POST /api/auth/invite/check", s.handleCheckInvite, accPublic, nil},
		{"POST /api/admin/invites", s.handleCreateInvite, accAdmin, nil},
		{"GET /api/admin/invites", s.handleListInvites, accAdmin, nil},
		{"DELETE /api/admin/invites/{id}", s.handleRevokeInvite, accAdmin, nil},
		{"GET /api/admin/users", s.handleAdminListUsers, accAdmin, nil},
		{"POST /api/admin/users", s.handleAdminCreateUser, accAdmin, nil},
		{"GET /api/admin/users/{id}", s.handleAdminGetUser, accAdmin, nil},
		{"PATCH /api/admin/users/{id}", s.handleAdminPatchUser, accAdmin, nil},
		{"POST /api/admin/users/{id}/sessions/revoke", s.handleAdminRevokeSessions, accAdmin, nil},
		{"POST /api/admin/users/{id}/mfa/reset", s.handleAdminResetMFA, accAdmin, nil},
		{"POST /api/admin/users/{id}/reset-link", s.handleAdminResetLink, accAdmin, nil},
		{"DELETE /api/admin/users/{id}/reset-link", s.handleAdminRevokeResetLink, accAdmin, nil},
		{"POST /api/auth/reset/check", s.handleResetCheck, accPublic, nil},
		{"POST /api/auth/reset", s.handleReset, accPublic, nil},
		{"POST /api/auth/reset-request", s.handleResetRequest, accPublic, nil},
		{"GET /api/admin/users/{id}/deletion-preview", s.handleAdminDeletionPreview, accAdmin, nil},
		{"DELETE /api/admin/users/{id}", s.handleAdminDeleteUser, accAdmin, nil},
		{"PUT /api/account/email", s.handlePutEmail, accSession, []string{restrictionMFAEnrollment}},
		{"POST /api/account/email/verify", s.handleEmailVerify, accSession, []string{restrictionMFAEnrollment}},
		{"POST /api/account/email/resend", s.handleEmailResend, accSession, []string{restrictionMFAEnrollment}},
		{"GET /api/account/deletion-preview", s.handleAccountDeletionPreview, accUser, nil},
		{"DELETE /api/account", s.handleDeleteAccount, accUser, nil},
		{"GET /api/admin/audit", s.handleAdminAudit, accAdmin, nil},
		{"GET /api/me/time-zone", s.handleGetTimeZone, accUser, nil},
		{"PUT /api/me/time-zone", s.handlePutTimeZone, accUser, nil},
		{"POST /api/account/mfa/totp/setup", s.handleTOTPSetup, accSession, []string{restrictionMFAEnrollment}},
		{"POST /api/account/mfa/totp/confirm", s.handleTOTPConfirm, accSession, []string{restrictionMFAEnrollment}},
		{"DELETE /api/account/mfa/totp", s.handleTOTPDisable, accUser, nil},
		{"POST /api/account/mfa/recovery-codes", s.handleRecoveryCodes, accUser, nil},
		{"POST /api/account/mfa/email", s.handleMFAEmail, accSession, []string{restrictionMFAEnrollment}},
		{"POST /api/account/mfa/email/confirm", s.handleMFAEmailConfirm, accSession, []string{restrictionMFAEnrollment}},
		{"GET /api/auth/me", s.handleMe, accSession, []string{restrictionPasswordChange, restrictionMFAEnrollment}},
		// The ticket routes are unauthenticated by design: the single-use
		// ticket in the path is the credential, and anything but a live
		// ticket is a 404 (a browser navigation cannot send a bearer token).
		{"POST /api/account/export", s.handleExportStart, accUser, nil},
		{"GET /api/account/export/{ticket}", s.handleExportDownload, accPublic, nil},
		{"GET /api/entries/{id}", s.handleGetEntry, accPublic, nil},
		{"GET /api/entries/{id}/chars", s.handleCharsUnderRadical, accPublic, nil},
		{"POST /api/entries/bases", s.handleEntryBases, accUser, nil},
		{"PUT /api/entries/{id}", s.handlePutEntry, accUser, nil},
		{"POST /api/entries/{id}/sentences", s.handleAddSentence, accUser, nil},
		{"GET /api/search", s.handleSearch, accPublic, nil},
		{"GET /api/segment/at", s.handleSegmentAt, accPublic, nil},
		{"POST /api/segment", s.handleSegment, accUser, nil},
		{"GET /api/lookup", s.handleLookup, accPublic, nil},
		{"GET /api/sync/pull", s.handleSyncPull, accUser, nil},
		{"POST /api/sync/push", s.handleSyncPush, accUser, nil},
		{"POST /api/workspaces", s.handleCreateWorkspace, accUser, nil},
		{"GET /api/workspaces", s.handleListWorkspaces, accUser, nil},
		{"PUT /api/workspaces/{id}", s.handleUpdateWorkspace, accUser, nil},
		{"DELETE /api/workspaces/{id}", s.handleDeleteWorkspace, accUser, nil},
		{"GET /api/languages", s.handleListLanguages, accPublic, nil},
		{"POST /api/admin/languages", s.handleRegisterLanguage, accAdmin, nil},
		{"DELETE /api/admin/languages/{code}", s.handleDeleteLanguage, accAdmin, nil},
		{"GET /api/admin/languages/usage", s.handleLanguageUsage, accAdmin, nil},
		{"GET /api/characters", s.handleListCharacters, accPublic, nil},
		{"POST /api/events/batch", s.handleEventBatch, accUser, nil},
		{"GET /api/events", s.handleListEvents, accUser, nil},
		{"GET /api/stats/activity", s.handleActivity, accUser, nil},
		{"GET /api/dictionaries", s.handleListDictionaries, accPublic, nil},
		{"POST /api/admin/dictionaries", s.handleInstallDictionary, accAdmin, nil},
		{"DELETE /api/admin/dictionaries/{id}", s.handleUninstallDictionary, accAdmin, nil},
		{"GET /api/frequency-packs", s.handleListFrequencyPacks, accPublic, nil},
		{"GET /api/grammar", s.handleListGrammar, accPublic, nil},
		{"GET /api/grammar/{pack}/{lesson}", s.handleGrammarLesson, accPublic, nil},
		{"GET /api/audio/entries/{id}", s.handleAudioEntry, accUser, nil},
		{"POST /api/audio/resolve", s.handleAudioResolve, accUser, nil},
		{"GET /api/audio/clips/{file}", s.handleAudioClip, accUser, nil},
		{"GET /api/audio-packs", s.handleListAudioPacks, accPublic, nil},
		{"GET /api/audio-packs/{id}/credits", s.handleAudioCredits, accPublic, nil},
		{"GET /api/schemes", s.handleListSchemes, accPublic, nil},
		{"GET /api/schemes/{id}/entries", s.handleSchemeEntries, accPublic, nil},
		{"GET /api/schemes/{id}/characters", s.handleSchemeCharacters, accPublic, nil},
		{"DELETE /api/admin/schemes/{id}", s.handleUninstallScheme, accAdmin, nil},
		{"DELETE /api/admin/sentences/{pack}", s.handleUninstallSentences, accAdmin, nil},
		{"GET /api/admin/packs", s.handleListPacks, accAdmin, nil},
		{"POST /api/admin/packs", s.handleStagePack, accAdmin, nil},
		{"POST /api/admin/packs/staged/{token}", s.handleInstallStaged, accAdmin, nil},
		{"GET /api/admin/packs/staged/{token}", s.handleStagedStatus, accAdmin, nil},
		{"DELETE /api/admin/packs/staged/{token}", s.handleDiscardStaged, accAdmin, nil},
		{"DELETE /api/admin/packs/{type}/{packId}", s.handleUninstallPack, accAdmin, nil},
		{"GET /api/sentence-packs", s.handleListSentencePacks, accPublic, nil},
		{"POST /api/admin/plugins", s.handleRegisterPlugin, accAdmin, nil},
		{"GET /api/ai/status", s.handleAIStatus, accUser, nil},
		{"GET /api/ai/providers", s.handleAIProviders, accUser, nil},
		{"PUT /api/ai/keys/{provider}", s.handlePutAIKey, accUser, nil},
		{"POST /api/ai/keys/{provider}/test", s.handleTestAIKey, accUser, nil},
		{"DELETE /api/ai/keys/{provider}", s.handleDeleteAIKey, accUser, nil},
		{"PUT /api/ai/active", s.handleSetActiveAI, accUser, nil},
		{"POST /api/ai/custom-providers", s.handleCreateCustomProvider, accAdminSignedIn, nil},
		{"PATCH /api/ai/custom-providers/{id}", s.handlePatchCustomProvider, accAdminSignedIn, nil},
		{"DELETE /api/ai/custom-providers/{id}", s.handleDeleteCustomProvider, accAdminSignedIn, nil},
		{"POST /api/journal/review", s.handleJournalReview, accUser, nil},
		{"POST /api/journal/suggestions", s.handleJournalSuggestions, accUser, nil},
		{"GET /api/journal/capabilities", s.handleJournalCapabilities, accUser, nil},
		{"POST /api/journal/transcribe", s.handleJournalTranscribe, accUser, nil},
		{"POST /api/journal/photos", s.handleUploadPhoto, accUser, nil},
		{"GET /api/journal/photos/{id}", s.handleGetPhoto, accUser, nil},
		{"PUT /api/journal/photos/{id}/keepalive", s.handlePhotoKeepalive, accUser, nil},
		{"DELETE /api/journal/photos/{id}", s.handleDeletePhoto, accUser, nil},
		{"GET /api/plugins", s.handleListPlugins, accUser, nil},
		{"POST /api/library/upload", s.handleUploadBook, accUser, nil},
		{"GET /api/library/books", s.handleListBooks, accUser, nil},
		{"GET /api/library/books/{id}", s.handleGetBook, accUser, nil},
		{"GET /api/library/books/{id}/chapters/{n}", s.handleGetChapter, accUser, nil},
		{"PUT /api/library/books/{id}/position", s.handleSetBookPosition, accUser, nil},
		{"DELETE /api/library/books/{id}", s.handleDeleteBook, accUser, nil},
		{"GET /api/library/books/{id}/bookmarks", s.handleListBookmarks, accUser, nil},
		{"POST /api/library/books/{id}/bookmarks", s.handleAddBookmark, accUser, nil},
		{"PUT /api/library/books/{id}/bookmarks/{bid}", s.handleRenameBookmark, accUser, nil},
		{"DELETE /api/library/books/{id}/bookmarks/{bid}", s.handleDeleteBookmark, accUser, nil},
		{"GET /api/library/books/{id}/highlights", s.handleListHighlights, accUser, nil},
		{"POST /api/library/books/{id}/highlights", s.handleAddHighlight, accUser, nil},
		{"PUT /api/library/books/{id}/highlights/{hid}", s.handleUpdateHighlight, accUser, nil},
		{"DELETE /api/library/books/{id}/highlights/{hid}", s.handleDeleteHighlight, accUser, nil},
		{"GET /api/library/sources", s.handleListSources, accUser, nil},
		{"GET /api/library/sources/{source}/search", s.handleSearchSource, accUser, nil},
		{"GET /api/library/sources/{source}/browse", s.handleBrowseSource, accUser, nil},
		{"POST /api/library/sources/{source}/import", s.handleImportSource, accUser, nil},
		{"PUT /api/plugins/{id}/state", s.handleSetPluginState, accUser, nil},
		{"GET /api/plugins/{id}/data", s.handleListPluginData, accUser, nil},
		{"GET /api/plugins/{id}/data/{key}", s.handleGetPluginData, accUser, nil},
		{"PUT /api/plugins/{id}/data/{key}", s.handlePutPluginData, accUser, nil},
		{"DELETE /api/plugins/{id}/data/{key}", s.handleDeletePluginData, accUser, nil},
	}
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
	body, err := readBodyErr(w, r, limit)
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

// readBodyErr reads the whole request body, at most limit bytes, and
// leaves the error to the caller.
func readBodyErr(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	return io.ReadAll(http.MaxBytesReader(w, r.Body, limit))
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
