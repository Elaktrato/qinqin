package api_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"qinqin/internal/api"
	"qinqin/internal/datapkg"
	"qinqin/internal/dbtest"
)

// TestAdminPackChangesKickPackageBuilds: an admin install, the generic
// uninstall and a legacy per-type uninstall each rebuild or tombstone the
// affected packages (WithPackages).
func TestAdminPackChangesKickPackageBuilds(t *testing.T) {
	ctx := context.Background()
	e := &packEnv{now: time.Now(), done: make(chan string, 8), dataDir: t.TempDir()}
	sqlDB := dbtest.Open(t)
	e.db = sqlDB
	b := datapkg.NewBuilder(datapkg.Registry{DB: sqlDB, Dir: filepath.Join(e.dataDir, "packages"), AudioDir: filepath.Join(e.dataDir, "audio")}, t.Logf)
	rctx, cancel := context.WithCancel(ctx)
	t.Cleanup(cancel)
	go b.Run(rctx)
	e.ts = httptest.NewServer(api.New(sqlDB, e.dataDir, nil, api.WithImportDone(e.done), api.WithPackages(b)))
	t.Cleanup(e.ts.Close)
	e.admin = registerUser(t, e.ts.URL, "admin", "")

	state := func(id string) string {
		t.Helper()
		wctx, wcancel := context.WithTimeout(ctx, time.Minute)
		defer wcancel()
		if err := b.Wait(wctx); err != nil {
			t.Fatal(err)
		}
		cat, err := b.Registry().Catalogue(ctx, []string{datapkg.AllLanguages}, true)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range cat.Packages {
			if r.ID == id {
				return r.State
			}
		}
		return "absent"
	}

	s := stageZip(t, e, esPackZip(t, packTestDictManifest))
	if code, text := e.install(t, s.Token, "CC0-1.0"); code != http.StatusAccepted {
		t.Fatalf("install = %d %q", code, text)
	}
	e.waitDone(t, 1)
	if got := state("lexicon.es"); got != "ready" {
		t.Fatalf("lexicon.es after an admin install: %s, want ready", got)
	}

	installTestPacks(t, sqlDB) // es-sent without the hook
	b.KickReconcile()
	if got := state("sentences.es-sent"); got != "ready" {
		t.Fatalf("sentences.es-sent after reconcile: %s", got)
	}
	resp := doJSON(t, http.MethodDelete, e.ts.URL, "/api/admin/sentences/es-sent", e.admin, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("legacy sentence uninstall = %d", resp.StatusCode)
	}
	if got := state("sentences.es-sent"); got != "deleted" {
		t.Fatalf("sentences.es-sent after the legacy uninstall: %s, want deleted", got)
	}

	resp = doJSON(t, http.MethodDelete, e.ts.URL, "/api/admin/packs/dictionary/es-test", e.admin, nil)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("uninstall = %d", resp.StatusCode)
	}
	if got := state("lexicon.es"); got != "deleted" {
		t.Fatalf("lexicon.es after the uninstall: %s, want deleted", got)
	}
}
