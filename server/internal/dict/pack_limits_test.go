package dict

import (
	"archive/zip"
	"bytes"
	"errors"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type zipEntry struct {
	name string
	body []byte
	mode os.FileMode
}

func makeZip(t *testing.T, entries ...zipEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		h := &zip.FileHeader{Name: e.name, Method: zip.Deflate}
		if e.mode != 0 {
			h.SetMode(e.mode)
		}
		w, err := zw.CreateHeader(h)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(e.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func extract(t *testing.T, data []byte, lim ZipLimits) error {
	t.Helper()
	return ExtractZipAt(bytes.NewReader(data), int64(len(data)), t.TempDir(), lim)
}

func TestExtractZipAtRejectsTooManyFiles(t *testing.T) {
	data := makeZip(t, zipEntry{name: "a", body: []byte("1")}, zipEntry{name: "b", body: []byte("1")},
		zipEntry{name: "c", body: []byte("1")}, zipEntry{name: "d", body: []byte("1")})
	err := extract(t, data, ZipLimits{MaxFiles: 3, MaxBytes: 1 << 20})
	if !errors.Is(err, ErrInvalidPack) || !strings.Contains(err.Error(), "more than 3 files") {
		t.Fatalf("err = %v", err)
	}
}

func TestExtractZipAtStopsAtWrittenLimit(t *testing.T) {
	zeros := make([]byte, 2<<20)
	data := makeZip(t, zipEntry{name: "big", body: zeros})
	lim := ZipLimits{MaxFiles: 10, MaxBytes: 1 << 20}
	err := extract(t, data, lim)
	if !errors.Is(err, ErrInvalidPack) || !strings.Contains(err.Error(), "more than") {
		t.Fatalf("err = %v", err)
	}

	// Lying header: declared size 10, real content 2 MiB.
	var raw bytes.Buffer
	var comp bytes.Buffer
	cw := zip.NewWriter(&comp)
	w, _ := cw.CreateHeader(&zip.FileHeader{Name: "big", Method: zip.Deflate})
	w.Write(zeros)
	cw.Close()
	// Take the deflated stream out of a genuine archive.
	zr, _ := zip.NewReader(bytes.NewReader(comp.Bytes()), int64(comp.Len()))
	rc, _ := zr.File[0].OpenRaw()
	var deflated bytes.Buffer
	deflated.ReadFrom(rc)
	zw := zip.NewWriter(&raw)
	hdr := &zip.FileHeader{Name: "big", Method: zip.Deflate, CRC32: crc32.ChecksumIEEE(zeros),
		CompressedSize64: uint64(deflated.Len()), UncompressedSize64: 10}
	rw, err := zw.CreateRaw(hdr)
	if err != nil {
		t.Fatal(err)
	}
	rw.Write(deflated.Bytes())
	zw.Close()
	err = extract(t, raw.Bytes(), lim)
	// Go's reader itself rejects an entry that outgrows its declared size;
	// either way the cap holds and the error is an invalid pack.
	if !errors.Is(err, ErrInvalidPack) {
		t.Fatalf("lying header err = %v", err)
	}
}

func TestExtractZipAtKeepsTraversalRules(t *testing.T) {
	lim := DefaultZipLimits
	for _, e := range []zipEntry{
		{name: "../x", body: []byte("x")},
		{name: "/abs", body: []byte("x")},
		{name: "link", body: []byte("target"), mode: os.ModeSymlink | 0o777},
	} {
		err := extract(t, makeZip(t, e), lim)
		if !errors.Is(err, ErrInvalidPack) {
			t.Errorf("%s: err = %v", e.name, err)
		}
	}
}

func TestPackRootUnwrapsSingleFolder(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "es-demo"), 0o755)
	os.WriteFile(filepath.Join(dir, "es-demo", "manifest.json"), []byte("{}"), 0o644)
	got, err := PackRoot(dir)
	if err != nil || got != filepath.Join(dir, "es-demo") {
		t.Fatalf("got %q, %v", got, err)
	}

	two := t.TempDir()
	for _, n := range []string{"a", "b"} {
		os.MkdirAll(filepath.Join(two, n), 0o755)
		os.WriteFile(filepath.Join(two, n, "manifest.json"), []byte("{}"), 0o644)
	}
	_, err = PackRoot(two)
	if !errors.Is(err, ErrInvalidPack) || !strings.Contains(err.Error(), "manifest.json not found at the top of the zip") {
		t.Fatalf("two folders err = %v", err)
	}

	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "manifest.json"), []byte("{}"), 0o644)
	got, err = PackRoot(root)
	if err != nil || got != root {
		t.Fatalf("root got %q, %v", got, err)
	}
}

// zeros reads n zero bytes.
type zeros struct{ n int64 }

func (z *zeros) Read(p []byte) (int, error) {
	if z.n <= 0 {
		return 0, io.EOF
	}
	if int64(len(p)) > z.n {
		p = p[:z.n]
	}
	z.n -= int64(len(p))
	return len(p), nil
}

func TestExtractZipCapsTheArchiveItReads(t *testing.T) {
	old := DefaultZipLimits
	t.Cleanup(func() { DefaultZipLimits = old })
	DefaultZipLimits = ZipLimits{MaxFiles: 10, MaxBytes: 1 << 20}
	err := ExtractZip(&zeros{n: 4 << 20}, t.TempDir())
	if !errors.Is(err, ErrInvalidPack) || !strings.Contains(err.Error(), "larger than") {
		t.Fatalf("err = %v, want ErrInvalidPack saying the archive is larger than the limit", err)
	}
}
