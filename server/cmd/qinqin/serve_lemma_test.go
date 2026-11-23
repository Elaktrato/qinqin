package main

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/lemma"
	"qinqin/internal/packs"
)

// serve uses a rule-table pack installed before it started, and picks up a
// table another process (qinqin seed) changed while it runs (#176).
func TestServeUsesInstalledAndOutsideChangedTables(t *testing.T) {
	quietServeEnv(t)
	captureLog(t)
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	defer func(d time.Duration) { lemmaWatchEvery = d }(lemmaWatchEvery)
	registerLanguages()
	data := t.TempDir()
	ctx := context.Background()
	sqlDB, err := db.Open(filepath.Join(data, "qinqin.db"))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"id":"xh-dict","name":"Xh","version":"1","type":"dictionary",
		"language":"xh","license":"CC0-1.0","attribution":"test","format":"json"}`), 0o644)
	os.WriteFile(filepath.Join(dir, "dictionary.json"), []byte(`{"entries":[
		{"written":"hablar","kind":"word","readings":[{"type":"latin","value":"hablar"}],"glosses":["to speak"]}]}`), 0o644)
	root := t.TempDir()
	writeLemmaPack(t, root, "xh-rules", "xh", strings.Replace(lemmaTable("xh", "1"), `"reason": "past"`, `"reason": "first"`, 1))
	for _, d := range []string{dir, filepath.Join(root, "xh-rules")} {
		p, err := dict.LoadPack(d)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := packs.Import(ctx, sqlDB, p); err != nil {
			t.Fatal(err)
		}
	}
	sqlDB.Close()
	lemma.SetInstalled(nil) // a new process knows nothing of the pack yet

	// First run: the watcher is too slow to matter, so only the start-up
	// load can make the pack's table the one in effect.
	lemmaWatchEvery = time.Hour
	addr, stop := startServe(t, data)
	reason := func() string {
		t.Helper()
		resp, err := http.Get("http://" + addr + "/api/segment/at?" + url.Values{"lang": {"xh"}, "text": {"hablaba"}, "offset": {"0"}}.Encode())
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(resp.Body)
		var body struct {
			Match *struct{ Lemma, Reason string } `json:"match"`
		}
		if resp.StatusCode != http.StatusOK || json.Unmarshal(raw, &body) != nil || body.Match == nil || body.Match.Lemma != "hablar" {
			return resp.Status + " " + string(raw)
		}
		return body.Match.Reason
	}
	if got := reason(); got != "first" {
		t.Fatalf("segment/at before any change = %s, want the installed table (reason first)", got)
	}
	stop()

	// Second run: another process rewrites the table while serve runs.
	lemmaWatchEvery = 20 * time.Millisecond
	addr, stop = startServe(t, data)
	defer stop()

	other, err := db.Open(filepath.Join(data, "qinqin.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	if _, err := other.Exec(`UPDATE lemma_rule_packs SET rules_json = ?, content_hash = 'other', updated_at = 'later' WHERE pack_id = 'xh-rules'`,
		strings.Replace(lemmaTable("xh", "2"), `"reason": "past"`, `"reason": "second"`, 1)); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(20 * time.Second)
	for reason() != "second" {
		if time.Now().After(deadline) {
			t.Fatalf("the outside change never took effect: %s", reason())
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// startServe runs serve on data and returns its address and a stop func.
func startServe(t *testing.T, data string) (string, func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	addrCh := make(chan string, 1)
	done := make(chan error, 1)
	go func() {
		done <- serve(ctx, data, func() (net.Listener, error) {
			ln, err := net.Listen("tcp", "127.0.0.1:0")
			if err == nil {
				addrCh <- ln.Addr().String()
			}
			return ln, err
		})
	}()
	stopped := false
	stop := func() {
		if !stopped {
			stopped = true
			cancel()
			<-done
		}
	}
	select {
	case addr := <-addrCh:
		return addr, stop
	case err := <-done:
		t.Fatalf("serve returned: %v", err)
	case <-time.After(60 * time.Second):
		t.Fatal("serve did not listen")
	}
	return "", stop
}
