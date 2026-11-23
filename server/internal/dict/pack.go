package dict

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ErrInvalidPack reports a pack whose files are missing, malformed, or
// invalid; callers map it to a client error rather than a server fault.
var ErrInvalidPack = errors.New("dict: invalid pack")

// Pack is one loaded pack: its validated manifest plus the directory
// holding its data files.
type Pack struct {
	Manifest
	Dir string
}

// manifestFile is the pack manifest's file name, at the pack root.
const manifestFile = "manifest.json"

// LoadPack loads the pack at path — a directory or a .zip file —
// reading and validating its manifest.json. A zip is extracted to a
// temporary directory first; the caller may remove Pack.Dir after the
// import, which it only needs to do for packs loaded by zip path.
func LoadPack(path string) (Pack, error) {
	if strings.EqualFold(filepath.Ext(path), ".zip") {
		return loadZip(path)
	}
	info, err := os.Stat(path)
	if err != nil {
		return Pack{}, fmt.Errorf("%w: open pack %s: %v", ErrInvalidPack, path, err)
	}
	if !info.IsDir() {
		return Pack{}, fmt.Errorf("%w: pack %s is neither a directory nor a .zip", ErrInvalidPack, path)
	}
	return loadDir(path)
}

// LoadExtracted loads the pack from dir, a directory a zip was extracted
// into: the pack is dir itself or the one folder inside it (see
// PackRoot). Pack.Dir is the directory holding manifest.json.
func LoadExtracted(dir string) (Pack, error) {
	root, err := PackRoot(dir)
	if err != nil {
		return Pack{}, err
	}
	return loadDir(root)
}

// loadZip extracts the zip at path into a fresh temp directory and
// loads the pack from there, removing the extraction again when the
// pack does not load.
func loadZip(path string) (Pack, error) {
	f, err := os.Open(path)
	if err != nil {
		return Pack{}, fmt.Errorf("%w: open pack %s: %v", ErrInvalidPack, path, err)
	}
	defer f.Close()
	dir, err := os.MkdirTemp("", "qinqin-pack-*")
	if err != nil {
		return Pack{}, fmt.Errorf("create extraction dir for %s: %w", path, err)
	}
	if err := ExtractZip(f, dir); err != nil {
		os.RemoveAll(dir)
		return Pack{}, err
	}
	root, err := PackRoot(dir)
	if err != nil {
		os.RemoveAll(dir)
		return Pack{}, err
	}
	pack, err := loadDir(root)
	if err != nil {
		os.RemoveAll(dir)
		return Pack{}, err
	}
	return pack, nil
}

// loadDir reads and validates dir's manifest.json.
func loadDir(dir string) (Pack, error) {
	data, err := os.ReadFile(filepath.Join(dir, manifestFile))
	if err != nil {
		return Pack{}, fmt.Errorf("%w: read manifest of %s: %v", ErrInvalidPack, dir, err)
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return Pack{}, fmt.Errorf("%w: parse manifest of %s: %v", ErrInvalidPack, dir, err)
	}
	m.normalize()
	if err := m.Validate(); err != nil {
		return Pack{}, fmt.Errorf("%w: %s: %v", ErrInvalidPack, dir, err)
	}
	return Pack{Manifest: m, Dir: dir}, nil
}

// ZipLimits bounds what ExtractZipAt unpacks: the number of entries and
// the total bytes actually written (not the sizes the headers declare).
type ZipLimits struct {
	MaxFiles int
	MaxBytes int64
}

// DefaultZipLimits are the limits ExtractZip applies.
var DefaultZipLimits = ZipLimits{MaxFiles: 2000, MaxBytes: 512 << 20}

// ExtractZip extracts the zip read from r into dir with DefaultZipLimits.
func ExtractZip(r io.Reader, dir string) error {
	// An archive larger than the whole unpack budget cannot be a pack, so
	// the compressed input is capped too.
	data, err := io.ReadAll(io.LimitReader(r, DefaultZipLimits.MaxBytes+1))
	if err != nil {
		return fmt.Errorf("read zip: %w", err)
	}
	if int64(len(data)) > DefaultZipLimits.MaxBytes {
		return fmt.Errorf("%w: zip is larger than %d MiB", ErrInvalidPack, mib(DefaultZipLimits.MaxBytes))
	}
	return ExtractZipAt(bytes.NewReader(data), int64(len(data)), dir, DefaultZipLimits)
}

// ExtractZipAt extracts the zip in r into dir. Entry names must be
// relative and stay inside dir — absolute names and any traversal
// outside it (zip-slip) are rejected, as are non-regular files such as
// symlinks. Entry count and the bytes written are capped by lim.
func ExtractZipAt(r io.ReaderAt, size int64, dir string, lim ZipLimits) error {
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return fmt.Errorf("%w: open zip: %v", ErrInvalidPack, err)
	}
	if len(zr.File) > lim.MaxFiles {
		return fmt.Errorf("%w: zip has more than %d files", ErrInvalidPack, lim.MaxFiles)
	}
	remaining := lim.MaxBytes
	for _, f := range zr.File {
		if isOSMetadata(f.Name) {
			continue
		}
		target, err := zipTarget(dir, f.Name)
		if err != nil {
			return err
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return fmt.Errorf("create directory of zip entry: %w", err)
			}
			continue
		}
		if !f.FileInfo().Mode().IsRegular() {
			return fmt.Errorf("%w: zip entry %q is not a regular file", ErrInvalidPack, f.Name)
		}
		n, err := extractFile(f, target, remaining)
		if err != nil {
			return err
		}
		remaining -= n
	}
	return nil
}

// PackRoot returns the directory holding the pack's manifest.json: dir
// itself, or the one folder at the top of dir when that holds it (what
// "Compress folder" produces).
func PackRoot(dir string) (string, error) {
	if _, err := os.Stat(filepath.Join(dir, manifestFile)); err == nil {
		return dir, nil
	}
	all, err := os.ReadDir(dir)
	if err != nil {
		return "", fmt.Errorf("read pack directory: %w", err)
	}
	var entries []os.DirEntry
	for _, en := range all {
		if !isOSMetadata(en.Name()) {
			entries = append(entries, en)
		}
	}
	if len(entries) == 1 && entries[0].IsDir() {
		sub := filepath.Join(dir, entries[0].Name())
		if _, err := os.Stat(filepath.Join(sub, manifestFile)); err == nil {
			return sub, nil
		}
	}
	return "", fmt.Errorf("%w: manifest.json not found at the top of the zip", ErrInvalidPack)
}

// zipTarget resolves a zip entry name to a path inside dir, rejecting
// names that would land outside it.
func zipTarget(dir, name string) (string, error) {
	if name == "" {
		return "", fmt.Errorf("%w: zip entry with an empty name", ErrInvalidPack)
	}
	cleaned := filepath.Clean(filepath.FromSlash(name))
	if filepath.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: zip entry %q escapes the pack directory", ErrInvalidPack, name)
	}
	return filepath.Join(dir, cleaned), nil
}

// extractFile unzips one zip entry into target, writing at most limit
// bytes; it returns the bytes written.
func extractFile(f *zip.File, target string, limit int64) (int64, error) {
	src, err := f.Open()
	if err != nil {
		return 0, fmt.Errorf("%w: open zip entry %s: %v", ErrInvalidPack, f.Name, err)
	}
	defer src.Close()
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return 0, fmt.Errorf("create directory of zip entry: %w", err)
	}
	dst, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return 0, fmt.Errorf("create zip entry file: %w", err)
	}
	n, err := copyEntry(dst, src, f.Name, limit)
	if cerr := dst.Close(); err == nil && cerr != nil {
		return n, fmt.Errorf("write zip entry file: %w", cerr) // the server's disk, not the pack
	}
	return n, err
}

// writeFailure marks an error of the destination, so a full disk is never
// blamed on the pack.
type writeFailure struct {
	w   io.Writer
	err error
}

func (wf *writeFailure) Write(b []byte) (int, error) {
	n, err := wf.w.Write(b)
	if err != nil {
		wf.err = err
	}
	return n, err
}

// copyEntry copies at most limit bytes of one zip entry. A failing read
// (a damaged zip) or an entry over the limit is ErrInvalidPack; a failing
// write (a full disk) is a plain error the API answers 500 internal.
func copyEntry(dst io.Writer, src io.Reader, name string, limit int64) (int64, error) {
	wf := &writeFailure{w: dst}
	n, err := io.Copy(wf, io.LimitReader(src, limit+1))
	if wf.err != nil {
		return n, fmt.Errorf("write zip entry %s: %w", name, wf.err)
	}
	if err != nil {
		return n, fmt.Errorf("%w: extract zip entry %s: %v", ErrInvalidPack, name, err)
	}
	if n > limit {
		return n, fmt.Errorf("%w: zip unpacks to more than %d MiB", ErrInvalidPack, mib(limit))
	}
	return n, nil
}

// mib reports limit in MiB, at least 1 so small test limits read sensibly.
func mib(limit int64) int64 {
	if m := limit >> 20; m > 0 {
		return m
	}
	return 1
}

// isOSMetadata reports zip entries file managers add that belong to no
// pack: the __MACOSX resource-fork folder, .DS_Store, AppleDouble "._"
// files, Thumbs.db and desktop.ini, at any depth. They are skipped when
// extracting and ignored when looking for the single folder of a zip.
func isOSMetadata(name string) bool {
	for _, part := range strings.Split(filepath.ToSlash(name), "/") {
		switch {
		case part == "__MACOSX", part == ".DS_Store", part == "Thumbs.db", part == "desktop.ini",
			strings.HasPrefix(part, "._"):
			return true
		}
	}
	return false
}
