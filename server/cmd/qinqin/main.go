// Command qinqin serves the qinqin Chinese learning platform backend
// and administers its data.
//
//	qinqin [serve] [--addr :8080] [--data ./data]
//	qinqin seed    --data <dir> --packs <dir>
//	qinqin adduser --data <dir> --username <name> [--admin]
//	qinqin recover --data <dir> --username <name> [--enable] [--admin] [--reset-mfa]
//	qinqin backup  --out <file|-> [--data <dir>] [--only db,books,packs,audio]
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"qinqin/internal/ai"
	"qinqin/internal/api"
	"qinqin/internal/auth"
	"qinqin/internal/db"
	"qinqin/internal/journal"
	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/library/sources"
	"qinqin/internal/library/sources/aozora"
	"qinqin/internal/library/sources/gutenberg"
	"qinqin/internal/plugins"
	"qinqin/internal/study"
	"qinqin/internal/webdist"
)

// errUsage marks a command invoked with missing or invalid arguments.
var errUsage = errors.New("usage error")

func main() {
	args := os.Args[1:]
	cmd := "serve"
	if len(args) > 0 && len(args[0]) > 0 && args[0][0] != '-' {
		cmd, args = args[0], args[1:]
	}
	var err error
	switch cmd {
	case "serve":
		err = serveCmd(args)
	case "seed":
		err = seedCmd(args, os.Stdout)
	case "adduser":
		err = adduserCmd(args, os.Stdin, os.Stderr)
	case "recover":
		err = recoverCmd(args, os.Stdin, os.Stderr)
	case "backup":
		err = backupCmd(args, os.Stdout, os.Stderr)
	default:
		err = fmt.Errorf("%w: unknown command %q (want serve, seed, adduser, recover or backup)", errUsage, cmd)
	}
	if errors.Is(err, flag.ErrHelp) {
		return
	}
	if err != nil {
		log.Fatal(err)
	}
}

// registerLanguages registers the compile-time language packs: the zh
// pack normalizes pinyin readings and derives their bopomofo forms, the
// ja pack folds kana readings and derives their romaji. Every command
// that writes or searches entries needs them registered first.
func registerLanguages() {
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})
}

// defaultData is the --data default of every command: $QINQIN_DATA
// (set by the compose stack) or ./data.
func defaultData() string {
	if d := os.Getenv("QINQIN_DATA"); d != "" {
		return d
	}
	return "./data"
}

// retiredHeatmapPlugin is the plugin id earlier builds registered for
// the generic home heatmap. The flashcards widget replaced it; an
// upgraded database still carries the old registry row, so startup
// unregisters it to keep Settings free of a dead plugin.
const retiredHeatmapPlugin = "qinqin-heatmap"

// registerBuiltinPlugins puts the feature plugins this build ships (the
// embedded manifests of internal/plugins/builtin, the same files the web
// build imports) into the server registry and retires the ones it no
// longer ships. It runs at serve startup, after migrations and before
// the HTTP server accepts requests; both steps are idempotent. A built-in
// wins an event-type conflict with an admin-registered plugin; the
// conflict is logged, never fatal.
func registerBuiltinPlugins(ctx context.Context, sqlDB *sql.DB) error {
	for _, raw := range plugins.Builtin() {
		m, err := plugins.ParseManifest(raw)
		if err != nil {
			return fmt.Errorf("built-in plugin manifest: %w", err)
		}
		conflicts, err := plugins.RegisterBuiltin(ctx, sqlDB, raw)
		if err != nil {
			return fmt.Errorf("register built-in plugin %s: %w", m.ID, err)
		}
		for _, other := range conflicts {
			log.Printf("plugin %s also claims event types of %s; the built-in wins", other, m.ID)
		}
	}
	if err := plugins.Unregister(ctx, sqlDB, retiredHeatmapPlugin); err != nil {
		return fmt.Errorf("unregister retired plugin %s: %w", retiredHeatmapPlugin, err)
	}
	// Rows that fail the manifest contract stay writable but count for
	// neither event ownership nor activity rules: say so once.
	bad, err := plugins.UnparsableRows(ctx, sqlDB)
	if err != nil {
		return fmt.Errorf("check plugin registry: %w", err)
	}
	if len(bad) > 0 {
		log.Printf("plugin registry rows that do not parse as manifests (re-register or remove them): %s", strings.Join(bad, ", "))
	}
	return nil
}

// openData creates the data directory if needed and opens (migrating)
// the SQLite database inside it, with the durable serving settings.
func openData(dataDir string) (*sql.DB, error) {
	return openDataWith(dataDir, db.Open)
}

// openDataForSeed is openData for bulk seeding: same directory handling,
// but synchronous=NORMAL (see db.OpenForSeed).
func openDataForSeed(dataDir string) (*sql.DB, error) {
	return openDataWith(dataDir, db.OpenForSeed)
}

func openDataWith(dataDir string, open func(string) (*sql.DB, error)) (*sql.DB, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data directory %s: %w", dataDir, err)
	}
	return open(filepath.Join(dataDir, "qinqin.db"))
}

func serveCmd(args []string) error {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	addr := fs.String("addr", ":8080", "listen address for the HTTP server")
	data := fs.String("data", defaultData(), "data directory holding the SQLite database and packs (default $QINQIN_DATA or ./data)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	// SIGINT or SIGTERM (docker stop) starts the graceful shutdown; once it
	// has started, a second signal kills the process at once.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		stop()
	}()
	return serve(ctx, *data, func() (net.Listener, error) { return net.Listen("tcp", *addr) })
}

// The shutdown budget (#170): requests in flight get httpGrace to finish,
// then the background workers share backgroundGrace to stop. docker-compose.yml
// gives the container 30 s (stop_grace_period) for both.
const (
	httpGrace       = 10 * time.Second
	backgroundGrace = 10 * time.Second
)

// serve runs the server on the data directory until ctx ends, then shuts
// down in order: the HTTP server (requests in flight get httpGrace), the mail
// queue, the package builder, the API's background jobs (stage sweeper,
// staged pack imports, restores), the janitors, and last the database. Startup steps run
// under ctx, so a signal during the first-start auto-seed aborts it and serve
// returns without listening. The background workers run under their own
// context, cancelled only once the HTTP server has stopped, so requests that
// finish during the grace period can still queue mail and kick builds.
// listen is called once startup is done. A shutdown, however it went, returns
// nil; errors are startup failures and a failed listener.
func serve(ctx context.Context, data string, listen func() (net.Listener, error)) error {
	trusted, err := api.ParseTrustedProxies(os.Getenv("QINQIN_TRUSTED_PROXIES"))
	if err != nil {
		return fmt.Errorf("QINQIN_TRUSTED_PROXIES: %w", err)
	}
	registerLanguages()
	sqlDB, err := openData(data)
	if err != nil {
		return err
	}
	closeDB := sync.OnceValue(sqlDB.Close)
	defer closeDB()
	// A startup step that failed because a signal ended ctx is a stop, not
	// a startup failure.
	stopped := func(err error) error {
		if ctx.Err() != nil {
			log.Printf("shutting down: stopped during startup (%v)", err)
			return nil
		}
		return err
	}

	// A fresh instance gets its admin here (when configured), before the
	// port opens, so first registration never decides who is admin.
	if err := bootstrapAdminFromEnv(ctx, sqlDB, os.Getenv, log.Printf); err != nil {
		return stopped(err)
	}
	if err := registerBuiltinPlugins(ctx, sqlDB); err != nil {
		return stopped(err)
	}
	// Study rows an older (downgraded) binary wrote as plugin data after
	// migration 038 move into the typed tables; idempotent and per row.
	// A failure is logged, never fatal: the rows stay where the legacy view
	// serves them, and the next start tries again (also after a signal).
	if _, err := study.AdoptLeftovers(ctx, sqlDB); err != nil {
		log.Printf("study: adopting study rows left in plugin_data: %v", err)
	}
	// The Sources page shows the stored terms; say when seed is due.
	warnStalePackTerms(ctx, sqlDB, defaultPacks(), log.Printf)
	// Data packages carry each pack's licence files; say which packs lack them.
	warnMissingPackTexts(ctx, sqlDB, log.Printf)

	// Background workers live until the HTTP server has stopped.
	bg, cancelBg := context.WithCancel(context.WithoutCancel(ctx))
	defer cancelBg()

	aiSvc := aiFromEnv(sqlDB, os.Getenv, log.Printf)
	sec := secretsFromEnv(os.Getenv)
	mailSvc := mailFromEnv(sqlDB, sec, os.Getenv, log.Printf)
	// The janitors (AI call records, sessions, journal photos) stop with bg;
	// serve waits for them before it closes the database.
	var janitors sync.WaitGroup
	runJanitor := func(fn func()) {
		janitors.Add(1)
		go func() {
			defer janitors.Done()
			fn()
		}()
	}
	runJanitor(func() { aiJanitor(bg, aiSvc, 15*time.Minute, log.Printf) })
	rotateSecrets(ctx, sqlDB, sec, mailSvc, log.Printf)
	mailDone := make(chan struct{})
	go func() {
		mailSvc.Run(bg)
		close(mailDone)
	}()
	runJanitor(func() { auth.RunJanitor(bg, sqlDB, time.Hour, log.Printf) })
	// Files of users that no longer exist (a deletion whose file removal failed).
	if n, err := auth.SweepOrphanUserDirs(ctx, sqlDB, data); err != nil {
		log.Printf("startup sweep of orphan user directories: %v", err)
	} else if n > 0 {
		log.Printf("startup sweep: removed %d orphan user director%s", n, map[bool]string{true: "y", false: "ies"}[n == 1])
	}
	// Interrupted restores and server backups leave staged files behind.
	api.CleanBackupTemp(data)
	var limiter *ai.Limiter
	if aiSvc != nil {
		limiter = aiSvc.Limiter
	}
	runJanitor(func() {
		journal.RunJanitor(bg, journal.Photos{DB: sqlDB, Dir: filepath.Join(data, "journal")}, limiter, 15*time.Minute, log.Printf)
	})

	tess := journal.DetectTesseract(ctx, envOr("QINQIN_TESSERACT", "tesseract"))
	if tess.Available() {
		log.Printf("offline OCR: tesseract 5.x, languages: %s", strings.Join(tess.Languages(), ", "))
	} else {
		log.Printf("offline OCR: not available (tesseract not found)")
	}

	// First start: install the bundled packs (not the demos) when nothing is
	// installed yet; synchronous, before the listener. A failure is logged and
	// the server starts anyway (the next start retries; `qinqin seed` works).
	// A signal aborts it: each pack is one transaction and the done marker is
	// set only after the whole seed, so the next start seeds again.
	if err := autoSeed(ctx, sqlDB, data, defaultPacks(), os.Getenv, log.Printf); err != nil {
		log.Printf("%v", err)
	}

	// Stroke data: install the bundled strokes pack when none is installed
	// (v0.3 shipped it in the web build); a failure only loses strokes.
	if err := autoInstallStrokes(ctx, sqlDB, defaultPacks(), log.Printf); err != nil {
		log.Printf("%v", err)
	}

	// Data packages: one builder goroutine; the startup reconcile builds what
	// is missing or stale in the background (the catalogue says building).
	pkgs, pkgsDone := startPackages(bg, sqlDB, data, log.Printf)

	var apiJobs api.Jobs
	if ctx.Err() != nil {
		log.Printf("shutting down: stopped during startup, before listening")
	} else if ln, err := listen(); err != nil {
		log.Printf("listen: %v", err)
		cancelBg()
		<-mailDone
		<-pkgsDone
		return err
	} else {
		log.Printf("qinqin listening on %s (data: %s)", ln.Addr(), data)
		srv := newHTTPServer(rootHandler(webdist.Dist, api.New(sqlDB, data, librarySources(data, sqlDB), api.WithAI(aiSvc), api.WithMail(mailSvc), api.WithSecrets(sec.Current, sec.Previous), api.WithOCR(tess), api.WithStageSweeper(bg, 5*time.Minute), api.WithBackgroundGroup(&apiJobs), api.WithTrustedProxies(trusted), api.WithPackages(pkgs))))
		if err := runHTTP(ctx, srv, ln, httpGrace, log.Printf); err != nil {
			log.Printf("%v", err)
		}
	}
	if shutdownHooks.afterHTTP != nil {
		shutdownHooks.afterHTTP(mailDone, pkgsDone)
	}

	cancelBg()
	deadline := time.Now().Add(backgroundGrace)
	waitStep("mail queue", mailDone, deadline, log.Printf)
	if n := mailSvc.Pending(); n > 0 {
		log.Printf("mail: %d queued mail(s) not sent", n)
	}
	waitStep("package builder", pkgsDone, deadline, log.Printf)
	jobsDone := make(chan struct{})
	go func() {
		apiJobs.Wait()
		close(jobsDone)
	}()
	waitStep("background jobs", jobsDone, deadline, log.Printf)
	janitorsDone := make(chan struct{})
	go func() {
		janitors.Wait()
		close(janitorsDone)
	}()
	waitStep("janitors", janitorsDone, deadline, log.Printf)
	if shutdownHooks.afterJobs != nil {
		shutdownHooks.afterJobs(sqlDB)
	}
	if err := closeDB(); err != nil {
		log.Printf("close database: %v", err)
	}
	log.Printf("shutdown complete")
	return nil
}

// shutdownHooks are test seams of serve's shutdown: afterHTTP runs once the
// HTTP server stopped and before the workers are told to stop, afterJobs
// once every worker stopped and before the database closes.
var shutdownHooks struct {
	afterHTTP func(mailDone, pkgsDone <-chan struct{})
	afterJobs func(sqlDB *sql.DB)
}

// runHTTP serves srv on ln until ctx ends, then stops accepting and gives
// the requests in flight grace to finish; what still runs after that (a long
// download) is closed. An error is a failed listener or a forced close.
func runHTTP(ctx context.Context, srv *http.Server, ln net.Listener, grace time.Duration, logf func(string, ...any)) error {
	served := make(chan error, 1)
	go func() { served <- srv.Serve(ln) }()
	select {
	case err := <-served:
		return fmt.Errorf("http server: %w", err)
	case <-ctx.Done():
	}
	logf("shutting down: no new connections; requests in flight get %s", grace)
	sctx, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	if err := srv.Shutdown(sctx); err != nil {
		logf("http server: requests still running after %s; closing them", grace)
		srv.Close()
		<-served
		return fmt.Errorf("http server: shutdown: %w", err)
	}
	<-served
	logf("http server stopped")
	return nil
}

// waitStep waits until done is closed or the deadline passes, and logs
// which of the two it was for the named shutdown step.
func waitStep(name string, done <-chan struct{}, deadline time.Time, logf func(string, ...any)) {
	select {
	case <-done: // already stopped, even after the deadline
		logf("%s stopped", name)
		return
	default:
	}
	t := time.NewTimer(time.Until(deadline))
	defer t.Stop()
	select {
	case <-done:
		logf("%s stopped", name)
	case <-t.C:
		logf("%s did not stop before the shutdown deadline; exiting anyway", name)
	}
}

// newHTTPServer is the HTTP server of serve (#170): a client gets 10 s to
// send its request headers and an idle keep-alive connection is closed after
// 120 s, so slow-header connections cannot pile up. There is deliberately no
// ReadTimeout or WriteTimeout: uploads, package downloads and the streamed
// legacy pull set their own deadlines (api stream_deadline.go).
func newHTTPServer(h http.Handler) *http.Server {
	return &http.Server{
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
}

// version is sent in the User-Agent of requests to the text sources; set
// it at build time with -ldflags "-X main.version=1.2.3".
var version = "dev"

// librarySources builds the public-domain text sources, sharing one
// HTTP client (rate limits and cache under <data>/cache/sources).
// Gutenberg's Chinese titles are indexed by pinyin from the lexicon in
// sqlDB.
func librarySources(dataDir string, sqlDB *sql.DB) []sources.Source {
	c := sources.NewHTTPClient(filepath.Join(dataDir, "cache", "sources"),
		"qinqin/"+version+" (+https://github.com/Elaktrato/qinqin)")
	return []sources.Source{aozora.New(c), gutenberg.New(c, lexiconPinyin(lexicon.Store{DB: sqlDB}))}
}

// lexiconPinyin converts text to toneless pinyin through the lexicon; a
// failed lookup converts to "" (the work stays searchable as written).
func lexiconPinyin(st lexicon.Store) sources.Phonetics {
	return func(ctx context.Context, text string) string {
		p, err := st.Pinyin(ctx, text)
		if err != nil {
			return ""
		}
		return p
	}
}

// rootHandler mounts the API on /api/, /hanzi/, /fonts/ and /healthz and the web frontend on
// everything else. The SPA handler must never shadow the API, and the API's
// own mux stays the sole owner of its routes.
func rootHandler(web fs.FS, apiHandler http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/", apiHandler)
	mux.Handle("/healthz", apiHandler)
	// Stroke files come from the installed strokes pack (same URL as the
	// static files of v0.3, so old shells and the worker keep working).
	mux.Handle("/hanzi/", apiHandler)
	// Font pack slices (#97) come from <data>/fonts through the API.
	mux.Handle("/fonts/", apiHandler)
	// The trailing-slash form would otherwise fall through to the SPA and
	// answer 200 HTML to a health probe.
	mux.Handle("/healthz/{$}", http.RedirectHandler("/healthz", http.StatusPermanentRedirect))
	mux.Handle("/", webdist.Handler(web))
	return browserHeaders(mux)
}

// browserHeaders adds the headers every response (API, health and static)
// carries: no Referer is sent from a page of this app (reset and invite
// links keep their secret in the fragment, but nothing should leak further),
// and no other site may frame it. There is deliberately no CSP yet.
func browserHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}

// envOr returns the environment variable key, or def when it is empty.
func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
