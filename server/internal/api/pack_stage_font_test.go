package api_test

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const fontPackManifest = `{"id":"test-font","name":"Test font","version":"1.0","type":"font",
	"license":"OFL-1.1","attribution":"Qinqin test fixtures","notice":"Modified (subset, renamed).","format":"font-slices"}`

// testSlice is a synthetic WOFF2 slice: the magic and a tag. The server
// checks the magic, the size and the hash, never the font inside.
func testSlice(tag string) ([]byte, string) {
	b := []byte("wOF2\x00\x01\x00\x00" + tag)
	sum := sha256.Sum256(b)
	return b, hex.EncodeToString(sum[:])
}

// fontPackDir writes a font pack: faces.json is given with SHA_<tag>
// placeholders for the hashes of the slices named by tags.
func fontPackDir(t *testing.T, manifest, faces string, tags ...string) string {
	t.Helper()
	dir := t.TempDir()
	files := map[string][]byte{"manifest.json": []byte(manifest), "LICENSE": []byte("SIL OPEN FONT LICENSE Version 1.1 (test)\n"),
		"ATTRIBUTION.md": []byte("Test faces, modified (subset, renamed)\n")}
	for _, tag := range tags {
		b, sha := testSlice(tag)
		files["slices/"+sha+".woff2"] = b
		faces = strings.ReplaceAll(faces, "SHA_"+tag, sha)
	}
	files["faces.json"] = []byte(faces)
	for name, body := range files {
		path := filepath.Join(dir, filepath.FromSlash(name))
		os.MkdirAll(filepath.Dir(path), 0o755)
		if err := os.WriteFile(path, body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

// testFaces is the faces.json of the API tests (docs/contracts/fonts/fonts-api.json "order").
const testFaces = `{"version":1,"faces":[
	{"face":"kai","script":"Jpan","original":"Test Kai","weight":"400","style":"normal",
	 "slices":[{"file":"slices/SHA_k.woff2","unicodeRange":"U+3040-30FF"}]},
	{"face":"sans","script":"Hans","original":"Test Sans","weight":"700","style":"normal",
	 "slices":[{"file":"slices/SHA_b1.woff2","unicodeRange":"U+20-7E"},{"file":"slices/SHA_b2.woff2","unicodeRange":"U+4E00-9FFF"}]},
	{"face":"sans","script":"Hans","original":"Test Sans","weight":"400","style":"normal",
	 "slices":[{"file":"slices/SHA_r1.woff2","unicodeRange":"U+20-7E"},{"file":"slices/SHA_r2.woff2","unicodeRange":"U+4E00-9FFF"}]}]}`

var testFaceTags = []string{"k", "b1", "b2", "r1", "r2"}

// installFontPack stages and installs the test font pack through the admin
// upload, as an administrator would.
func installFontPack(t *testing.T, e *packEnv) {
	t.Helper()
	staged := stageZip(t, e, zipDirToBytes(t, fontPackDir(t, fontPackManifest, testFaces, testFaceTags...)))
	if staged.Manifest.Type != "font" || staged.Manifest.Language != "" || staged.Manifest.License != "OFL-1.1" {
		t.Fatalf("stage = %+v", staged)
	}
	if code, text := e.install(t, staged.Token, "OFL-1.1"); code != http.StatusAccepted {
		t.Fatalf("install = %d %s", code, text)
	}
	e.waitDone(t, 1)
	if _, st := e.status(t, staged.Token); st.Status != "done" || st.Pack == nil || st.Pack.Type != "font" {
		t.Fatalf("status = %+v", st)
	}
}

// A font pack installs through the staged upload; its slices land in
// <data>/fonts and the admin list shows it; the admin can uninstall it.
func TestStageAndInstallFontPack(t *testing.T) {
	e := newPackEnv(t)
	installFontPack(t, e)
	for _, tag := range testFaceTags {
		_, sha := testSlice(tag)
		if _, err := os.Stat(filepath.Join(e.dataDir, "fonts", sha[:2], sha+".woff2")); err != nil {
			t.Errorf("slice %s not stored: %v", tag, err)
		}
	}
	resp := doJSON(t, http.MethodGet, e.ts.URL, "/api/admin/packs", e.admin, nil)
	if text := bodyText(resp); !strings.Contains(text, `"type":"font","packId":"test-font"`) {
		t.Errorf("admin list = %s", text)
	}
	resp = doJSON(t, http.MethodDelete, e.ts.URL, "/api/admin/packs/font/test-font", e.admin, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("uninstall = %d %s", resp.StatusCode, bodyText(resp))
	}
	_, sha := testSlice("k")
	if _, err := os.Stat(filepath.Join(e.dataDir, "fonts", sha[:2], sha+".woff2")); !os.IsNotExist(err) {
		t.Errorf("slice left after the uninstall: %v", err)
	}
}

// A broken font pack is refused at the review: 400 naming the problem,
// nothing staged.
func TestStageFontPackRefusals(t *testing.T) {
	e := newPackEnv(t)
	for name, tc := range map[string]struct {
		faces string
		tags  []string
		want  string
	}{
		"overlap": {`{"version":1,"faces":[{"face":"sans","script":"Hans","original":"X","weight":"400","style":"normal",
			"slices":[{"file":"slices/SHA_a.woff2","unicodeRange":"U+41-5A"},{"file":"slices/SHA_b.woff2","unicodeRange":"U+50"}]}]}`,
			[]string{"a", "b"}, "invalid pack: faces.json: overlapping-range at $.faces[0].slices[1].unicodeRange"},
		"missing slice": {`{"version":1,"faces":[{"face":"sans","script":"Hans","original":"X","weight":"400","style":"normal",
			"slices":[{"file":"slices/` + strings.Repeat("a", 64) + `.woff2","unicodeRange":"U+41"}]}]}`,
			nil, "invalid pack: slices/" + strings.Repeat("a", 64) + ".woff2: no such file"},
	} {
		resp := uploadZip(t, e, e.admin, zipDirToBytes(t, fontPackDir(t, fontPackManifest, tc.faces, tc.tags...)))
		if text := bodyText(resp); resp.StatusCode != http.StatusBadRequest || !strings.Contains(text, tc.want) {
			t.Errorf("%s: %d %q, want 400 containing %q", name, resp.StatusCode, text, tc.want)
		}
	}
	if dirs := stageDirs(t, e.dataDir); len(dirs) != 0 {
		t.Errorf("stage dirs left: %v", dirs)
	}
}
