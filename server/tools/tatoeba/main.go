// Command tatoeba builds the bundled example sentence packs
// plugins/data/zh-sentences-tatoeba and plugins/data/ja-sentences-tatoeba
// from a pinned Tatoeba export (https://tatoeba.org). Run it from server/:
//
//	go run ./tools/tatoeba pin --licence-checked YYYY-MM-DD
//	go run ./tools/tatoeba build
//
// pin downloads the archives pin.json names into the git-ignored
// plugins/upstream/tatoeba/ and records their SHA-256, the export date and
// the date the owner re-read Tatoeba's downloads page and terms of use.
// build refuses until all of that is recorded, downloads a missing
// archive, verifies every hash, filters the sentences with rules.json and
// writes the packs; the same export, rules and dictionaries always give
// the same files. The design and its rulings:
// docs/superpowers/specs/2026-11-22-tatoeba-sentences-design.md.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func main() {
	if err := run(context.Background(), os.Args[1:], os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "tatoeba:", err)
		os.Exit(1)
	}
}

const usage = `usage (from server/):
  go run ./tools/tatoeba pin --licence-checked YYYY-MM-DD [--repin] [--export-date YYYY-MM-DD]
  go run ./tools/tatoeba build [--lang zh,ja] [--max-per-word N] [--workers N] [--allow-size]
common flags: --root (repository root, default ..), --pin, --export, --rules, --out, --reports`

func run(ctx context.Context, args []string, log io.Writer) error {
	if len(args) == 0 {
		return errors.New(usage)
	}
	cmd, rest := args[0], args[1:]
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	fs.SetOutput(log)
	root := fs.String("root", "..", "repository root")
	pinPath := fs.String("pin", "", "pin file (default <root>/server/tools/tatoeba/pin.json)")
	exportDir := fs.String("export", "", "folder of the downloaded archives (default <root>/plugins/upstream/tatoeba)")
	switch cmd {
	case "pin":
		licence := fs.String("licence-checked", "", "the date (YYYY-MM-DD) you re-read https://tatoeba.org/en/downloads and https://tatoeba.org/en/terms_of_use")
		repin := fs.Bool("repin", false, "replace recorded hashes: pin a new export")
		exportDate := fs.String("export-date", "", "the export date, when the server sends no Last-Modified header")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		pinFile, export := paths(*root, *pinPath, *exportDir)
		if *licence == "" {
			return errors.New("pin: --licence-checked YYYY-MM-DD is required: re-read Tatoeba's downloads page and terms of use first, and note in pin.json's licence.statement what they say")
		}
		return pinCmd(ctx, pinFile, export, *licence, *exportDate, *repin, log)
	case "build":
		rules := fs.String("rules", "", "rules file (default <root>/server/tools/tatoeba/rules.json)")
		out := fs.String("out", "", "pack folder (default <root>/plugins/data)")
		reports := fs.String("reports", "", "report folder (default: the export folder)")
		langs := fs.String("lang", "zh,ja", "languages to build")
		maxPerWord := fs.Int("max-per-word", 0, "sentences per word (default: the rules' maxPerWord)")
		workers := fs.Int("workers", runtime.NumCPU(), "parallel segmenters")
		allowSize := fs.Bool("allow-size", false, "write pack files above the 24 MiB per-file cap (recorded in ATTRIBUTION.md)")
		if err := fs.Parse(rest); err != nil {
			return err
		}
		pinFile, export := paths(*root, *pinPath, *exportDir)
		cfg := buildConfig{Root: *root, ExportDir: export, OutDir: *out, ReportDir: *reports, MaxPerWord: *maxPerWord, Workers: *workers, AllowSize: *allowSize, Log: log}
		if *rules == "" {
			*rules = filepath.Join(*root, "server", "tools", "tatoeba", "rules.json")
		}
		if cfg.OutDir == "" {
			cfg.OutDir = filepath.Join(*root, "plugins", "data")
		}
		if cfg.ReportDir == "" {
			cfg.ReportDir = export
		}
		for _, l := range strings.Split(*langs, ",") {
			if l = strings.TrimSpace(l); l != "" {
				cfg.Langs = append(cfg.Langs, l)
			}
		}
		var err error
		if cfg.Pin, err = loadPin(pinFile); err != nil {
			return err
		}
		if err := cfg.Pin.requirePinned(); err != nil {
			return err
		}
		if cfg.Rules, err = loadRules(*rules); err != nil {
			return err
		}
		if err := fetchMissing(ctx, cfg.Pin, export, log); err != nil {
			return err
		}
		return build(ctx, cfg)
	}
	return fmt.Errorf("unknown command %q\n%s", cmd, usage)
}

func paths(root, pinPath, exportDir string) (string, string) {
	if pinPath == "" {
		pinPath = filepath.Join(root, "server", "tools", "tatoeba", "pin.json")
	}
	if exportDir == "" {
		exportDir = filepath.Join(root, "plugins", "upstream", "tatoeba")
	}
	return pinPath, exportDir
}
