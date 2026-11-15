// Command qinqin serves the qinqin Chinese learning platform backend
// and administers its data.
//
//	qinqin [serve] [--addr :8080] [--data ./data]
//	qinqin seed    --data <dir> --packs <dir>
//	qinqin adduser --data <dir> --username <name> [--admin]
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"qinqin/internal/ai"
	"qinqin/internal/api"
	"qinqin/internal/db"
	"qinqin/internal/journal"
	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
	"qinqin/internal/library/sources"
	"qinqin/internal/library/sources/aozora"
	"qinqin/internal/library/sources/gutenberg"
	"qinqin/internal/plugins"
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
	default:
		err = fmt.Errorf("%w: unknown command %q (want serve, seed, or adduser)", errUsage, cmd)
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
	registerLanguages()
	sqlDB, err := openData(*data)
	if err != nil {
		return err
	}
	defer sqlDB.Close()

	if err := registerBuiltinPlugins(context.Background(), sqlDB); err != nil {
		return err
	}
	// The Sources page shows the stored terms; say when seed is due.
	warnStalePackTerms(context.Background(), sqlDB, defaultPacks(), log.Printf)

	aiSvc := aiFromEnv(sqlDB, os.Getenv, log.Printf)
	ctx, stop := context.WithCancel(context.Background())
	defer stop()
	go aiJanitor(ctx, aiSvc, 15*time.Minute, log.Printf)
	var limiter *ai.Limiter
	if aiSvc != nil {
		limiter = aiSvc.Limiter
	}
	go journal.RunJanitor(ctx, journal.Photos{DB: sqlDB, Dir: filepath.Join(*data, "journal")}, limiter, 15*time.Minute, log.Printf)

	tess := journal.DetectTesseract(ctx, envOr("QINQIN_TESSERACT", "tesseract"))
	if tess.Available() {
		log.Printf("offline OCR: tesseract 5.x, languages: %s", strings.Join(tess.Languages(), ", "))
	} else {
		log.Printf("offline OCR: not available (tesseract not found)")
	}

	log.Printf("qinqin listening on %s (data: %s)", *addr, *data)
	return http.ListenAndServe(*addr, rootHandler(webdist.Dist, api.New(sqlDB, *data, librarySources(*data, sqlDB), api.WithAI(aiSvc), api.WithOCR(tess), api.WithStageSweeper(ctx, 5*time.Minute))))
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

// rootHandler mounts the API on /api/ and /healthz and the web frontend on
// everything else. The SPA handler must never shadow the API, and the API's
// own mux stays the sole owner of its routes.
func rootHandler(web fs.FS, apiHandler http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/", apiHandler)
	mux.Handle("/healthz", apiHandler)
	// The trailing-slash form would otherwise fall through to the SPA and
	// answer 200 HTML to a health probe.
	mux.Handle("/healthz/{$}", http.RedirectHandler("/healthz", http.StatusPermanentRedirect))
	mux.Handle("/", webdist.Handler(web))
	return mux
}

// envOr returns the environment variable key, or def when it is empty.
func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
