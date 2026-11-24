package pack_test

import (
	"errors"
	"io"
	"strings"
	"testing"
	"testing/iotest"
	"time"

	"qinqin/internal/pack"
)

func TestNowIsAnRFC3339UTCSecond(t *testing.T) {
	got := pack.Now()
	at, err := time.Parse(time.RFC3339, got)
	if err != nil || !strings.HasSuffix(got, "Z") || at.Nanosecond() != 0 {
		t.Errorf("Now() = %q (%v)", got, err)
	}
}

func TestPlaceholders(t *testing.T) {
	for n, want := range map[int]string{1: "?", 3: "?, ?, ?"} {
		if got := pack.Placeholders(n); got != want {
			t.Errorf("Placeholders(%d) = %q, want %q", n, got, want)
		}
	}
	if got := pack.Tuples(2, 3); got != "(?, ?, ?), (?, ?, ?)" {
		t.Errorf("Tuples(2, 3) = %q", got)
	}
	if got := pack.Tuples(1, 1); got != "(?)" {
		t.Errorf("Tuples(1, 1) = %q", got)
	}
}

// countingReader counts the bytes read from it.
type countingReader struct {
	r io.Reader
	n int
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += n
	return n, err
}

func TestReadCapped(t *testing.T) {
	if got, err := pack.ReadCapped(strings.NewReader("abcd"), 4); err != nil || string(got) != "abcd" {
		t.Errorf("at the cap: %q, %v", got, err)
	}
	r := &countingReader{r: strings.NewReader(strings.Repeat("x", 1000))}
	if _, err := pack.ReadCapped(r, 4); !errors.Is(err, pack.ErrTooLarge) {
		t.Errorf("over the cap: %v", err)
	}
	if r.n > 5 {
		t.Errorf("read %d bytes of a reader capped at 4", r.n)
	}
	boom := errors.New("boom")
	if _, err := pack.ReadCapped(iotest.ErrReader(boom), 4); !errors.Is(err, boom) {
		t.Errorf("read error: %v", err)
	}
}
