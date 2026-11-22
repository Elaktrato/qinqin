package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

// exportServer serves the fixture archives over TLS with a Last-Modified
// date, counting requests; override replaces one file's bytes.
type exportServer struct {
	srv      *httptest.Server
	hits     atomic.Int32
	override map[string][]byte
}

func newExportServer(t *testing.T) *exportServer {
	t.Helper()
	es := &exportServer{override: map[string][]byte{}}
	es.srv = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		es.hits.Add(1)
		name := filepath.Base(r.URL.Path)
		data, ok := es.override[name]
		if !ok {
			var err error
			if data, err = os.ReadFile(filepath.Join(fixtureExport, name)); err != nil {
				http.NotFound(w, r)
				return
			}
		}
		w.Header().Set("Last-Modified", "Sun, 02 Jan 2000 00:00:00 GMT")
		w.Write(data)
	}))
	t.Cleanup(es.srv.Close)
	old := httpClient
	httpClient = es.srv.Client()
	t.Cleanup(func() { httpClient = old })
	return es
}

// servedPin writes the fixture pin with its URLs on the test server, and
// without hashes and dates unless pinned.
func servedPin(t *testing.T, es *exportServer, dir string, pinned bool) string {
	t.Helper()
	p, err := loadPin(fixturePin)
	if err != nil {
		t.Fatal(err)
	}
	for i, a := range p.Archives {
		p.Archives[i].URL = es.srv.URL + "/exports/" + a.file()
		if !pinned {
			p.Archives[i].SHA256 = ""
		}
	}
	if !pinned {
		p.ExportDate, p.Licence.Checked = "", ""
	}
	path := filepath.Join(dir, "pin.json")
	if err := p.save(path); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestPinDownloadsAndRecords(t *testing.T) {
	es := newExportServer(t)
	dir := t.TempDir()
	pinPath := servedPin(t, es, dir, false)
	export := filepath.Join(dir, "export")
	var out bytes.Buffer
	args := []string{"--pin", pinPath, "--export", export}
	if err := run(context.Background(), append([]string{"pin"}, args...), &out); err == nil || !strings.Contains(err.Error(), "licence-checked") {
		t.Fatalf("pin without --licence-checked = %v, want a refusal", err)
	}
	// The shipped placeholder statement is refused before any download.
	placeholder, _ := loadPin(pinPath)
	placeholder.Licence.Statement = "To fill at pin time: what the pages say."
	phPath := filepath.Join(dir, "placeholder.json")
	if err := placeholder.save(phPath); err != nil {
		t.Fatal(err)
	}
	err := run(context.Background(), []string{"pin", "--licence-checked", "2000-01-03", "--pin", phPath, "--export", export}, &out)
	if err == nil || !strings.Contains(err.Error(), "statement") || es.hits.Load() != 0 {
		t.Fatalf("pin with the placeholder statement = %v after %d downloads; want a refusal before any", err, es.hits.Load())
	}
	if err := run(context.Background(), append([]string{"pin", "--licence-checked", "2000-01-03"}, args...), &out); err != nil {
		t.Fatalf("pin: %v", err)
	}
	got, err := loadPin(pinPath)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := loadPin(fixturePin)
	for i, a := range got.Archives {
		if a.SHA256 != want.Archives[i].SHA256 {
			t.Errorf("%s pinned %s, want %s", a.Name, a.SHA256, want.Archives[i].SHA256)
		}
		if _, err := os.Stat(filepath.Join(export, a.file())); err != nil {
			t.Errorf("%s not kept in the export folder: %v", a.Name, err)
		}
	}
	if got.ExportDate != "2000-01-02" || got.Licence.Checked != "2000-01-03" {
		t.Errorf("dates: export %q, licence %q", got.ExportDate, got.Licence.Checked)
	}

	// Upstream moved on: a new export is not pinned over the old one
	// without --repin.
	es.override["tags.tar.bz2"] = []byte("a newer export")
	err = run(context.Background(), append([]string{"pin", "--licence-checked", "2000-02-01"}, args...), &out)
	if err == nil || !strings.Contains(err.Error(), "--repin") {
		t.Fatalf("pin of a changed export = %v, want a refusal naming --repin", err)
	}
	if again, _ := loadPin(pinPath); again.Archives[3].SHA256 != want.Archives[3].SHA256 {
		t.Error("a refused pin changed pin.json")
	}
	if err := (Archive{Name: "tags", URL: "https://x/tags.tar.bz2", SHA256: want.Archives[3].SHA256}).verify(export); err != nil {
		t.Errorf("a refused pin replaced the kept archive: %v", err)
	}
}

func TestBuildCommand(t *testing.T) {
	es := newExportServer(t)
	dir := t.TempDir()
	export, out := filepath.Join(dir, "export"), filepath.Join(dir, "out")
	base := []string{"build", "--root", ".", "--rules", fixtureRules, "--export", export, "--out", out, "--reports", filepath.Join(dir, "reports")}
	var log bytes.Buffer

	// Unpinned: refused before anything is downloaded.
	unpinned := servedPin(t, es, t.TempDir(), false)
	err := run(context.Background(), append(base, "--pin", unpinned), &log)
	if err == nil || !strings.Contains(err.Error(), "pin") || es.hits.Load() != 0 {
		t.Fatalf("unpinned build = %v after %d downloads; want a refusal before any", err, es.hits.Load())
	}

	// Pinned: the missing archives are downloaded, verified and built.
	pinned := servedPin(t, es, t.TempDir(), true)
	if err := run(context.Background(), append(base, "--pin", pinned), &log); err != nil {
		t.Fatalf("build: %v\n%s", err, log.String())
	}
	if got, want := readTree(t, out), readTree(t, goldenDir); !mapsEqual(got, want) {
		t.Error("the build command did not write the golden packs")
	}
	hits := es.hits.Load()
	// A second build uses the kept archives.
	if err := run(context.Background(), append(base, "--pin", pinned, "--lang", "zh"), &log); err != nil || es.hits.Load() != hits {
		t.Errorf("rebuild: %v, %d new downloads", err, es.hits.Load()-hits)
	}

	// A missing archive that downloads with another hash is refused and
	// not kept (no file, no part file).
	if err := os.Remove(filepath.Join(export, "tags.tar.bz2")); err != nil {
		t.Fatal(err)
	}
	es.override["tags.tar.bz2"] = []byte("a newer export")
	err = run(context.Background(), append(base, "--pin", pinned), &log)
	if err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Errorf("build fetching a changed archive = %v, want a SHA-256 refusal", err)
	}
	for _, f := range []string{"tags.tar.bz2", "tags.tar.bz2.part"} {
		if _, err := os.Stat(filepath.Join(export, f)); !os.IsNotExist(err) {
			t.Errorf("%s kept after a refused download", f)
		}
	}
	delete(es.override, "tags.tar.bz2")

	// An archive that is not the pinned one stops the build; nothing changes.
	if err := os.WriteFile(filepath.Join(export, "tags.tar.bz2"), []byte("tampered"), 0o644); err != nil {
		t.Fatal(err)
	}
	os.RemoveAll(out)
	err = run(context.Background(), append(base, "--pin", pinned), &log)
	if err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Errorf("build with a tampered archive = %v, want a SHA-256 refusal", err)
	}
	if _, err := os.Stat(out); !os.IsNotExist(err) {
		t.Error("a refused build wrote packs")
	}
}

func TestUsage(t *testing.T) {
	var out bytes.Buffer
	if err := run(context.Background(), nil, &out); err == nil {
		t.Error("no command accepted")
	}
	if err := run(context.Background(), []string{"bake"}, &out); err == nil {
		t.Error("unknown command accepted")
	}
}
