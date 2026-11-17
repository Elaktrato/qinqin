package datapkg

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"os"
	"regexp"
	"slices"
	"strings"
	"time"

	"qinqin/internal/audio"
)

// ManifestFormat is manifest.json's format.
const ManifestFormat = "qinqin-package"

// Manifest is manifest.json inside a package zip
// (docs/contracts/packages/manifest.json); the field order is the key order.
type Manifest struct {
	Format        string       `json:"format"`
	FormatVersion int          `json:"formatVersion"`
	ID            string       `json:"id"`
	Type          Type         `json:"type"`
	Languages     []string     `json:"languages"`
	Revision      int          `json:"revision"`
	ContentHash   string       `json:"contentHash"`
	InstanceID    string       `json:"instanceId"`
	BuiltAt       string       `json:"builtAt"`
	Requires      []string     `json:"requires"`
	Sources       []SourceInfo `json:"sources"`
	Files         []File       `json:"files"`
}

// SourceInfo is a source pack as the manifest and the catalogue list it.
type SourceInfo struct {
	Type        string `json:"type"`
	PackID      string `json:"packId"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	License     string `json:"license"`
	Attribution string `json:"attribution"`
	Notice      string `json:"notice"`
}

// File is one listed file of a package zip.
type File struct {
	Name   string `json:"name"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

var (
	hexHash       = regexp.MustCompile(`^[0-9a-f]{64}$`)
	contentHashRE = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)
	clipName      = regexp.MustCompile(`^clips/[0-9a-f]{64}\.[a-z0-9]{1,8}$`)
	langCode      = regexp.MustCompile(`^[a-z]{2,3}(-[a-z0-9]+)*$`)
	manifestKey   = []string{"format", "formatVersion", "id", "type", "languages", "revision", "contentHash",
		"instanceId", "builtAt", "requires", "sources", "files"}
	sourceKeys = []string{"type", "packId", "name", "version", "license", "attribution", "notice"}
	fileKeys   = []string{"name", "bytes", "sha256"}
)

// ParseManifest decodes and validates a package manifest strictly: every
// key present, no unknown key, and Validate.
func ParseManifest(data []byte) (Manifest, error) {
	if err := exactKeys(data, manifestKey); err != nil {
		return Manifest{}, fmt.Errorf("manifest: %w", err)
	}
	var raw struct {
		Sources []json.RawMessage `json:"sources"`
		Files   []json.RawMessage `json:"files"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return Manifest{}, fmt.Errorf("manifest: %w", err)
	}
	for _, s := range raw.Sources {
		if err := exactKeys(s, sourceKeys); err != nil {
			return Manifest{}, fmt.Errorf("manifest: sources: %w", err)
		}
	}
	for _, f := range raw.Files {
		if err := exactKeys(f, fileKeys); err != nil {
			return Manifest{}, fmt.Errorf("manifest: files: %w", err)
		}
	}
	var m Manifest
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		return Manifest{}, fmt.Errorf("manifest: %w", err)
	}
	return m, m.Validate()
}

// exactKeys reports a JSON object whose keys are not exactly keys.
func exactKeys(data []byte, keys []string) error {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(data, &obj); err != nil {
		return err
	}
	for _, k := range keys {
		if _, ok := obj[k]; !ok {
			return fmt.Errorf("missing key %q", k)
		}
	}
	if len(obj) != len(keys) {
		for k := range obj {
			if !slices.Contains(keys, k) {
				return fmt.Errorf("unknown key %q", k)
			}
		}
	}
	return nil
}

// Validate checks a manifest's values (README.md, The package file).
func (m Manifest) Validate() error {
	typ, _, err := ParseID(m.ID)
	switch {
	case m.Format != ManifestFormat:
		return fmt.Errorf("manifest: format %q, want %s", m.Format, ManifestFormat)
	case m.FormatVersion < 1:
		return errors.New("manifest: formatVersion is an integer >= 1")
	case err != nil:
		return fmt.Errorf("manifest: %w", err)
	case typ != m.Type:
		return fmt.Errorf("manifest: type %q is not the id's prefix", m.Type)
	case m.Revision < 1:
		return errors.New("manifest: a built package has revision >= 1")
	case !contentHashRE.MatchString(m.ContentHash):
		return errors.New("manifest: contentHash is sha256:<64 lowercase hex>")
	case m.InstanceID == "":
		return errors.New("manifest: instanceId is empty")
	case len(m.Sources) == 0:
		return errors.New("manifest: no sources")
	case m.Requires == nil:
		return errors.New("manifest: requires is a list")
	}
	if _, err := time.Parse(time.RFC3339, m.BuiltAt); err != nil {
		return fmt.Errorf("manifest: builtAt: %w", err)
	}
	if len(m.Languages) == 0 || !slices.IsSorted(m.Languages) {
		return errors.New("manifest: languages is a non-empty sorted list of codes")
	}
	for _, l := range m.Languages {
		if !langCode.MatchString(l) {
			return fmt.Errorf("manifest: language %q", l)
		}
	}
	sources := map[string]bool{}
	for _, s := range m.Sources {
		sources[s.PackID] = true
	}
	seen := map[string]bool{}
	for _, f := range m.Files {
		if err := checkFileName(f.Name, m.Type, sources); err != nil {
			return fmt.Errorf("manifest: file %q: %w", f.Name, err)
		}
		if seen[f.Name] {
			return fmt.Errorf("manifest: file names are unique: %q twice", f.Name)
		}
		seen[f.Name] = true
		if !hexHash.MatchString(f.SHA256) {
			return fmt.Errorf("manifest: file %q: sha256 is 64 lowercase hex", f.Name)
		}
		if f.Bytes < 0 {
			return fmt.Errorf("manifest: file %q: bytes < 0", f.Name)
		}
	}
	if !seen["data.sqlite"] || !seen["NOTICE.md"] {
		return errors.New("manifest: data.sqlite and NOTICE.md are listed")
	}
	return nil
}

// checkFileName enforces the file name rules: relative, '/'-separated, no
// empty, '.' or '..' segment, and one of data.sqlite, NOTICE.md,
// LICENSES/<source packId>/<name>, clips/<sha256>.<ext> (audio only).
func checkFileName(name string, typ Type, sources map[string]bool) error {
	if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, `\`) {
		return errors.New("file names are relative and use '/' only")
	}
	segs := strings.Split(name, "/")
	for _, s := range segs {
		if s == "" || s == "." || s == ".." {
			return errors.New("no empty, '.' or '..' segments")
		}
	}
	switch {
	case name == "manifest.json":
		return errors.New("manifest.json is never listed")
	case name == "data.sqlite" || name == "NOTICE.md":
		return nil
	case segs[0] == "LICENSES" && len(segs) == 3:
		if !sources[segs[1]] {
			return errors.New("LICENSES/<packId>/ names a source")
		}
		return nil
	case segs[0] == "clips":
		if typ != TypeAudio {
			return errors.New("clips/ only in audio packages")
		}
		if !clipName.MatchString(name) {
			return errors.New("clips are clips/<sha256>.<ext>")
		}
		return nil
	}
	return errors.New("not one of data.sqlite, NOTICE.md, LICENSES/<packId>/<name>, clips/<sha256>.<ext>")
}

// sortedSources returns the sources by (type, pack id).
func sortedSources(in []Source) []Source {
	out := slices.Clone(in)
	slices.SortFunc(out, func(a, b Source) int {
		if c := strings.Compare(a.Type, b.Type); c != 0 {
			return c
		}
		return strings.Compare(a.PackID, b.PackID)
	})
	return out
}

// notice renders NOTICE.md: per source pack its name, version, licence,
// attribution, notice and licence files.
func notice(spec Spec) []byte {
	var b strings.Builder
	fmt.Fprintf(&b, "# Sources of %s\n\n", spec.ID)
	b.WriteString("This package was built by a qinqin server from the data packs below. ")
	b.WriteString("Each pack's licence files are in LICENSES/<pack id>/.\n")
	for _, s := range spec.Sources {
		fmt.Fprintf(&b, "\n## %s\n\n", s.Name)
		fmt.Fprintf(&b, "- Pack: %s `%s`, version %s\n", s.Type, s.PackID, s.Version)
		fmt.Fprintf(&b, "- Licence: %s\n", s.License)
		fmt.Fprintf(&b, "- Attribution: %s\n", s.Attribution)
		switch {
		case !s.TextsStored:
			b.WriteString("- Licence files: no licence files stored (the pack was installed before the server kept them; an administrator re-seeds it to add them)\n")
		case len(s.Texts) == 0:
			b.WriteString("- Licence files: none (the pack ships no licence file; its licence is named above)\n")
		default:
			names := make([]string, len(s.Texts))
			for i, t := range s.Texts {
				names[i] = "LICENSES/" + s.PackID + "/" + t.Name
			}
			fmt.Fprintf(&b, "- Licence files: %s\n", strings.Join(names, ", "))
		}
		if s.Notice != "" {
			fmt.Fprintf(&b, "\n%s\n", s.Notice)
		}
	}
	return []byte(b.String())
}

// countingHash counts and hashes what passes through it.
type countingHash struct {
	h hash.Hash
	n int64
}

func (c *countingHash) Write(p []byte) (int, error) {
	c.n += int64(len(p))
	return c.h.Write(p)
}

// writeZip writes the package file out: NOTICE.md, the licence texts,
// data.sqlite (Deflate), the clip files of an audio package (Store) and
// manifest.json last, listing every other member with its size and hash.
func writeZip(spec Spec, meta BuildMeta, contentHash string, data, out string) (Built, error) {
	f, err := os.OpenFile(out, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return Built{}, err
	}
	defer f.Close()
	whole := &countingHash{h: sha256.New()}
	zw := zip.NewWriter(io.MultiWriter(f, whole))
	modified := meta.Now.UTC()
	var files []File
	add := func(name string, method uint16, src io.Reader) error {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: method, Modified: modified})
		if err != nil {
			return err
		}
		c := &countingHash{h: sha256.New()}
		if _, err := io.Copy(io.MultiWriter(w, c), src); err != nil {
			return err
		}
		files = append(files, File{Name: name, Bytes: c.n, SHA256: hex.EncodeToString(c.h.Sum(nil))})
		return nil
	}

	if err := add("NOTICE.md", zip.Deflate, bytes.NewReader(notice(spec))); err != nil {
		return Built{}, err
	}
	for _, s := range spec.Sources {
		for _, t := range s.Texts {
			if err := add("LICENSES/"+s.PackID+"/"+t.Name, zip.Deflate, strings.NewReader(t.Text)); err != nil {
				return Built{}, err
			}
		}
	}
	db, err := os.Open(data)
	if err != nil {
		return Built{}, err
	}
	err = add("data.sqlite", zip.Deflate, db)
	db.Close()
	if err != nil {
		return Built{}, err
	}
	if spec.Type == TypeAudio {
		if err := addClips(data, meta.AudioDir, add); err != nil {
			return Built{}, err
		}
	}

	sources := make([]SourceInfo, len(spec.Sources))
	for i, s := range spec.Sources {
		sources[i] = SourceInfo{Type: s.Type, PackID: s.PackID, Name: s.Name, Version: s.Version,
			License: s.License, Attribution: s.Attribution, Notice: s.Notice}
	}
	m := Manifest{Format: ManifestFormat, FormatVersion: FormatVersion, ID: spec.ID, Type: spec.Type,
		Languages: slices.Clone(spec.Languages), Revision: meta.Revision, ContentHash: contentHash,
		InstanceID: meta.InstanceID, BuiltAt: modified.Format(time.RFC3339),
		Requires: append([]string{}, spec.Requires...), Sources: sources, Files: files}
	if err := m.Validate(); err != nil {
		return Built{}, err
	}
	raw, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return Built{}, err
	}
	w, err := zw.CreateHeader(&zip.FileHeader{Name: "manifest.json", Method: zip.Deflate, Modified: modified})
	if err != nil {
		return Built{}, err
	}
	if _, err := w.Write(append(raw, '\n')); err != nil {
		return Built{}, err
	}
	if err := zw.Close(); err != nil {
		return Built{}, err
	}
	if err := f.Sync(); err != nil {
		return Built{}, err
	}
	if err := f.Close(); err != nil {
		return Built{}, err
	}
	return Built{ContentHash: contentHash, SHA256: hex.EncodeToString(whole.h.Sum(nil)), Bytes: whole.n, Path: out, Manifest: m}, nil
}

// addClips adds the clip files the package's clips table names, each once,
// from the audio store. A clip name is checked before it becomes a path.
func addClips(data, audioDir string, add func(string, uint16, io.Reader) error) error {
	pkg, err := sql.Open("sqlite", "file:"+data+"?mode=ro")
	if err != nil {
		return err
	}
	defer pkg.Close()
	rows, err := pkg.Query(`SELECT DISTINCT sha256, ext FROM clips ORDER BY sha256, ext`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var sum, ext string
		if err := rows.Scan(&sum, &ext); err != nil {
			return err
		}
		name := "clips/" + sum + "." + ext
		if !clipName.MatchString(name) {
			return fmt.Errorf("clip %q: not a stored clip name", name)
		}
		f, err := os.Open(audio.BlobPath(audioDir, sum, ext))
		if err != nil {
			return fmt.Errorf("clip %s: %w", name, err)
		}
		err = add(name, zip.Store, f)
		f.Close()
		if err != nil {
			return err
		}
	}
	return rows.Err()
}
