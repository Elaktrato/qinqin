package dict

import (
	"errors"
	"strings"
	"testing"
)

type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, errors.New("no space left on device") }

type failingReader struct{}

func (failingReader) Read([]byte) (int, error) { return 0, errors.New("flate: corrupt input") }

// A write that fails (a full disk) is the server's problem, not the pack's:
// it must not read as ErrInvalidPack (which the API answers 400
// pack_invalid). A read that fails is a damaged zip: the pack's.
func TestCopyEntryBlamesThePackOnlyForReads(t *testing.T) {
	if _, err := copyEntry(failingWriter{}, strings.NewReader("data"), "a.txt", 100); err == nil || errors.Is(err, ErrInvalidPack) {
		t.Errorf("write failure = %v, want an error that is not ErrInvalidPack", err)
	}
	if _, err := copyEntry(&strings.Builder{}, failingReader{}, "a.txt", 100); !errors.Is(err, ErrInvalidPack) {
		t.Errorf("read failure = %v, want ErrInvalidPack", err)
	}
	if _, err := copyEntry(&strings.Builder{}, strings.NewReader("too long"), "a.txt", 3); !errors.Is(err, ErrInvalidPack) {
		t.Errorf("over the limit = %v, want ErrInvalidPack", err)
	}
	var b strings.Builder
	if n, err := copyEntry(&b, strings.NewReader("ok"), "a.txt", 3); err != nil || n != 2 || b.String() != "ok" {
		t.Errorf("copy = %d %v %q", n, err, b.String())
	}
}
