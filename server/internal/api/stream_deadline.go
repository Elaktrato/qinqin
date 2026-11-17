package api

import (
	"io"
	"time"
)

// legacyPullWindow is how long one write of the legacy streaming pull may
// block: a client that reads nothing for that long is cut, so the SQLite
// read transaction behind the stream does not stay open.
const legacyPullWindow = 60 * time.Second

// writeDeadliner is http.ResponseController's deadline setter.
type writeDeadliner interface {
	SetWriteDeadline(time.Time) error
}

// deadlineWriter moves the connection's write deadline forward as rows go
// out: the deadline is window ahead of the last refresh, and a write
// refreshes it once a sixth of the window has passed (not on every row). A
// writer without deadline support (a test recorder) is written to as is.
type deadlineWriter struct {
	w       io.Writer
	dl      writeDeadliner
	window  time.Duration
	now     func() time.Time
	last    time.Time
	stopped bool
}

func newDeadlineWriter(w io.Writer, dl writeDeadliner, window time.Duration, now func() time.Time) *deadlineWriter {
	d := &deadlineWriter{w: w, dl: dl, window: window, now: now}
	d.refresh(now())
	return d
}

func (d *deadlineWriter) refresh(t time.Time) {
	if d.stopped {
		return
	}
	if err := d.dl.SetWriteDeadline(t.Add(d.window)); err != nil {
		d.stopped = true // not supported: nothing to move
		return
	}
	d.last = t
}

func (d *deadlineWriter) Write(p []byte) (int, error) {
	if t := d.now(); !d.stopped && t.Sub(d.last) >= d.window/6 {
		d.refresh(t)
	}
	return d.w.Write(p)
}
