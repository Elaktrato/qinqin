package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/lemma"
	"qinqin/internal/packs"
)

// xhRules is a toy rule table for the data-only language xh: -aba is the
// past of -ar, and every entry has the class (no part-of-speech data).
func xhRules(version string) string {
	return `{"format": 2, "language": "xh", "version": "` + version + `", "maxDepth": 2,
 "classes": {"w": {"any": true}}, "hints": {},
 "rules": [{"from": "aba", "to": "ar", "reason": "past", "out": "w"}]}`
}

// lemmaPackDir writes a lemma-rules pack.
func lemmaPackDir(t *testing.T, id, language, rules string) string {
	t.Helper()
	dir := t.TempDir()
	m, _ := json.Marshal(map[string]string{"id": id, "name": "Rules " + id, "version": "1.0", "type": "lemma-rules",
		"language": language, "license": "CC0-1.0", "attribution": "Qinqin test fixtures", "format": "rules-json"})
	for name, body := range map[string]string{"manifest.json": string(m), "rules.json": rules, "LICENSE": "CC0 (test)\n"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// installLemmaPack stages and installs a lemma-rules pack through the admin
// upload.
func installLemmaPack(t *testing.T, e *packEnv, dir string) {
	t.Helper()
	staged := stageZip(t, e, zipDirToBytes(t, dir))
	if staged.Manifest.Type != "lemma-rules" || staged.Manifest.Format != "rules-json" {
		t.Fatalf("stage = %+v", staged)
	}
	if code, text := e.install(t, staged.Token, "CC0-1.0"); code != http.StatusAccepted {
		t.Fatalf("install = %d %s", code, text)
	}
	e.waitDone(t, 1)
	if _, st := e.status(t, staged.Token); st.Status != "done" || st.Pack == nil || st.Pack.Type != "lemma-rules" {
		t.Fatalf("status = %+v", st)
	}
}

// segmentLemma segments text in language and returns the first match's
// surface/reason and lemma ("" when there is no match); a 400 (a language
// the route does not serve) is "400".
func segmentLemma(t *testing.T, e *packEnv, language, text string) (string, string) {
	t.Helper()
	resp := doJSON(t, http.MethodPost, e.ts.URL, "/api/segment", e.admin, map[string]string{"lang": language, "text": text})
	if resp.StatusCode == http.StatusBadRequest {
		return "400", bodyText(resp)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("segment = %d %s", resp.StatusCode, bodyText(resp))
	}
	var body struct {
		Matches []segmentMatchBody `json:"matches"`
	}
	decodeJSON(t, resp, &body)
	if len(body.Matches) == 0 {
		return "", ""
	}
	return body.Matches[0].Surface + "/" + body.Matches[0].Reason, body.Matches[0].Lemma
}

// A lemma-rules pack installed through the admin upload gives a data-only
// language segmentation and lookups at once, and its uninstall takes them
// away again, without a restart (#176).
func TestLemmaPackTakesEffectWithoutARestart(t *testing.T) {
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	e := newPackEnv(t)
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"id":"xh-dict","name":"Xh","version":"1","type":"dictionary",
		"language":"xh","license":"CC0-1.0","attribution":"Qinqin test fixtures","format":"json"}`), 0o644)
	os.WriteFile(filepath.Join(dir, "dictionary.json"), []byte(`{"entries":[
		{"written":"hablar","kind":"word","readings":[{"type":"latin","value":"hablar"}],"glosses":["to speak"]}]}`), 0o644)
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := packs.Import(context.Background(), e.db, p); err != nil {
		t.Fatal(err)
	}
	if surface, _ := segmentLemma(t, e, "xh", "hablaba"); surface != "400" {
		t.Fatalf("before the pack: %s, want 400 (xh has no code pack and no table)", surface)
	}

	installLemmaPack(t, e, lemmaPackDir(t, "xh-rules", "xh", xhRules("1")))
	if surface, lemmaForm := segmentLemma(t, e, "xh", "hablaba"); surface != "hablaba/past" || lemmaForm != "hablar" {
		t.Fatalf("after the install: %s -> %s, want hablaba/past -> hablar", surface, lemmaForm)
	}
	look := doJSON(t, http.MethodGet, e.ts.URL, lookupPath("xh", "hablaba", "0"), "", nil)
	if text := bodyText(look); look.StatusCode != http.StatusOK || !strings.Contains(text, `"hablar"`) {
		t.Errorf("lookup after the install = %d %s", look.StatusCode, text)
	}
	resp := doJSON(t, http.MethodGet, e.ts.URL, "/api/admin/packs", e.admin, nil)
	if text := bodyText(resp); !strings.Contains(text, `"type":"lemma-rules","packId":"xh-rules"`) {
		t.Errorf("admin list = %s", text)
	}

	resp = doJSON(t, http.MethodDelete, e.ts.URL, "/api/admin/packs/lemma-rules/xh-rules", e.admin, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("uninstall = %d %s", resp.StatusCode, bodyText(resp))
	}
	if surface, _ := segmentLemma(t, e, "xh", "hablaba"); surface != "400" {
		t.Errorf("after the uninstall: %s, want 400", surface)
	}
}

// A broken table and a second pack for a language with a live one are
// refused at the review, before the licence step.
func TestStageLemmaPackRefusals(t *testing.T) {
	t.Cleanup(func() { lemma.SetInstalled(nil) })
	e := newPackEnv(t)
	for name, tc := range map[string]struct {
		dir  string
		want string
	}{
		"unknown key":       {lemmaPackDir(t, "xh-bad", "xh", strings.Replace(xhRules("1"), `"hints"`, `"hintz": 1, "hints"`, 1)), "invalid pack: rules.json: lemma: json: unknown field"},
		"language mismatch": {lemmaPackDir(t, "xh-bad", "xq", xhRules("1")), `rules.json is the table of "xh"`},
		"over a limit":      {lemmaPackDir(t, "xh-bad", "xh", strings.Replace(xhRules("1"), `"maxDepth": 2`, `"maxDepth": 12`, 1)), "maxDepth 12"},
	} {
		resp := uploadZip(t, e, e.admin, zipDirToBytes(t, tc.dir))
		if text := bodyText(resp); resp.StatusCode != http.StatusBadRequest || !strings.Contains(text, tc.want) {
			t.Errorf("%s: %d %q, want 400 containing %q", name, resp.StatusCode, text, tc.want)
		}
	}
	installLemmaPack(t, e, lemmaPackDir(t, "xh-one", "xh", xhRules("1")))
	resp := uploadZip(t, e, e.admin, zipDirToBytes(t, lemmaPackDir(t, "xh-two", "xh", xhRules("2"))))
	if text := bodyText(resp); resp.StatusCode != http.StatusBadRequest || !strings.Contains(text, `xh already has the lemma-rules pack "xh-one"`) {
		t.Errorf("second pack: %d %q", resp.StatusCode, text)
	}
	// The same pack id again is a replacement, reviewed as such.
	staged := stageZip(t, e, zipDirToBytes(t, lemmaPackDir(t, "xh-one", "xh", xhRules("2"))))
	if staged.Replaces == nil || staged.Replaces.Version != "1.0" {
		t.Errorf("re-upload replaces = %+v", staged.Replaces)
	}
	if dirs := stageDirs(t, e.dataDir); len(dirs) != 1 {
		t.Errorf("stage dirs: %v, want the one staged replacement", dirs)
	}
}
