package api_test

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"qinqin/internal/themes"
)

const themePackManifest = `{"id":"test-themes","name":"Test themes","version":"1.0","type":"theme",
	"license":"MIT","attribution":"Qinqin test fixtures","format":"themes-json"}`

// themePackZip zips a theme pack whose themes.json is the given text.
func themePackZip(t *testing.T, manifest, themesJSON string) []byte {
	t.Helper()
	dir := t.TempDir()
	for name, body := range map[string]string{"manifest.json": manifest, "themes.json": themesJSON, "LICENSE": "MIT (test)\n"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return zipDirToBytes(t, dir)
}

// contrastCase returns the theme and its review checks from
// docs/contracts/themes/contrast.json.
func contrastCase(t *testing.T, name string) (json.RawMessage, []themes.Check, int) {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/themes/contrast.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Checks []struct {
			Name    string          `json:"name"`
			Theme   json.RawMessage `json:"theme"`
			Expect  []themes.Check  `json:"expect"`
			Failing int             `json:"failing"`
		} `json:"checks"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	for _, c := range doc.Checks {
		if c.Name == name {
			return c.Theme, c.Expect, c.Failing
		}
	}
	t.Fatalf("no contrast case %q", name)
	return nil, nil, 0
}

// The licence review of a theme pack carries the measured contrast of
// every theme (design §7): the checks of contrast.json, and how many fail.
func TestStageThemePackReportsContrast(t *testing.T) {
	e := newPackEnv(t)
	latte, wantChecks, wantFailing := contrastCase(t, "Latte")
	// Renamed in the text, so the accents keep their order.
	renamed := strings.Replace(strings.Replace(string(latte), `"catppuccin-latte"`, `"test-latte"`, 1), `"Latte"`, `"Test Latte"`, 1)
	themesJSON := "[" + renamed + "]"

	resp := uploadZip(t, e, e.admin, themePackZip(t, themePackManifest, themesJSON))
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("stage = %d %s", resp.StatusCode, bodyText(resp))
	}
	var body struct {
		Token    string `json:"token"`
		Manifest struct {
			Type, Language, License string
		} `json:"manifest"`
		Themes []struct {
			ID      string         `json:"id"`
			Name    string         `json:"name"`
			Family  string         `json:"family"`
			Scheme  string         `json:"scheme"`
			Checks  []themes.Check `json:"checks"`
			Failing int            `json:"failing"`
		} `json:"themes"`
	}
	decodeJSON(t, resp, &body)
	if body.Manifest.Type != "theme" || body.Manifest.Language != "" || len(body.Themes) != 1 {
		t.Fatalf("stage = %+v", body)
	}
	th := body.Themes[0]
	if th.ID != "test-latte" || th.Name != "Test Latte" || th.Family != "Catppuccin" || th.Scheme != "light" ||
		!reflect.DeepEqual(th.Checks, wantChecks) || th.Failing != wantFailing || wantFailing == 0 {
		t.Fatalf("theme review = %+v, want checks %+v failing %d", th, wantChecks, wantFailing)
	}

	// Failing checks do not stop the install.
	if code, text := e.install(t, body.Token, "MIT"); code != http.StatusAccepted {
		t.Fatalf("install = %d %s", code, text)
	}
	e.waitDone(t, 1)
	if _, st := e.status(t, body.Token); st.Status != "done" || st.Pack == nil || st.Pack.Type != "theme" {
		t.Fatalf("status = %+v", st)
	}
	resp = doJSON(t, http.MethodGet, e.ts.URL, "/api/admin/packs", e.admin, nil)
	if text := bodyText(resp); !strings.Contains(text, `"type":"theme","packId":"test-themes"`) {
		t.Errorf("admin list = %s", text)
	}
}

// A dictionary pack's review has no themes member.
func TestStageOtherPackHasNoThemes(t *testing.T) {
	e := newPackEnv(t)
	resp := uploadZip(t, e, e.admin, esPackZip(t, packTestDictManifest))
	if text := bodyText(resp); resp.StatusCode != http.StatusCreated || strings.Contains(text, `"themes"`) {
		t.Fatalf("stage = %d %s", resp.StatusCode, text)
	}
}

// An invalid themes.json, or a built-in id, is refused at the review: 400
// naming the problem, nothing staged.
func TestStageThemePackRefusals(t *testing.T) {
	e := newPackEnv(t)
	mocha, _, _ := contrastCase(t, "Mocha")
	for name, tc := range map[string]struct{ manifest, file, want string }{
		"bad colour": {themePackManifest, strings.Replace(`[`+string(mocha)+`]`, `"#1e1e2e"`, `"#1E1E2E"`, 1),
			"invalid pack: themes.json: bad-colour at $[0].colors.panel"},
		"built-in theme id": {themePackManifest, `[` + string(mocha) + `]`, `the theme id "catppuccin-mocha" belongs to the built-in theme pack "catppuccin"`},
		"built-in pack id": {strings.Replace(themePackManifest, `"test-themes"`, `"nord"`, 1),
			`[` + strings.Replace(string(mocha), `"catppuccin-mocha"`, `"mine"`, 1) + `]`, `the pack id "nord" belongs to a built-in theme pack`},
		"not an array": {themePackManifest, string(mocha), "themes.json: not-an-array at $"},
	} {
		resp := uploadZip(t, e, e.admin, themePackZip(t, tc.manifest, tc.file))
		if text := bodyText(resp); resp.StatusCode != http.StatusBadRequest || !strings.Contains(text, tc.want) {
			t.Errorf("%s: %d %q, want 400 containing %q", name, resp.StatusCode, text, tc.want)
		}
	}
	if dirs := stageDirs(t, e.dataDir); len(dirs) != 0 {
		t.Errorf("stage dirs left: %v", dirs)
	}
}
