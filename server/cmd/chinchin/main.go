// Command qinqin serves the qinqin Chinese learning platform backend.
package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"qinqin/internal/api"
	"qinqin/internal/db"
	"qinqin/internal/lang"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address for the HTTP server")
	data := flag.String("data", "./data", "data directory holding the SQLite database and packs")
	flag.Parse()

	if err := run(*addr, *data); err != nil {
		log.Fatal(err)
	}
}

func run(addr, dataDir string) error {
	// Code packs register before the server starts serving: the zh pack
	// normalizes pinyin readings and derives their bopomofo forms, the
	// ja pack folds kana readings and derives their romaji.
	lang.Register(lang.Zh{})
	lang.Register(lang.Ja{})

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return fmt.Errorf("create data directory %s: %w", dataDir, err)
	}
	sqlDB, err := db.Open(filepath.Join(dataDir, "qinqin.db"))
	if err != nil {
		return err
	}
	defer sqlDB.Close()

	log.Printf("qinqin listening on %s (data: %s)", addr, dataDir)
	return http.ListenAndServe(addr, api.New(sqlDB, dataDir))
}
