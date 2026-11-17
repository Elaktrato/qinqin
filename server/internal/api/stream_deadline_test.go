package api

import (
	"bytes"
	"errors"
	"testing"
	"time"
)

type fakeDeadlines struct {
	set []time.Time
	err error
}

func (f *fakeDeadlines) SetWriteDeadline(t time.Time) error {
	f.set = append(f.set, t)
	return f.err
}

// The legacy pull's writer moves the connection's write deadline forward
// as rows go out: a client that stops reading is cut one window after the
// last refresh, so its read transaction does not stay open.
func TestDeadlineWriterRefreshesAsRowsGoOut(t *testing.T) {
	now := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	clock := func() time.Time { return now }
	var buf bytes.Buffer
	fd := &fakeDeadlines{}
	w := newDeadlineWriter(&buf, fd, time.Minute, clock)
	if len(fd.set) != 1 || !fd.set[0].Equal(now.Add(time.Minute)) {
		t.Fatalf("initial deadline %v, want now + 1 min", fd.set)
	}
	for range 3 {
		if _, err := w.Write([]byte("x")); err != nil {
			t.Fatal(err)
		}
	}
	if len(fd.set) != 1 {
		t.Fatalf("rows within the same moment refreshed the deadline: %v", fd.set)
	}
	now = now.Add(20 * time.Second)
	w.Write([]byte("y"))
	if len(fd.set) != 2 || !fd.set[1].Equal(now.Add(time.Minute)) {
		t.Fatalf("after 20 s: deadlines %v, want a refresh to now + 1 min", fd.set)
	}
	if buf.String() != "xxxy" {
		t.Fatalf("wrote %q", buf.String())
	}

	// A writer without deadline support (a recorder) still writes.
	buf.Reset()
	fd = &fakeDeadlines{err: errors.New("not supported")}
	w = newDeadlineWriter(&buf, fd, time.Minute, clock)
	now = now.Add(time.Hour)
	if _, err := w.Write([]byte("z")); err != nil || buf.String() != "z" {
		t.Fatalf("unsupported deadlines: %v %q", err, buf.String())
	}
	if len(fd.set) != 1 {
		t.Fatalf("kept trying an unsupported deadline: %v", fd.set)
	}
}
