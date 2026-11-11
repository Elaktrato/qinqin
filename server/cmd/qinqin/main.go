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

	"qinqin/internal/api"
	"qinqin/internal/db"
	"qinqin/internal/lang"
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

// builtinFlashcardsManifest registers the flashcards feature the web
// build ships. The manifest lives here, next to serving, so the server
// registry lists the widget in Settings and can carry its per-user
// enabled/order state; Register upserts by id, so every start is safe.
const builtinFlashcardsManifest = `{"id":"qinqin-flashcards","name":"Flashcards","version":"1.0","type":"feature","surfaces":["home-widget"]}`

// registerBuiltinPlugins puts the feature plugins this build ships a
// component for into the server registry. It runs at serve startup,
// after migrations and before the HTTP server accepts requests.
func registerBuiltinPlugins(ctx context.Context, sqlDB *sql.DB) error {
	if err := plugins.Register(ctx, sqlDB, []byte(builtinFlashcardsManifest)); err != nil {
		return fmt.Errorf("register built-in plugin qinqin-flashcards: %w", err)
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

	log.Printf("qinqin listening on %s (data: %s)", *addr, *data)
	return http.ListenAndServe(*addr, rootHandler(webdist.Dist, api.New(sqlDB, *data)))
}

// rootHandler mounts the API on /api/ and /healthz and the web frontend on
// everything else. The SPA handler must never shadow the API, and the API's
// own mux stays the sole owner of its routes.
func rootHandler(web fs.FS, apiHandler http.Handler) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/", apiHandler)
	mux.Handle("/healthz", apiHandler)
	mux.Handle("/", webdist.Handler(web))
	return mux
}
