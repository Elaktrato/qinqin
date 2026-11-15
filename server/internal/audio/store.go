package audio

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// MaxClipBytes is the largest clip a pack may carry.
const MaxClipBytes = 2 << 20

// BlobPath is where a clip lives: <store>/<sha[:2]>/<sha>.<ext>.
func BlobPath(storeDir, sha, ext string) string {
	return filepath.Join(storeDir, sha[:2], sha+"."+ext)
}

// ContentType is the media type served for a stored extension.
func ContentType(ext string) string {
	if ext == "mp3" {
		return "audio/mpeg"
	}
	return "audio/ogg"
}

// blobFault is a test hook: when set, writing a blob fails with its
// error after the temp file is written and before the rename.
var blobFault func() error

// hasMagic reports whether data starts like the container ext names.
func hasMagic(ext string, data []byte) bool {
	switch ext {
	case "opus", "ogg":
		return bytes.HasPrefix(data, []byte("OggS"))
	case "mp3":
		return bytes.HasPrefix(data, []byte("ID3")) || (len(data) >= 2 && data[0] == 0xFF && data[1]&0xE0 == 0xE0)
	}
	return false
}

// clipFile is a validated clip read from a pack directory.
type clipFile struct {
	path, sha, ext string
	size           int64
}

// inspect validates one pack file (regular, not a symlink, within the
// size cap, magic matching its extension) and hashes it.
func inspect(path, ext string) (clipFile, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return clipFile{}, err
	}
	if !info.Mode().IsRegular() {
		return clipFile{}, fmt.Errorf("not a regular file")
	}
	if info.Size() > MaxClipBytes {
		return clipFile{}, fmt.Errorf("%d bytes exceeds the %d byte limit", info.Size(), MaxClipBytes)
	}
	f, err := os.Open(path)
	if err != nil {
		return clipFile{}, err
	}
	defer f.Close()
	h := sha256.New()
	head := make([]byte, 4)
	n, err := io.ReadFull(io.TeeReader(f, h), head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return clipFile{}, err
	}
	if !hasMagic(ext, head[:n]) {
		return clipFile{}, fmt.Errorf("content does not look like .%s audio", ext)
	}
	if _, err := io.Copy(h, f); err != nil {
		return clipFile{}, err
	}
	return clipFile{path: path, sha: hex.EncodeToString(h.Sum(nil)), ext: ext, size: info.Size()}, nil
}

// storeBlob copies the clip into the store unless it is already there:
// written to a temp file in the target directory, then renamed.
func storeBlob(storeDir string, c clipFile) error {
	dst := BlobPath(storeDir, c.sha, c.ext)
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
	_, err = io.Copy(tmp, src)
	src.Close()
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil && blobFault != nil {
		err = blobFault()
	}
	if err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), dst)
}
