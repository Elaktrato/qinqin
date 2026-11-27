// Package api exposes the qinqin HTTP API on a stdlib ServeMux.
package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/netip"
	"sync"
	"time"

	"qinqin/internal/ai"
	"qinqin/internal/auth"
	"qinqin/internal/datapkg"
	"qinqin/internal/freq"
	"qinqin/internal/journal"
	"qinqin/internal/library/sources"
	"qinqin/internal/mail"
	"qinqin/internal/pack"
	"qinqin/internal/secretbox"
	"qinqin/internal/update"
)

// server carries the shared database handle and data directory for all
// route handlers.
type server struct {
	// segmentHook runs inside POST /api/segment once its slot is taken
	// (tests); segments counts each user's segmentations in flight.
	segmentHook func()
	// aiSlotHook runs inside runAI when the user's AI slot is taken
	// ("acquired", before the provider call) and just before it is released
	// ("releasing") (tests).
	aiSlotHook func(kind, phase string)
	segments   inFlight
	// avatarHook runs in POST /api/account/avatar between the decode and
	// the store (tests).
	avatarHook func()

	db        *sql.DB
	dataDir   string
	sources   []sources.Source
	ai        *ai.Service // nil: AI is off (status reads "no_secret")
	ocr       journal.OCR // nil: offline reading is not installed
	ocrUse    hourlyUse   // offline reads per user and hour
	uploadUse hourlyUse   // photo uploads per user and hour
	avatarUse hourlyUse   // profile picture uploads per user and hour

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
	importPack func(context.Context, *sql.DB, pack.Pack) (string, error) // nil: packs.Import
	// streamEvents writes the legacy GET /api/events array; nil: events.StreamSince.
	streamEvents func(ctx context.Context, w io.Writer, db *sql.DB, user int64, since time.Time, ws *int64) error
	sweepCtx     context.Context
	sweepEvery   time.Duration

	chars charactersCache    // GET /api/characters payloads
	comps componentsPayloads // GET /api/components payloads

	freqTop       freq.TopCache // GET /api/frequency-packs/{id}/top: resolved starter decks per pack content
	freqTopBodies starterBodies // and its answers per pack, size and lexicon version

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

	restores   *restoreStore    // staged restores of personal backups
	exportCap  int64            // largest export in bytes; 0: backup.MaxUpload (tests lower it)
	restoreCap int64            // upload cap in bytes; 0: backup.MaxUpload (tests lower it)
	stageDone  chan int64       // test hook: receives a user id when a stage finishes validating or restoring
	packages   *datapkg.Builder // nil: no data packages (pack changes kick nothing)
	downloads  downloadSlots    // running package downloads per user
	bg         context.Context  // lives as long as the server; background jobs run under it
	bgGroup    *Jobs            // the background goroutines (WithBackgroundGroup); nil: not counted
	build      Build            // version, commit and date of this binary (WithBuild)
	updates    *update.Checker  // nil: no release check (WithUpdateChecker)
	push       *pushSetup       // nil: the defaults (WithPush)
	testGate   reminderTestGate // one reminder test a minute per account
}

// Jobs is the group of a server's background goroutines (the stage
// sweeper, staged pack imports, restore validations and restores), so serve
// can wait for them before it closes the database (#170). Once Wait has
// begun, no new job starts: a handler still running after a forced close
// cannot add work nobody waits for. The zero value is ready to use.
type Jobs struct {
	mu     sync.Mutex
	wg     sync.WaitGroup
	closed bool
}

// start runs fn in its own goroutine, counted, unless the group is closed.
func (j *Jobs) start(fn func()) bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.closed {
		return false
	}
	j.wg.Add(1)
	go func() {
		defer j.wg.Done()
		fn()
	}()
	return true
}

// Wait closes the group to new jobs and waits for the running ones.
func (j *Jobs) Wait() {
	j.mu.Lock()
	j.closed = true
	j.mu.Unlock()
	j.wg.Wait()
}

// WithBackgroundGroup runs every background goroutine of the server in jobs.
func WithBackgroundGroup(jobs *Jobs) Option { return func(s *server) { s.bgGroup = jobs } }

// goBackground runs fn in its own goroutine, in the background group when
// there is one; a closed group (shutdown) refuses it.
func (s *server) goBackground(fn func()) {
	if s.bgGroup == nil {
		go fn()
		return
	}
	if !s.bgGroup.start(fn) {
		log.Printf("background job refused: the server is shutting down")
	}
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

// WithPackages mounts the data package builder: pack installs and
// uninstalls kick the packages they affect, and the package routes read its
// registry.
func WithPackages(b *datapkg.Builder) Option { return func(s *server) { s.packages = b } }

// packChanged kicks the data packages of a changed pack (no-op without
// WithPackages); it is the packs.WithOnChange hook.
func (s *server) packChanged(typ, packID, language string) {
	if s.packages != nil {
		s.packages.PackChanged(typ, packID, language)
	}
}

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
	s.restores = newRestoreStore()
	s.bg = context.Background()
	if s.sweepCtx != nil {
		s.bg = s.sweepCtx
	}
	s.mfa = &auth.MFA{DB: sqlDB, Current: s.sealCur, Previous: s.sealPrev}
	auth.Warm() // the first unknown-user login must cost one argon2 run, like the rest
	if s.sweepCtx != nil && s.sweepEvery > 0 {
		s.goBackground(s.runStageSweeper)
	}
	return s
}

// handler mounts routes() on a fresh mux, each behind the access token
// gate (a pass-through for every request without an access token). It is
// the only place routes are registered (a static test fails on any other
// mux registration).
func (s *server) handler() http.Handler {
	mux := http.NewServeMux()
	for _, rt := range s.routes() {
		mux.HandleFunc(rt.pattern, s.tokenGate(rt))
	}
	return recoverPanics(codedUnmatched(mux))
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
	allow   []string  // accSession: the restrictions the handler accepts
	token   tokenRule // access tokens: noTok (the zero value) refuses them (tokengate.go)
}

// routes is the whole route table.
func (s *server) routes() []route {
	return []route{
		{"GET /healthz", handleHealthz, accPublic, nil, noTok},
		{"GET /api/version", s.handleVersion, accPublic, nil, noTok},
		{"GET /api/admin/update", s.handleGetUpdate, accAdmin, nil, noTok},
		{"PATCH /api/admin/update/settings", s.handlePatchUpdateSettings, accAdmin, nil, noTok},
		{"POST /api/admin/update/check", s.handleCheckUpdate, accAdmin, nil, noTok},
		{"POST /api/auth/register", s.handleRegister, accPublic, nil, noTok},
		{"POST /api/auth/login", s.handleLogin, accPublic, nil, noTok},
		{"POST /api/auth/login/mfa", s.handleLoginMFA, accPublic, nil, noTok},
		{"POST /api/auth/login/mfa/email", s.handleLoginMFAEmail, accPublic, nil, noTok},
		{"POST /api/auth/email-login/start", s.handleEmailLoginStart, accPublic, nil, noTok},
		{"POST /api/auth/email-login/verify", s.handleEmailLoginVerify, accPublic, nil, noTok},
		{"POST /api/auth/logout", s.handleLogout, accSession, []string{restrictionPasswordChange, restrictionMFAEnrollment}, noTok},
		{"POST /api/account/password", s.handleChangePassword, accSession, []string{restrictionPasswordChange}, noTok},
		{"GET /api/account/sessions", s.handleListSessions, accUser, nil, noTok},
		{"DELETE /api/account/sessions/{id}", s.handleRevokeSession, accUser, nil, noTok},
		{"POST /api/account/sessions/revoke", s.handleRevokeSessions, accUser, nil, noTok},
		{"GET /api/account/tokens", s.handleListTokens, accUser, nil, noTok},
		{"POST /api/account/tokens", s.handleCreateToken, accUser, nil, noTok},
		{"DELETE /api/account/tokens", s.handleRevokeAllTokens, accUser, nil, noTok},
		{"DELETE /api/account/tokens/{id}", s.handleRevokeToken, accUser, nil, noTok},
		{"GET /api/auth/options", s.handleAuthOptions, accPublic, nil, noTok},
		{"GET /api/admin/settings/auth", s.handleGetAuthSettings, accAdmin, nil, noTok},
		{"PATCH /api/admin/settings/auth", s.handlePatchAuthSettings, accAdmin, nil, noTok},
		{"GET /api/admin/settings/smtp", s.handleGetSMTP, accAdmin, nil, noTok},
		{"PUT /api/admin/settings/smtp", s.handlePutSMTP, accAdmin, nil, noTok},
		{"DELETE /api/admin/settings/smtp", s.handleDeleteSMTP, accAdmin, nil, noTok},
		{"POST /api/admin/settings/smtp/test", s.handleTestSMTP, accAdmin, nil, noTok},
		{"POST /api/auth/invite/check", s.handleCheckInvite, accPublic, nil, noTok},
		{"POST /api/admin/invites", s.handleCreateInvite, accAdmin, nil, noTok},
		{"GET /api/admin/invites", s.handleListInvites, accAdmin, nil, noTok},
		{"DELETE /api/admin/invites/{id}", s.handleRevokeInvite, accAdmin, nil, noTok},
		{"GET /api/admin/users", s.handleAdminListUsers, accAdmin, nil, noTok},
		{"POST /api/admin/users", s.handleAdminCreateUser, accAdmin, nil, noTok},
		{"GET /api/admin/users/{id}", s.handleAdminGetUser, accAdmin, nil, noTok},
		{"PATCH /api/admin/users/{id}", s.handleAdminPatchUser, accAdmin, nil, noTok},
		{"POST /api/admin/users/{id}/sessions/revoke", s.handleAdminRevokeSessions, accAdmin, nil, noTok},
		{"POST /api/admin/users/{id}/mfa/reset", s.handleAdminResetMFA, accAdmin, nil, noTok},
		{"POST /api/admin/users/{id}/reset-link", s.handleAdminResetLink, accAdmin, nil, noTok},
		{"DELETE /api/admin/users/{id}/reset-link", s.handleAdminRevokeResetLink, accAdmin, nil, noTok},
		{"POST /api/auth/reset/check", s.handleResetCheck, accPublic, nil, noTok},
		{"POST /api/auth/reset", s.handleReset, accPublic, nil, noTok},
		{"POST /api/auth/reset-request", s.handleResetRequest, accPublic, nil, noTok},
		{"GET /api/admin/users/{id}/deletion-preview", s.handleAdminDeletionPreview, accAdmin, nil, noTok},
		{"DELETE /api/admin/users/{id}", s.handleAdminDeleteUser, accAdmin, nil, noTok},
		{"PUT /api/account/email", s.handlePutEmail, accSession, []string{restrictionMFAEnrollment}, noTok},
		{"POST /api/account/email/verify", s.handleEmailVerify, accSession, []string{restrictionMFAEnrollment}, noTok},
		{"POST /api/account/email/resend", s.handleEmailResend, accSession, []string{restrictionMFAEnrollment}, noTok},
		{"GET /api/account/deletion-preview", s.handleAccountDeletionPreview, accUser, nil, noTok},
		{"DELETE /api/account", s.handleDeleteAccount, accUser, nil, noTok},
		// Profile pictures (#189): any signed-in user of the server sees a
		// picture, only its owner (or an administrator) changes it; no tokens.
		{"POST /api/account/avatar", s.handleUploadAvatar, accUser, nil, noTok},
		{"DELETE /api/account/avatar", s.handleRemoveAvatar, accUser, nil, noTok},
		{"GET /api/avatars/{user}/{hash}", s.handleGetAvatar, accUser, nil, noTok},
		{"DELETE /api/admin/users/{id}/avatar", s.handleAdminRemoveAvatar, accAdmin, nil, noTok},
		{"GET /api/admin/audit", s.handleAdminAudit, accAdmin, nil, noTok},
		{"POST /api/admin/backup", s.handleAdminBackupStart, accAdmin, nil, noTok},
		{"GET /api/admin/backup/{ticket}", s.handleAdminBackupDownload, accPublic, nil, noTok},
		{"PUT /api/reminders/facts", s.handlePutFacts, accUser, nil, noTok},
		{"GET /api/reminders/plan", s.handleGetPlan, accUser, nil, noTok},
		{"POST /api/reminders/test", s.handleReminderTest, accUser, nil, noTok},
		{"GET /api/reminders/unsubscribe", s.handleUnsubscribe, accPublic, nil, noTok},
		{"POST /api/reminders/unsubscribe", s.handleUnsubscribe, accPublic, nil, noTok},
		{"GET /api/push/vapid-key", s.handleGetVAPIDKey, accUser, nil, noTok},
		{"GET /api/push/subscriptions", s.handleListSubscriptions, accUser, nil, noTok},
		{"POST /api/push/subscriptions", s.handleAddSubscription, accUser, nil, noTok},
		{"DELETE /api/push/subscriptions/{id}", s.handleDeleteSubscription, accUser, nil, noTok},
		{"GET /api/me/time-zone", s.handleGetTimeZone, accUser, nil, tokReadAny},
		{"PUT /api/me/time-zone", s.handlePutTimeZone, accUser, nil, noTok},
		{"PUT /api/me/interface-language", s.handlePutInterfaceLanguage, accUser, nil, noTok},
		{"POST /api/account/mfa/totp/setup", s.handleTOTPSetup, accSession, []string{restrictionMFAEnrollment}, noTok},
		{"POST /api/account/mfa/totp/confirm", s.handleTOTPConfirm, accSession, []string{restrictionMFAEnrollment}, noTok},
		{"DELETE /api/account/mfa/totp", s.handleTOTPDisable, accUser, nil, noTok},
		{"POST /api/account/mfa/recovery-codes", s.handleRecoveryCodes, accUser, nil, noTok},
		{"POST /api/account/mfa/email", s.handleMFAEmail, accSession, []string{restrictionMFAEnrollment}, noTok},
		{"POST /api/account/mfa/email/confirm", s.handleMFAEmailConfirm, accSession, []string{restrictionMFAEnrollment}, noTok},
		{"GET /api/auth/me", s.handleMe, accSession, []string{restrictionPasswordChange, restrictionMFAEnrollment}, noTok},
		// The ticket routes are unauthenticated by design: the single-use
		// ticket in the path is the credential, and anything but a live
		// ticket is a 404 (a browser navigation cannot send a bearer token).
		{"POST /api/account/export", s.handleExportStart, accUser, nil, noTok},
		{"GET /api/account/export/{ticket}", s.handleExportDownload, accPublic, nil, noTok},
		{"POST /api/account/restore", s.handleRestoreUpload, accUser, nil, noTok},
		{"POST /api/account/restore/safety-export", s.handleSafetyExportTicket, accUser, nil, noTok},
		{"GET /api/account/restore/safety-export/{ticket}", s.handleSafetyExportDownload, accPublic, nil, noTok},
		{"GET /api/account/restore/{token}", s.handleRestoreStatus, accUser, nil, noTok},
		{"DELETE /api/account/restore/{token}", s.handleRestoreDiscard, accUser, nil, noTok},
		{"POST /api/account/restore/{token}", s.handleRestoreApply, accUser, nil, noTok},
		{"GET /api/entries/{id}", s.handleGetEntry, accPublic, nil, tokReadGlobal},
		{"GET /api/entries/{id}/chars", s.handleCharsUnderRadical, accPublic, nil, tokReadGlobal},
		{"POST /api/entries/bases", s.handleEntryBases, accUser, nil, tokReadGlobal},
		{"POST /api/entries/frequency-ranks", s.handleFrequencyRanks, accUser, nil, noTok},
		// The companion kinds an entry can make, decided before a session is planned (#288).
		{"POST /api/study/eligibility", s.handleStudyEligibility, accUser, nil, noTok},
		{"PUT /api/entries/{id}", s.handlePutEntry, accUser, nil, tokWriteAny},
		{"POST /api/entries/{id}/sentences", s.handleAddSentence, accUser, nil, tokWriteAny},
		// AI example sentences (#186): the caller's own AI key; no access tokens.
		{"GET /api/entries/{id}/examples", s.handleGetExamples, accUser, nil, noTok},
		{"POST /api/entries/{id}/examples", s.handleGenerateExamples, accUser, nil, noTok},
		{"POST /api/entries/{id}/examples/{draftId}/keep", s.handleKeepExample, accUser, nil, noTok},
		{"DELETE /api/entries/{id}/examples/{draftId}", s.handleDiscardExample, accUser, nil, noTok},
		{"DELETE /api/entries/{id}/sentences/{sentenceId}", s.handleDeleteAIExample, accUser, nil, noTok},
		{"GET /api/search", s.handleSearch, accPublic, nil, tokReadGlobal},
		{"GET /api/segment/at", s.handleSegmentAt, accPublic, nil, tokReadGlobal},
		{"POST /api/segment", s.handleSegment, accUser, nil, tokReadGlobal},
		{"GET /api/lookup", s.handleLookup, accPublic, nil, tokReadGlobal},
		{"GET /api/sync/pull", s.handleSyncPull, accUser, nil, tokReadAny},
		{"POST /api/sync/push", s.handleSyncPush, accUser, nil, tokWriteAny},
		{"POST /api/workspaces", s.handleCreateWorkspace, accUser, nil, noTok},
		{"GET /api/workspaces", s.handleListWorkspaces, accUser, nil, tokReadAny},
		{"PUT /api/workspaces/{id}", s.handleUpdateWorkspace, accUser, nil, noTok},
		{"DELETE /api/workspaces/{id}", s.handleDeleteWorkspace, accUser, nil, noTok},
		{"GET /api/languages", s.handleListLanguages, accPublic, nil, tokReadGlobal},
		{"POST /api/admin/languages", s.handleRegisterLanguage, accAdmin, nil, noTok},
		{"DELETE /api/admin/languages/{code}", s.handleDeleteLanguage, accAdmin, nil, noTok},
		{"GET /api/admin/languages/usage", s.handleLanguageUsage, accAdmin, nil, noTok},
		{"GET /api/characters", s.handleListCharacters, accPublic, nil, tokReadGlobal},
		{"GET /api/components", s.handleListComponents, accPublic, nil, tokReadGlobal},
		{"POST /api/events/batch", s.handleEventBatch, accUser, nil, tokWriteAny},
		{"GET /api/events", s.handleListEvents, accUser, nil, tokReadWS},
		{"DELETE /api/events/lookups", s.handleDeleteLookupEvents, accUser, nil, noTok},
		{"GET /api/stats/activity", s.handleActivity, accUser, nil, tokReadWS},
		{"GET /api/dictionaries", s.handleListDictionaries, accPublic, nil, tokReadGlobal},
		{"POST /api/admin/dictionaries", s.handleInstallDictionary, accAdmin, nil, noTok},
		{"DELETE /api/admin/dictionaries/{id}", s.handleUninstallDictionary, accAdmin, nil, noTok},
		{"GET /api/frequency-packs", s.handleListFrequencyPacks, accPublic, nil, tokReadGlobal},
		{"GET /api/component-packs", s.handleListComponentPacks, accPublic, nil, tokReadGlobal},
		{"GET /api/lemma-packs", s.handleListLemmaPacks, accPublic, nil, tokReadGlobal},
		{"GET /api/frequency-packs/{id}/top", s.handleFrequencyTop, accUser, nil, noTok},
		{"GET /api/grammar", s.handleListGrammar, accPublic, nil, tokReadGlobal},
		{"GET /api/grammar/{pack}/{lesson}", s.handleGrammarLesson, accPublic, nil, tokReadGlobal},
		{"GET /api/grammar/progress", s.handleListGrammarProgress, accUser, nil, noTok},
		{"POST /api/grammar/progress", s.handleRecordGrammarRun, accUser, nil, noTok},
		{"GET /api/audio/entries/{id}", s.handleAudioEntry, accUser, nil, tokReadAny},
		{"POST /api/audio/resolve", s.handleAudioResolve, accUser, nil, noTok},
		{"GET /api/audio/clips/{file}", s.handleAudioClip, accUser, nil, tokReadAny},
		{"GET /api/audio-packs", s.handleListAudioPacks, accPublic, nil, tokReadGlobal},
		{"GET /api/audio-packs/{id}/credits", s.handleAudioCredits, accPublic, nil, tokReadGlobal},
		{"GET /api/images/entries/{id}", s.handleEntryPicture, accUser, nil, noTok},
		{"GET /api/image-packs", s.handleListImagePacks, accPublic, nil, noTok},
		{"GET /api/starter-sets", s.handleListStarterSets, accPublic, nil, noTok},
		{"GET /api/starter-sets/{id}", s.handleStarterSet, accUser, nil, noTok},
		{"GET /api/schemes", s.handleListSchemes, accPublic, nil, tokReadGlobal},
		{"GET /api/schemes/{id}/entries", s.handleSchemeEntries, accPublic, nil, tokReadGlobal},
		{"GET /api/schemes/{id}/characters", s.handleSchemeCharacters, accPublic, nil, tokReadGlobal},
		{"DELETE /api/admin/schemes/{id}", s.handleUninstallScheme, accAdmin, nil, noTok},
		{"DELETE /api/admin/sentences/{pack}", s.handleUninstallSentences, accAdmin, nil, noTok},
		{"GET /api/admin/packs", s.handleListPacks, accAdmin, nil, noTok},
		{"POST /api/admin/packs", s.handleStagePack, accAdmin, nil, noTok},
		{"POST /api/admin/packs/staged/{token}", s.handleInstallStaged, accAdmin, nil, noTok},
		{"GET /api/admin/packs/staged/{token}", s.handleStagedStatus, accAdmin, nil, noTok},
		{"DELETE /api/admin/packs/staged/{token}", s.handleDiscardStaged, accAdmin, nil, noTok},
		{"DELETE /api/admin/packs/{type}/{packId}", s.handleUninstallPack, accAdmin, nil, noTok},
		{"GET /api/sentence-packs", s.handleListSentencePacks, accPublic, nil, tokReadGlobal},
		{"GET /api/stroke-packs", s.handleListStrokePacks, accPublic, nil, tokReadGlobal},
		{"GET /api/themes", s.handleListThemes, accPublic, nil, tokReadGlobal},
		// Stroke files keep the URL of v0.3's static files (rootHandler
		// forwards /hanzi/ here): public, and fetched without credentials by
		// the service worker, so no token either.
		{"GET /hanzi/{file}", s.handleStrokeFile, accPublic, nil, noTok},
		// Font packs (#97, docs/contracts/fonts/README.md): the faces list
		// needs a session but reads no per-workspace data; the slices are
		// public and token-free like the stroke files (rootHandler forwards
		// /fonts/ here): browsers fetch @font-face URLs without credentials.
		{"GET /api/fonts", s.handleListFonts, accUser, nil, tokReadGlobal},
		{"GET /fonts/{file}", s.handleFontFile, accPublic, nil, noTok},
		{"GET /api/packages", s.handlePackageCatalogue, accUser, nil, tokReadGlobal},
		{"GET /api/packages/{id}/{revision}", s.handlePackageDownload, accUser, nil, tokReadGlobal},
		{"GET /api/ai/status", s.handleAIStatus, accUser, nil, noTok},
		{"GET /api/ai/providers", s.handleAIProviders, accUser, nil, noTok},
		{"PUT /api/ai/keys/{provider}", s.handlePutAIKey, accUser, nil, noTok},
		{"POST /api/ai/keys/{provider}/test", s.handleTestAIKey, accUser, nil, noTok},
		{"DELETE /api/ai/keys/{provider}", s.handleDeleteAIKey, accUser, nil, noTok},
		{"PUT /api/ai/active", s.handleSetActiveAI, accUser, nil, noTok},
		{"POST /api/ai/custom-providers", s.handleCreateCustomProvider, accAdminSignedIn, nil, noTok},
		{"PATCH /api/ai/custom-providers/{id}", s.handlePatchCustomProvider, accAdminSignedIn, nil, noTok},
		{"DELETE /api/ai/custom-providers/{id}", s.handleDeleteCustomProvider, accAdminSignedIn, nil, noTok},
		{"GET /api/journal/entries", s.handleListJournalEntries, accUser, nil, noTok},
		{"GET /api/journal/entries/{id}", s.handleGetJournalEntry, accUser, nil, noTok},
		{"PUT /api/journal/entries/{id}", s.handlePutJournalEntry, accUser, nil, noTok},
		{"DELETE /api/journal/entries/{id}", s.handleDeleteJournalEntry, accUser, nil, noTok},
		{"GET /api/journal/entries/{id}/review", s.handleGetJournalReview, accUser, nil, noTok},
		{"GET /api/journal/suggestions", s.handleGetJournalSuggestions, accUser, nil, noTok},
		{"GET /api/journal/settings", s.handleGetJournalSettings, accUser, nil, noTok},
		{"PUT /api/journal/settings", s.handlePutJournalSettings, accUser, nil, noTok},
		{"POST /api/journal/review", s.handleJournalReview, accUser, nil, noTok},
		{"POST /api/journal/suggestions", s.handleJournalSuggestions, accUser, nil, noTok},
		{"GET /api/journal/capabilities", s.handleJournalCapabilities, accUser, nil, noTok},
		{"POST /api/journal/transcribe", s.handleJournalTranscribe, accUser, nil, noTok},
		{"POST /api/journal/photos", s.handleUploadPhoto, accUser, nil, noTok},
		{"GET /api/journal/photos/{id}", s.handleGetPhoto, accUser, nil, noTok},
		{"PUT /api/journal/photos/{id}/keepalive", s.handlePhotoKeepalive, accUser, nil, noTok},
		{"DELETE /api/journal/photos/{id}", s.handleDeletePhoto, accUser, nil, noTok},
		{"GET /api/journal/conversations", s.handleListConversations, accUser, nil, noTok},
		{"POST /api/journal/conversations", s.handleStartConversation, accUser, nil, noTok},
		{"GET /api/journal/conversations/{id}", s.handleGetConversation, accUser, nil, noTok},
		{"DELETE /api/journal/conversations/{id}", s.handleDeleteConversation, accUser, nil, noTok},
		{"POST /api/journal/conversations/{id}/turn", s.handleConversationTurn, accUser, nil, noTok},
		{"POST /api/journal/conversations/{id}/save", s.handleSaveConversation, accUser, nil, noTok},
		{"GET /api/features", s.handleListFeatures, accUser, nil, tokReadAny},
		{"POST /api/library/upload", s.handleUploadBook, accUser, nil, tokWriteAny},
		{"GET /api/library/books", s.handleListBooks, accUser, nil, tokReadWS},
		{"GET /api/library/books/{id}", s.handleGetBook, accUser, nil, tokReadAny},
		{"GET /api/library/books/{id}/chapters/{n}", s.handleGetChapter, accUser, nil, tokReadAny},
		{"PUT /api/library/books/{id}/position", s.handleSetBookPosition, accUser, nil, tokWriteAny},
		{"DELETE /api/library/books/{id}", s.handleDeleteBook, accUser, nil, tokWriteAny},
		{"GET /api/library/books/{id}/bookmarks", s.handleListBookmarks, accUser, nil, tokReadAny},
		{"POST /api/library/books/{id}/bookmarks", s.handleAddBookmark, accUser, nil, tokWriteAny},
		{"PUT /api/library/books/{id}/bookmarks/{bid}", s.handleRenameBookmark, accUser, nil, tokWriteAny},
		{"DELETE /api/library/books/{id}/bookmarks/{bid}", s.handleDeleteBookmark, accUser, nil, tokWriteAny},
		{"GET /api/library/books/{id}/highlights", s.handleListHighlights, accUser, nil, tokReadAny},
		{"POST /api/library/books/{id}/highlights", s.handleAddHighlight, accUser, nil, tokWriteAny},
		{"PUT /api/library/books/{id}/highlights/{hid}", s.handleUpdateHighlight, accUser, nil, tokWriteAny},
		{"DELETE /api/library/books/{id}/highlights/{hid}", s.handleDeleteHighlight, accUser, nil, tokWriteAny},
		{"GET /api/library/sources", s.handleListSources, accUser, nil, noTok},
		{"GET /api/library/sources/{source}/search", s.handleSearchSource, accUser, nil, noTok},
		{"GET /api/library/sources/{source}/browse", s.handleBrowseSource, accUser, nil, noTok},
		{"POST /api/library/sources/{source}/import", s.handleImportSource, accUser, nil, noTok},
		{"PUT /api/features/{id}", s.handleSetFeature, accUser, nil, tokWriteAny},
		{"GET /api/rows", s.handleListRows, accUser, nil, tokReadWS},
		{"GET /api/rows/{key}", s.handleGetRow, accUser, nil, tokReadWS},
		{"PUT /api/rows/{key}", s.handlePutRow, accUser, nil, tokWriteWS},
		{"DELETE /api/rows/{key}", s.handleDeleteRow, accUser, nil, tokWriteWS},
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
	maxAuthBody      = 4 << 10  // POST /api/auth/login and /register: a username and a password
	maxWorkspaceBody = 16 << 10 // POST /api/workspaces and PUT /api/workspaces/{id}: a name and a settings patch
	maxEntryBody     = 64 << 10 // PUT /api/entries/{id}: one user's patch of an entry (written, readings, glosses)
	// maxRowValue caps one keyed row value, on PUT /api/rows/{key}, and
	// per item (keyed or typed) in a sync push. Real values are far
	// smaller: a card or deck row is under 2 KiB, a layout a few hundred
	// bytes; the lookup history (500 items) is the largest.
	maxRowValue = 256 << 10

	maxSegmentBody    = 256 << 10 // POST /api/segment body bytes
	maxSegmentRunes   = 5000      // POST /api/segment text code points
	maxSegmentAtRunes = 64        // GET /api/segment/at text code points (the client sends <= 16)
	maxLookupRunes    = 64        // GET /api/lookup text code points
)

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
		// The error body is a constant: writeError itself goes through here.
		status, body = http.StatusInternalServerError, []byte(`{"error":"internal","message":"Internal server error."}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(body)
}
