package pack

import (
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

// The small helpers every pack type's importer used to copy (#192).

// Now is the stamp a registry or data row is written with: the current
// time in UTC, RFC 3339, to the second.
func Now() string { return time.Now().UTC().Format(time.RFC3339) }

// Placeholders returns n SQL parameter placeholders, "?, ?, ?" (n >= 1),
// for an IN list.
func Placeholders(n int) string { return strings.TrimSuffix(strings.Repeat("?, ", n), ", ") }

// Tuples returns rows parenthesised groups of cols placeholders,
// "(?, ?), (?, ?)", for a multi-row INSERT.
func Tuples(rows, cols int) string {
	return strings.TrimSuffix(strings.Repeat("("+Placeholders(cols)+"), ", rows), ", ")
}

// ErrTooLarge reports a file longer than ReadCapped's limit.
var ErrTooLarge = errors.New("pack: file too large")

// ReadCapped reads all of r, which may hold at most max bytes: a longer r
// is ErrTooLarge, and at most max+1 bytes are read from it.
func ReadCapped(r io.Reader, max int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > max {
		return nil, fmt.Errorf("%w: more than %d bytes", ErrTooLarge, max)
	}
	return data, nil
}
