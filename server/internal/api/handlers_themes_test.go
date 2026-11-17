package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

type themesAnswer struct {
	Themes []struct {
		ID            string            `json:"id"`
		Name          string            `json:"name"`
		Family        string            `json:"family"`
		Scheme        string            `json:"scheme"`
		Colors        map[string]string `json:"colors"`
		Accents       json.RawMessage   `json:"accents"`
		DefaultAccent string            `json:"defaultAccent"`
		PackID        string            `json:"packId"`
		Builtin       bool              `json:"builtin"`
	} `json:"themes"`
	Packs []struct {
		PackID      string   `json:"packId"`
		Name        string   `json:"name"`
		Version     string   `json:"version"`
		License     string   `json:"license"`
		Attribution string   `json:"attribution"`
		Notice      string   `json:"notice"`
		Builtin     bool     `json:"builtin"`
		Themes      []string `json:"themes"`
	} `json:"packs"`
}

func getThemes(t *testing.T, url, token string, header map[string]string) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url+"/api/themes", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp, body
}

// GET /api/themes is public (the sign-in page paints with a theme, the
// Sources page credits the packs): every built-in pack in the contract's
// order, then installed packs; the same bytes for anyone; ETag + no-cache.
func TestListThemes(t *testing.T) {
	e := newPackEnv(t)
	alice := registerUser(t, e.ts.URL, "alice", e.admin)

	resp, anon := getThemes(t, e.ts.URL, "", nil)
	if resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "application/json" ||
		resp.Header.Get("Cache-Control") != "no-cache" || resp.Header.Get("ETag") == "" {
		t.Fatalf("anonymous: %d %v", resp.StatusCode, resp.Header)
	}
	var got themesAnswer
	if err := json.Unmarshal(anon, &got); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile("../../../docs/contracts/themes/themes-api.json")
	var want struct {
		BuiltinPacks []struct {
			PackID string   `json:"packId"`
			Themes []string `json:"themes"`
		} `json:"builtinPacks"`
	}
	json.Unmarshal(raw, &want)
	if len(got.Packs) != len(want.BuiltinPacks) {
		t.Fatalf("%d packs, want the %d built-in ones", len(got.Packs), len(want.BuiltinPacks))
	}
	var wantIDs []string
	for i, p := range want.BuiltinPacks {
		gp := got.Packs[i]
		if gp.PackID != p.PackID || !gp.Builtin || strings.Join(gp.Themes, ",") != strings.Join(p.Themes, ",") ||
			gp.License != "MIT" || gp.Attribution == "" || gp.Notice == "" || gp.Name == "" {
			t.Errorf("pack %d = %+v, want %s %v", i, gp, p.PackID, p.Themes)
		}
		wantIDs = append(wantIDs, p.Themes...)
	}
	var ids []string
	for _, th := range got.Themes {
		ids = append(ids, th.ID)
		if !th.Builtin || th.PackID == "" || len(th.Colors) != 13 || th.Name == "" || th.DefaultAccent == "" {
			t.Errorf("theme %+v", th)
		}
	}
	if strings.Join(ids, ",") != strings.Join(wantIDs, ",") {
		t.Fatalf("themes %v, want %v", ids, wantIDs)
	}
	mocha := got.Themes[3]
	if mocha.ID != "catppuccin-mocha" || mocha.Family != "Catppuccin" || mocha.Scheme != "dark" || mocha.Colors["panel"] != "#1e1e2e" ||
		!bytes.HasPrefix(mocha.Accents, []byte(`{"mauve":"#cba6f7","pink":`)) {
		t.Errorf("mocha = %+v accents %s", mocha, mocha.Accents)
	}

	// Two users and anonymous read the same bytes; a read token is allowed.
	if _, b := getThemes(t, e.ts.URL, alice, nil); !bytes.Equal(b, anon) {
		t.Error("alice reads other bytes than anonymous")
	}
	if _, b := getThemes(t, e.ts.URL, e.admin, nil); !bytes.Equal(b, anon) {
		t.Error("the admin reads other bytes than anonymous")
	}
	st, created, _, _ := createTok(t, e.ts.URL, alice, tokenBody("themes", "read", 30, nil, "secret-pass-alice"))
	if st != http.StatusCreated {
		t.Fatalf("create token: %d", st)
	}
	tok := created.Token
	if resp, b := getThemes(t, e.ts.URL, tok, nil); resp.StatusCode != http.StatusOK || !bytes.Equal(b, anon) {
		t.Errorf("read token: %d", resp.StatusCode)
	}

	// If-None-Match.
	etag := resp.Header.Get("ETag")
	if resp, b := getThemes(t, e.ts.URL, "", map[string]string{"If-None-Match": etag}); resp.StatusCode != http.StatusNotModified || len(b) != 0 {
		t.Errorf("If-None-Match: %d %q", resp.StatusCode, b)
	}

	// An installed pack follows the built-in ones; the ETag changes.
	mochaRaw, _, _ := contrastCase(t, "Mocha")
	mine := strings.Replace(strings.Replace(string(mochaRaw), `"catppuccin-mocha"`, `"test-night"`, 1), `"Mocha"`, `"Night"`, 1)
	s := stageZip(t, e, themePackZip(t, themePackManifest, "["+mine+"]"))
	if code, text := e.install(t, s.Token, "MIT"); code != http.StatusAccepted {
		t.Fatalf("install = %d %s", code, text)
	}
	e.waitDone(t, 1)
	resp2, after := getThemes(t, e.ts.URL, "", nil)
	if resp2.Header.Get("ETag") == etag {
		t.Error("ETag unchanged after an install")
	}
	got = themesAnswer{}
	json.Unmarshal(after, &got)
	lastPack, lastTheme := got.Packs[len(got.Packs)-1], got.Themes[len(got.Themes)-1]
	if lastPack.PackID != "test-themes" || lastPack.Builtin || lastPack.Version != "1.0" || lastPack.Attribution != "Qinqin test fixtures" ||
		strings.Join(lastPack.Themes, ",") != "test-night" {
		t.Errorf("installed pack = %+v", lastPack)
	}
	if lastTheme.ID != "test-night" || lastTheme.Builtin || lastTheme.PackID != "test-themes" || lastTheme.Name != "Night" {
		t.Errorf("installed theme = %+v", lastTheme)
	}
}

// A stored theme row that no longer parses is skipped, never a 500.
func TestListThemesSkipsABrokenRow(t *testing.T) {
	e := newPackEnv(t)
	if _, err := e.db.Exec(`INSERT INTO theme_packs (pack_id, name, version, license, attribution, updated_at) VALUES ('p', 'P', '1', 'MIT', 'a', 't')`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.db.Exec(`INSERT INTO themes (theme_id, pack_id, ord, data) VALUES ('broken', 'p', 0, '{"id":"broken"}')`); err != nil {
		t.Fatal(err)
	}
	resp, body := getThemes(t, e.ts.URL, "", nil)
	if resp.StatusCode != http.StatusOK || strings.Contains(string(body), `"id":"broken"`) || !strings.Contains(string(body), `"packId":"p"`) {
		t.Fatalf("%d %s", resp.StatusCode, body)
	}
}
