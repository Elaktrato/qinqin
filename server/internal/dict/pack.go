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
	pack, err := loadDir(dir)
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

// ExtractZip extracts the zip read from r into dir. Entry names must be
// relative and stay inside dir — absolute names and any traversal
// outside it (zip-slip) are rejected, as are non-regular files such as
// symlinks.
func ExtractZip(r io.Reader, dir string) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return fmt.Errorf("read zip: %w", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return fmt.Errorf("%w: open zip: %v", ErrInvalidPack, err)
	}
	for _, f := range zr.File {
		target, err := zipTarget(dir, f.Name)
		if err != nil {
			return err
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return fmt.Errorf("create directory %s: %w", target, err)
			}
			continue
		}
		if !f.FileInfo().Mode().IsRegular() {
			return fmt.Errorf("%w: zip entry %q is not a regular file", ErrInvalidPack, f.Name)
		}
		if err := extractFile(f, target); err != nil {
			return err
		}
	}
	return nil
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

// extractFile unzips one zip entry into target.
func extractFile(f *zip.File, target string) error {
	src, err := f.Open()
	if err != nil {
		return fmt.Errorf("open zip entry %s: %w", f.Name, err)
	}
	defer src.Close()
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fmt.Errorf("create directory of %s: %w", target, err)
	}
	dst, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return fmt.Errorf("create %s: %w", target, err)
	}
	defer dst.Close()
	if _, err := io.Copy(dst, src); err != nil {
		return fmt.Errorf("extract zip entry %s: %w", f.Name, err)
	}
	return nil
}
