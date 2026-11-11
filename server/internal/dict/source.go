package dict

import (
	"archive/zip"
	"compress/gzip"
	"fmt"
	"io"
	"os"
)

// openMaybeGz opens path. When path is absent and path+".gz" exists, it
// opens that gzip file instead — the compressed form the upstream
// datasets ship in. Callers keep passing the plain filename they
// document; both layouts work.
func openMaybeGz(path string) (io.ReadCloser, error) {
	f, err := os.Open(path)
	if err == nil {
		return f, nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	gzPath := path + ".gz"
	gz, gzErr := os.Open(gzPath)
	if gzErr != nil {
		if os.IsNotExist(gzErr) {
			return nil, fmt.Errorf("neither %s nor %s exists: %w", path, gzPath, err)
		}
		return nil, gzErr
	}
	zr, zErr := gzip.NewReader(gz)
	if zErr != nil {
		gz.Close()
		return nil, fmt.Errorf("open %s: %w", gzPath, zErr)
	}
	return &multiCloser{Reader: zr, closers: []io.Closer{zr, gz}}, nil
}

// openZipMembers concatenates the named members of the zip at path, in
// order. Every member must exist; the archive and its member readers
// close with the returned closer.
func openZipMembers(path string, names ...string) (io.ReadCloser, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	readers := make([]io.Reader, 0, len(names))
	closers := []io.Closer{zr}
	for _, name := range names {
		rc, err := zr.Open(name)
		if err != nil {
			for _, c := range closers {
				c.Close()
			}
			return nil, fmt.Errorf("%s lacks member %s: %w", path, name, err)
		}
		readers = append(readers, rc)
		closers = append(closers, rc)
	}
	return &multiCloser{Reader: io.MultiReader(readers...), closers: closers}, nil
}

// multiCloser closes its closers in reverse order, reporting the first
// error.
type multiCloser struct {
	io.Reader
	closers []io.Closer
}

func (m *multiCloser) Close() error {
	var first error
	for i := len(m.closers) - 1; i >= 0; i-- {
		if err := m.closers[i].Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}
