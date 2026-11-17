package fonts

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// magic starts every WOFF2 file.
var magic = []byte("wOF2")

// BlobPath is where a slice lives: <store>/<sha[:2]>/<sha>.woff2.
func BlobPath(storeDir, sha string) string {
	return filepath.Join(storeDir, sha[:2], sha+".woff2")
}

// sliceFile is a validated slice read from a pack directory.
type sliceFile struct {
	path, sha string
	size      int64
}

// inspect validates one slice file of a pack: a regular file (not a
// symlink), at most MaxSliceBytes, starting with wOF2, whose sha256 is the
// one its name states.
func inspect(path, sha string) (sliceFile, error) {
	info, err := os.Lstat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return sliceFile{}, errors.New("no such file")
		}
		return sliceFile{}, err
	}
	if !info.Mode().IsRegular() {
		return sliceFile{}, errors.New("not a regular file")
	}
	if info.Size() > MaxSliceBytes {
		return sliceFile{}, fmt.Errorf("%d bytes exceeds the %d byte limit", info.Size(), MaxSliceBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return sliceFile{}, err
	}
	if !bytes.HasPrefix(data, magic) {
		return sliceFile{}, errors.New("does not start with wOF2 (not a WOFF2 font)")
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != sha {
		return sliceFile{}, errors.New("its sha256 does not match its name")
	}
	return sliceFile{path: path, sha: sha, size: info.Size()}, nil
}

// storeBlob copies the slice into the store unless it is already there:
// written to a temp file in the target directory, checked again (the pack
// file may have changed since inspect), then renamed.
func storeBlob(storeDir string, c sliceFile) error {
	dst := BlobPath(storeDir, c.sha)
	if _, err := os.Stat(dst); err == nil {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".tmp-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // a no-op once renamed
	src, err := os.Open(c.path)
	if err != nil {
		tmp.Close()
		return err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(src, MaxSliceBytes+1))
	src.Close()
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil && (n != c.size || hex.EncodeToString(h.Sum(nil)) != c.sha) {
		err = fmt.Errorf("%s changed while importing", c.path)
	}
	if err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), dst)
}
