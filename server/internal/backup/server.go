package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"time"
)

// ServerFormat names the whole-server archive.
const (
	ServerFormat        = "qinqin-server-backup"
	ServerFormatVersion = 1
	spaceMargin         = 64 << 20
)

// ErrInsufficientStorage means the data volume cannot hold the snapshot.
var ErrInsufficientStorage = errors.New("backup: not enough free space for a snapshot of the database")

// Include chooses what a server backup carries.
type Include struct{ DB, Books, Packs, Audio bool }

// AllIncluded carries everything a server backup can.
var AllIncluded = Include{DB: true, Books: true, Packs: true, Audio: true}

// ParseInclude reads the include list of a request; an empty list means all.
func ParseInclude(names []string) (Include, error) {
	if len(names) == 0 {
		return AllIncluded, nil
	}
	var inc Include
	for _, n := range names {
		switch n {
		case "db":
			inc.DB = true
		case "books":
			inc.Books = true
		case "packs":
			inc.Packs = true
		case "audio":
			inc.Audio = true
		default:
			return Include{}, fmt.Errorf("unknown part %q", n)
		}
	}
	return inc, nil
}

// Names lists the parts in a fixed order.
func (i Include) Names() []string {
	var out []string
	for _, p := range []struct {
		on   bool
		name string
	}{{i.DB, "db"}, {i.Books, "books"}, {i.Packs, "packs"}, {i.Audio, "audio"}} {
		if p.on {
			out = append(out, p.name)
		}
	}
	return out
}

// freeBytes and afterSnapshot are seams for tests.
var (
	freeBytes = func(dir string) (uint64, error) {
		var st syscall.Statfs_t
		err := syscall.Statfs(dir, &st)
		return st.Bavail * uint64(st.Bsize), err
	}
	afterSnapshot = func() {}
)

// DBPath is the database file of a data directory.
func DBPath(dataDir string) string { return filepath.Join(dataDir, "qinqin.db") }

// CheckSpace says whether the volume of dataDir can take a VACUUM INTO of the
// database: free space >= database + WAL + 64 MiB.
func CheckSpace(dataDir string) error {
	need := int64(spaceMargin)
	for _, p := range []string{DBPath(dataDir), DBPath(dataDir) + "-wal"} {
		if st, err := os.Stat(p); err == nil {
			need += st.Size()
		}
	}
	free, err := freeBytes(dataDir)
	if err != nil {
		return fmt.Errorf("backup: free space: %w", err)
	}
	if free < uint64(need) {
		return ErrInsufficientStorage
	}
	return nil
}

// ServerInfo is BACKUP-INFO.json, the last entry of a server backup.
type ServerInfo struct {
	Format        string      `json:"format"`
	FormatVersion int         `json:"formatVersion"`
	AppVersion    string      `json:"appVersion"`
	SchemaVersion string      `json:"schemaVersion"`
	CreatedAt     string      `json:"createdAt"`
	Include       []string    `json:"include"`
	Files         []FileEntry `json:"files"`
}

// SnapshotDB writes a consistent copy of the database with VACUUM INTO to a
// new file under <data>/tmp and returns its path. The caller removes it.
func SnapshotDB(ctx context.Context, db *sql.DB, dataDir string) (string, error) {
	dir := filepath.Join(dataDir, "tmp")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("backup: tmp dir: %w", err)
	}
	path := filepath.Join(dir, "backup-"+time.Now().UTC().Format("20060102-150405")+"-"+randHex()+".db")
	// The name is generated here from fixed characters, never from input.
	if _, err := db.ExecContext(ctx, `VACUUM INTO `+quoteSQL(path)); err != nil {
		os.Remove(path)
		return "", fmt.Errorf("backup: snapshot: %w", err)
	}
	os.Chmod(path, 0o600)
	return path, nil
}

func quoteSQL(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// WriteServer streams a tar.gz of the chosen parts: qinqin.db (a VACUUM INTO
// snapshot taken first; WAL writers continue), books/, packs/, audio/ and
// BACKUP-INFO.json last. Never journal/, cache/, tmp/ or backups/. Files that
// vanish between the walk and the read are skipped; symbolic links and other
// non-regular files are never followed.
func WriteServer(ctx context.Context, db *sql.DB, dataDir string, inc Include, w io.Writer, meta Meta) error {
	var snap string
	if inc.DB {
		var err error
		if snap, err = SnapshotDB(ctx, db, dataDir); err != nil {
			return err
		}
		defer os.Remove(snap)
		afterSnapshot()
	}
	gz, err := gzip.NewWriterLevel(w, gzip.BestSpeed)
	if err != nil {
		return err
	}
	tw := tar.NewWriter(gz)
	var files []FileEntry
	add := func(name, path string) error {
		f, err := os.Open(path)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		defer f.Close()
		st, err := f.Stat()
		if err != nil || !st.Mode().IsRegular() {
			return nil
		}
		hdr := &tar.Header{Name: name, Mode: 0o600, Size: st.Size(), ModTime: st.ModTime(), Typeflag: tar.TypeReg}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		h := sha256.New()
		n, err := io.Copy(io.MultiWriter(tw, h), io.LimitReader(f, st.Size()))
		if err != nil {
			return err
		}
		if n != st.Size() {
			return fmt.Errorf("backup: %s changed while it was read", name)
		}
		files = append(files, FileEntry{Name: name, Bytes: n, SHA256: hex.EncodeToString(h.Sum(nil))})
		return ctx.Err()
	}
	if inc.DB {
		if err := add("qinqin.db", snap); err != nil {
			return err
		}
	}
	for _, part := range []struct {
		on   bool
		dir  string
		skip string
	}{{inc.Books, "books", ".restore-"}, {inc.Packs, "packs", ".stage-"}, {inc.Audio, "audio", ""}} {
		if !part.on {
			continue
		}
		root := filepath.Join(dataDir, part.dir)
		err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				if errors.Is(err, os.ErrNotExist) {
					return nil
				}
				return err
			}
			if d.IsDir() {
				if part.skip != "" && strings.HasPrefix(d.Name(), part.skip) {
					return filepath.SkipDir
				}
				return nil
			}
			if !d.Type().IsRegular() {
				return nil // a symlink or special file: never followed
			}
			rel, err := filepath.Rel(dataDir, p)
			if err != nil || strings.HasPrefix(rel, "..") {
				return nil
			}
			return add(filepath.ToSlash(rel), p)
		})
		if err != nil {
			return err
		}
	}
	slices.SortFunc(files, func(a, b FileEntry) int { return strings.Compare(a.Name, b.Name) })
	info := ServerInfo{Format: ServerFormat, FormatVersion: ServerFormatVersion, AppVersion: meta.AppVersion, SchemaVersion: meta.SchemaVersion,
		CreatedAt: meta.Now.UTC().Format(time.RFC3339), Include: inc.Names(), Files: files}
	body, err := json.MarshalIndent(info, "", " ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	if err := tw.WriteHeader(&tar.Header{Name: "BACKUP-INFO.json", Mode: 0o600, Size: int64(len(body)), ModTime: meta.Now, Typeflag: tar.TypeReg}); err != nil {
		return err
	}
	if _, err := tw.Write(body); err != nil {
		return err
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}

// SetFreeBytesForTest swaps the free-space probe (tests of other packages)
// and returns a func that restores it.
func SetFreeBytesForTest(f func(string) (uint64, error)) (restore func()) {
	old := freeBytes
	freeBytes = f
	return func() { freeBytes = old }
}
