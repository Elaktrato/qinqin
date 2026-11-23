package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"qinqin/internal/db"
)

// syncBuffer is a log destination the server goroutines and the test share.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// captureLog sends the standard logger to a buffer for the test.
func captureLog(t *testing.T) *syncBuffer {
	t.Helper()
	buf := &syncBuffer{}
	prev, flags := log.Writer(), log.Flags()
	log.SetOutput(buf)
	log.SetFlags(0)
	t.Cleanup(func() { log.SetOutput(prev); log.SetFlags(flags) })
	return buf
}

// quietServeEnv keeps serve from seeding or scanning the repository's packs.
func quietServeEnv(t *testing.T) {
	t.Setenv("QINQIN_AUTO_SEED", "0")
	t.Setenv("QINQIN_PACKS", t.TempDir())
	t.Setenv("QINQIN_TESSERACT", "qinqin-no-such-tesseract")
}

// serve stops cleanly when its context ends (SIGINT/SIGTERM in serveCmd):
// it stops listening, stops the background workers, closes the database and
// returns nil, logging each step (#170).
func TestServeShutsDownOnCancelledContext(t *testing.T) {
	quietServeEnv(t)
	logs := captureLog(t)
	data := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	addrCh := make(chan string, 1)
	listen := func() (net.Listener, error) {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err == nil {
			addrCh <- ln.Addr().String()
		}
		return ln, err
	}
	done := make(chan error, 1)
	go func() { done <- serve(ctx, data, listen) }()

	var addr string
	select {
	case addr = <-addrCh:
	case err := <-done:
		t.Fatalf("serve returned before listening: %v", err)
	case <-time.After(60 * time.Second):
		t.Fatal("serve did not listen")
	}
	resp, err := http.Get("http://" + addr + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("healthz = %d", resp.StatusCode)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("serve = %v, want nil on a cancelled context", err)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("serve did not return after the context ended")
	}
	if c, err := net.DialTimeout("tcp", addr, time.Second); err == nil {
		c.Close()
		t.Error("still listening after serve returned")
	}
	out := logs.String()
	steps := []string{"shutting down", "http server stopped", "mail queue stopped", "package builder stopped", "background jobs stopped", "shutdown complete"}
	last := -1
	for _, s := range steps {
		i := strings.Index(out, s)
		if i < 0 {
			t.Fatalf("log lacks %q:\n%s", s, out)
		}
		if i < last {
			t.Errorf("log step %q out of order:\n%s", s, out)
		}
		last = i
	}
	// The database was closed: another handle opens and writes at once.
	sqlDB, err := db.Open(filepath.Join(data, "qinqin.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	if _, err := sqlDB.Exec(`INSERT INTO server_meta (key, value) VALUES ('shutdown-test', 'x')`); err != nil {
		t.Fatal(err)
	}
}

// A signal during startup (before the listener) ends serve without ever
// listening.
func TestServeCancelledBeforeListeningNeverListens(t *testing.T) {
	quietServeEnv(t)
	captureLog(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	listened := false
	err := serve(ctx, t.TempDir(), func() (net.Listener, error) {
		listened = true
		return net.Listen("tcp", "127.0.0.1:0")
	})
	if err != nil {
		t.Fatalf("serve = %v, want nil", err)
	}
	if listened {
		t.Error("serve listened although its context had ended")
	}
}

// runHTTP lets a request in flight finish when the context ends, and
// closes what is still running once the grace period is over.
func TestRunHTTPDrainsThenCloses(t *testing.T) {
	release := make(chan struct{})
	mux := http.NewServeMux()
	mux.HandleFunc("/slow", func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
		io.WriteString(w, "done")
	})
	mux.HandleFunc("/stuck", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		<-release
	})
	defer close(release)

	for _, tc := range []struct {
		path    string
		grace   time.Duration
		wantErr bool
	}{{"/slow", 5 * time.Second, false}, {"/stuck", 200 * time.Millisecond, true}} {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		var logs syncBuffer
		logf := func(f string, a ...any) { log.New(&logs, "", 0).Printf(f, a...) }
		done := make(chan error, 1)
		go func() { done <- runHTTP(ctx, newHTTPServer(mux), ln, tc.grace, logf) }()

		got := make(chan string, 1)
		go func() {
			resp, err := http.Get("http://" + ln.Addr().String() + tc.path)
			if err != nil {
				got <- "error: " + err.Error()
				return
			}
			b, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil {
				got <- "cut: " + string(b)
				return
			}
			got <- string(b)
		}()
		time.Sleep(100 * time.Millisecond) // the request is in flight
		start := time.Now()
		cancel()
		select {
		case err := <-done:
			if (err != nil) != tc.wantErr {
				t.Errorf("%s: runHTTP = %v", tc.path, err)
			}
		case <-time.After(10 * time.Second):
			t.Fatalf("%s: runHTTP did not return", tc.path)
		}
		body := <-got
		switch tc.path {
		case "/slow":
			if body != "done" {
				t.Errorf("in-flight request got %q, want it to finish", body)
			}
		case "/stuck":
			if body == "done" || time.Since(start) > 5*time.Second {
				t.Errorf("stuck request: %q after %v", body, time.Since(start))
			}
			if !strings.Contains(logs.String(), "closing") {
				t.Errorf("log lacks the forced close: %q", logs.String())
			}
		}
	}
}

// waitStep waits for done until the deadline and says which step timed out.
func TestWaitStepBoundedByDeadline(t *testing.T) {
	var logs []string
	logf := func(f string, a ...any) { logs = append(logs, fmt.Sprintf(f, a...)) }
	never := make(chan struct{})
	deadline := time.Now().Add(100 * time.Millisecond)
	start := time.Now()
	waitStep("package builder", never, deadline, logf)
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("waited %v", d)
	}
	closed := make(chan struct{})
	close(closed)
	waitStep("mail queue", closed, deadline, logf)
	if len(logs) != 2 || !strings.Contains(logs[0], "did not stop") || !strings.Contains(logs[1], "stopped") {
		t.Errorf("logs %q", logs)
	}
}
