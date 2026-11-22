package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// httpClient fetches the archives; tests replace it.
var httpClient = http.DefaultClient

// download fetches the archive into dir as <file>.part and returns that
// path, its SHA-256 and the server's Last-Modified time (zero if none).
// The caller renames or removes the part file.
func download(ctx context.Context, a Archive, dir string, log io.Writer) (part, sum string, modified time.Time, err error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", "", time.Time{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.URL, nil)
	if err != nil {
		return "", "", time.Time{}, err
	}
	fmt.Fprintf(log, "downloading %s\n", a.URL)
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", "", time.Time{}, fmt.Errorf("download %s: %w", a.Name, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", "", time.Time{}, fmt.Errorf("download %s: %s", a.URL, resp.Status)
	}
	part = filepath.Join(dir, a.file()+".part")
	f, err := os.Create(part)
	if err != nil {
		return "", "", time.Time{}, err
	}
	h := sha256.New()
	_, err = io.Copy(io.MultiWriter(f, h), resp.Body)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(part)
		return "", "", time.Time{}, fmt.Errorf("download %s: %w", a.Name, err)
	}
	if lm := resp.Header.Get("Last-Modified"); lm != "" {
		modified, _ = http.ParseTime(lm)
	}
	return part, hex.EncodeToString(h.Sum(nil)), modified, nil
}

// pinCmd downloads every archive afresh, records its hash, the export
// date and the licence check in the pin file, and keeps the archives in
// dir. A changed hash needs repin; then nothing is written or replaced.
func pinCmd(ctx context.Context, pinFile, dir, licenceChecked, exportDate string, repin bool, log io.Writer) error {
	p, err := loadPin(pinFile)
	if err != nil {
		return err
	}
	if err := statementProblem(p.Licence.Statement); err != nil {
		return fmt.Errorf("pin: %w", err)
	}
	sums := map[string]string{}
	parts := map[string]string{}
	defer func() {
		for _, part := range parts {
			os.Remove(part)
		}
	}()
	for _, a := range p.Archives {
		part, sum, modified, err := download(ctx, a, dir, log)
		if err != nil {
			return err
		}
		parts[a.Name], sums[a.Name] = part, sum
		if a.Name == nameSentences && exportDate == "" && !modified.IsZero() {
			exportDate = modified.UTC().Format("2006-01-02")
		}
	}
	if exportDate == "" {
		return fmt.Errorf("pin: the server sent no Last-Modified date for %s; pass --export-date YYYY-MM-DD", nameSentences)
	}
	if err := p.record(sums, exportDate, licenceChecked, repin); err != nil {
		return err
	}
	for _, a := range p.Archives {
		if err := os.Rename(parts[a.Name], filepath.Join(dir, a.file())); err != nil {
			return err
		}
		delete(parts, a.Name)
	}
	if err := p.save(pinFile); err != nil {
		return err
	}
	fmt.Fprintf(log, "pinned the export of %s in %s; commit it, then run `go run ./tools/tatoeba build`\n", exportDate, pinFile)
	return nil
}

// fetchMissing downloads the pinned archives that are not in dir yet,
// keeping one only when its hash is the pinned one.
func fetchMissing(ctx context.Context, p Pin, dir string, log io.Writer) error {
	for _, a := range p.Archives {
		if _, err := os.Stat(filepath.Join(dir, a.file())); err == nil {
			continue
		}
		part, sum, _, err := download(ctx, a, dir, log)
		if err != nil {
			return err
		}
		if sum != a.SHA256 {
			os.Remove(part)
			return fmt.Errorf("download %s: SHA-256 %s, pinned %s; Tatoeba has published a newer export: re-pin it (pin --repin) or restore the pinned archive into %s", a.Name, sum, a.SHA256, dir)
		}
		if err := os.Rename(part, filepath.Join(dir, a.file())); err != nil {
			return err
		}
	}
	return nil
}
