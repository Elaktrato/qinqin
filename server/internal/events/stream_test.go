package events_test

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"

	"qinqin/internal/events"
)

// TestStreamSinceEqualsMarshal: the streamed legacy answer is byte for
// byte the json.Marshal of Since's list, for empty, single, filtered and
// combined logs.
func TestStreamSinceEqualsMarshal(t *testing.T) {
	w := newPagingWorld(t)
	base := time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)
	w.seed(t, w.alice, w.zh, 25, base, nil)
	w.seed(t, w.alice, w.es, 1, base, nil)
	w.seed(t, w.bob, w.bobWS, 4, base, nil)
	empty := int64(0)
	for _, tc := range []struct {
		name  string
		user  int64
		since time.Time
		ws    *int64
	}{
		{"combined", w.alice, time.Time{}, nil},
		{"one workspace", w.alice, time.Time{}, &w.zh},
		{"single event", w.alice, time.Time{}, &w.es},
		{"since", w.alice, base.Add(3 * time.Second), &w.zh},
		{"after everything", w.alice, base.Add(time.Hour), nil},
		{"no such workspace rows", w.alice, time.Time{}, &empty},
		{"bob", w.bob, time.Time{}, nil},
	} {
		var buf bytes.Buffer
		if err := events.StreamSince(context.Background(), &buf, w.db, tc.user, tc.since, tc.ws); err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if want := legacy(t, w.db, tc.user, tc.since, tc.ws); buf.String() != want {
			t.Errorf("%s: streamed %s\nwant %s", tc.name, buf.String(), want)
		}
	}
}

type failingWriter struct{ after int }

var errWrite = errors.New("write failed")

func (f *failingWriter) Write(p []byte) (int, error) {
	if f.after <= 0 {
		return 0, errWrite
	}
	f.after--
	return len(p), nil
}

// TestStreamSinceStopsOnWriteError: a failed write ends the stream with
// that error (the client sees truncated JSON and retries).
func TestStreamSinceStopsOnWriteError(t *testing.T) {
	w := newPagingWorld(t)
	w.seed(t, w.alice, w.zh, 3000, time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC), nil)
	err := events.StreamSince(context.Background(), &failingWriter{after: 1}, w.db, w.alice, time.Time{}, nil)
	if !errors.Is(err, errWrite) {
		t.Errorf("err = %v, want the write error", err)
	}
}
