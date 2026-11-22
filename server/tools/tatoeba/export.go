package main

import (
	"archive/tar"
	"bufio"
	"compress/bzip2"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// archiveKind tells how a downloaded export file is read: a .tar.bz2
// holding the member, a bzip2-compressed file, or a plain file.
func archiveKind(file string) string {
	switch {
	case strings.HasSuffix(file, ".tar.bz2"):
		return "tar.bz2"
	case strings.HasSuffix(file, ".bz2"):
		return "bz2"
	}
	return "plain"
}

// openMember opens the archive's data file in dir: the member of a
// .tar.bz2 (matched by base name), the decompressed .bz2, or the file.
func openMember(dir string, a Archive) (io.ReadCloser, error) {
	f, err := os.Open(filepath.Join(dir, a.file()))
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", a.Name, err)
	}
	switch archiveKind(a.file()) {
	case "bz2":
		return readCloser{bzip2.NewReader(f), f}, nil
	case "tar.bz2":
		tr := tar.NewReader(bzip2.NewReader(f))
		for {
			h, err := tr.Next()
			if errors.Is(err, io.EOF) {
				f.Close()
				return nil, fmt.Errorf("open %s: %s holds no member %s", a.Name, a.file(), a.Member)
			}
			if err != nil {
				f.Close()
				return nil, fmt.Errorf("open %s: %w", a.Name, err)
			}
			if h.Typeflag == tar.TypeReg && path.Base(h.Name) == a.Member {
				return readCloser{tr, f}, nil
			}
		}
	}
	return f, nil
}

type readCloser struct {
	io.Reader
	io.Closer
}

// readRows reads tab-separated lines of exactly n columns, `\N` read as
// empty, and calls fn for each. Another column count is a format change
// of the export and fails: a new column could carry licence information.
func readRows(r io.Reader, what string, n int, fn func(cols []string) error) error {
	br := bufio.NewReaderSize(r, 1<<20)
	for line := 1; ; line++ {
		s, err := br.ReadString('\n')
		if s == "" && errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil && !errors.Is(err, io.EOF) {
			return fmt.Errorf("%s line %d: %w", what, line, err)
		}
		s = strings.TrimRight(s, "\r\n")
		if s != "" {
			cols := strings.Split(s, "\t")
			if len(cols) != n {
				return fmt.Errorf("%s line %d: %d columns, want %d; the export format changed: re-check the export's licence information and update the tool", what, line, len(cols), n)
			}
			for i, c := range cols {
				cols[i] = unescapeField(c)
			}
			if err := fn(cols); err != nil {
				return fmt.Errorf("%s line %d: %w", what, line, err)
			}
		}
		if errors.Is(err, io.EOF) {
			return nil
		}
	}
}

// unescapeField undoes the export's MySQL-style escaping: a whole field
// \N is NULL (empty); \0 \b \n \r \t \Z are NUL, backspace, line feed,
// carriage return, tab and Ctrl-Z; a backslash before any other character
// stands for that character (\\ is a backslash).
func unescapeField(s string) string {
	if s == `\N` {
		return ""
	}
	if !strings.Contains(s, `\`) {
		return s
	}
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] != '\\' || i == len(s)-1 {
			b.WriteByte(s[i])
			continue
		}
		i++
		switch s[i] {
		case '0':
			b.WriteByte(0)
		case 'b':
			b.WriteByte('\b')
		case 'n':
			b.WriteByte('\n')
		case 'r':
			b.WriteByte('\r')
		case 't':
			b.WriteByte('\t')
		case 'Z':
			b.WriteByte(0x1a)
		default:
			b.WriteByte(s[i])
		}
	}
	return b.String()
}
