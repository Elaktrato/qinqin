package api_test

import (
	"bytes"
	"context"
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/pack"
)

// The API's background goroutines (the stage sweeper here; staged pack
// imports and restores the same way) are counted in the group handed to
// WithBackgroundGroup, so serve can wait for them before closing the
// database (#170).
func TestBackgroundGroupCountsTheSweeper(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var jobs api.Jobs
	newPackEnv(t, api.WithStageSweeper(ctx, 10*time.Millisecond), api.WithBackgroundGroup(&jobs))
	done := make(chan struct{})
	go func() { jobs.Wait(); close(done) }()
	select {
	case <-done:
		t.Fatal("the group was empty while the sweeper runs")
	case <-time.After(100 * time.Millisecond):
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the sweeper did not leave the group after its context ended")
	}
}

// A staged pack import is counted in the background group while it runs,
// and the server's shutdown (its background context ending) cancels it: the
// job ends, reports a failure and leaves the group (#170).
func TestStagedImportIsCountedAndCancelledByShutdown(t *testing.T) {
	bg, cancel := context.WithCancel(context.Background())
	defer cancel()
	var jobs api.Jobs
	started := make(chan struct{}, 1)
	importer := func(ctx context.Context, _ *sql.DB, _ pack.Pack) (string, error) {
		started <- struct{}{}
		<-ctx.Done()
		return "", ctx.Err()
	}
	e := newPackEnv(t, api.WithStageSweeper(bg, time.Hour), api.WithBackgroundGroup(&jobs), api.WithImporter(importer))
	s := stageZip(t, e, esPackZip(t, packTestDictManifest))
	if code, body := e.install(t, s.Token, "CC0-1.0"); code != http.StatusAccepted {
		t.Fatalf("install = %d %s", code, body)
	}
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("import did not start")
	}
	done := make(chan struct{})
	go func() { jobs.Wait(); close(done) }()
	select {
	case <-done:
		t.Fatal("the group did not count the running import")
	case <-time.After(100 * time.Millisecond):
	}
	cancel()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("the import ignored the shutdown")
	}
	e.waitDone(t, 1)
	if _, st := e.status(t, s.Token); st.Status != "failed" {
		t.Errorf("status %+v, want failed", st)
	}
}

// Every goroutine of the API goes through goBackground, so the group counts
// it (the restore and validation jobs too): no bare go statement elsewhere.
func TestNoBareGoroutinesInTheAPI(t *testing.T) {
	files, _ := filepath.Glob("*.go")
	bare := regexp.MustCompile(`(?m)^\s*go\s+[A-Za-z_(]`)
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, loc := range bare.FindAllIndex(src, -1) {
			line := 1 + bytes.Count(src[:loc[0]], []byte("\n"))
			if f == "api.go" && strings.Contains(string(src[loc[0]:loc[1]+30]), "go fn()") || f == "api.go" && strings.Contains(string(src[loc[0]:loc[1]+30]), "go func() {") {
				continue // goBackground itself
			}
			t.Errorf("%s:%d starts a goroutine outside goBackground", f, line)
		}
	}
}

// Once serve has started waiting for the jobs, a handler still running
// (after a forced close) cannot start a new one: it is refused, not lost
// in a group nobody waits for any more.
func TestClosedJobsRefuseNewJobs(t *testing.T) {
	var jobs api.Jobs
	called := make(chan struct{}, 1)
	importer := func(ctx context.Context, _ *sql.DB, _ pack.Pack) (string, error) {
		called <- struct{}{}
		return "", nil
	}
	e := newPackEnv(t, api.WithBackgroundGroup(&jobs), api.WithImporter(importer))
	s := stageZip(t, e, esPackZip(t, packTestDictManifest))
	jobs.Wait() // nothing runs: returns at once and closes the group
	if code, body := e.install(t, s.Token, "CC0-1.0"); code != http.StatusAccepted {
		t.Fatalf("install = %d %s", code, body)
	}
	select {
	case <-called:
		t.Fatal("a job started after the group was closed")
	case <-time.After(200 * time.Millisecond):
	}
}
