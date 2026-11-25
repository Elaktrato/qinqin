package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"regexp"
	"strconv"
	"testing"

	"qinqin/internal/api"
	"qinqin/internal/dbtest"
	"qinqin/internal/update"
)

func fakeReleases(t *testing.T, hits *int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*hits++
		w.Write([]byte(`[{"tag_name":"v0.7.0","name":"qinqin v0.7.0","body":"Notes","draft":false,"prerelease":false,"published_at":"2026-11-20T10:00:00Z","html_url":"https://github.com/Elaktrato/qinqin/releases/tag/v0.7.0"}]`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func versionEnv(t *testing.T, hits *int) (*httptest.Server, string, string) {
	t.Helper()
	gh := fakeReleases(t, hits)
	sqlDB := dbtest.Open(t)
	h := api.New(sqlDB, t.TempDir(), nil,
		api.WithBuild(api.Build{Version: "0.6.0", Commit: "abc1234", BuildDate: "2026-11-01T00:00:00Z"}),
		api.WithUpdateChecker(update.NewChecker(update.Config{BaseURL: gh.URL})))
	ts := newTestServer(sqlDB, h)
	t.Cleanup(ts.Close)
	admin := registerUser(t, ts.URL, "admin", "")
	bob := registerUser(t, ts.URL, "bob", admin)
	return ts, admin, bob
}

func getMap(t *testing.T, ts *httptest.Server, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	resp := doJSON(t, method, ts.URL, path, token, body)
	defer resp.Body.Close()
	var m map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&m)
	return resp.StatusCode, m
}

// versionFixture is docs/contracts/version/version.json.
func versionFixture(t *testing.T) (anonymous, signedIn map[string]any) {
	t.Helper()
	b, err := os.ReadFile("../../../docs/contracts/version/version.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct{ Anonymous, SignedIn map[string]any }
	if err := json.Unmarshal(b, &f); err != nil {
		t.Fatal(err)
	}
	return f.Anonymous, f.SignedIn
}

func TestVersionMatchesTheFixture(t *testing.T) {
	var hits int
	ts, admin, _ := versionEnv(t, &hits)
	anon, signed := versionFixture(t)
	if _, m := getMap(t, ts, "GET", "/api/version", "", nil); !reflect.DeepEqual(m, anon) {
		t.Errorf("anonymous = %v, fixture %v", m, anon)
	}
	if _, m := getMap(t, ts, "GET", "/api/version", admin, nil); !reflect.DeepEqual(m, signed) {
		t.Errorf("signed in = %v, fixture %v", m, signed)
	}
}

func TestVersionIsPublicAndMinimal(t *testing.T) {
	var hits int
	ts, admin, _ := versionEnv(t, &hits)
	st, m := getMap(t, ts, "GET", "/api/version", "", nil)
	if st != 200 || m["app"] != "qinqin" || m["version"] != "0.6.0" || m["contract"] != float64(api.ContractVersion) {
		t.Fatalf("anonymous = %d %v", st, m)
	}
	if _, ok := m["commit"]; ok {
		t.Errorf("anonymous answer carries commit: %v", m)
	}
	if _, ok := m["buildDate"]; ok {
		t.Errorf("anonymous answer carries buildDate: %v", m)
	}
	b, _ := m["bridge"].(map[string]any)
	if f, ok := b["features"].([]any); b["level"] != float64(1) || !ok || len(f) != 1 || f[0] != "status-bar" {
		t.Errorf("bridge = %v", m["bridge"])
	}
	_, m = getMap(t, ts, "GET", "/api/version", admin, nil)
	if m["commit"] != "abc1234" || m["buildDate"] != "2026-11-01T00:00:00Z" {
		t.Errorf("signed in = %v", m)
	}
	if hits != 0 {
		t.Errorf("the version route called GitHub")
	}
}

func TestAdminUpdateRoutes(t *testing.T) {
	var hits int
	ts, admin, bob := versionEnv(t, &hits)
	for _, c := range [][2]string{{"GET", "/api/admin/update"}, {"PATCH", "/api/admin/update/settings"}, {"POST", "/api/admin/update/check"}} {
		if st, _ := getMap(t, ts, c[0], c[1], bob, map[string]any{}); st != 403 {
			t.Errorf("%s %s as user = %d", c[0], c[1], st)
		}
		if st, _ := getMap(t, ts, c[0], c[1], "", map[string]any{}); st != 403 {
			t.Errorf("%s %s anonymous = %d", c[0], c[1], st)
		}
	}
	st, m := getMap(t, ts, "GET", "/api/admin/update", admin, nil)
	check, _ := m["check"].(map[string]any)
	latest, _ := check["latest"].(map[string]any)
	if st != 200 || check["state"] != "ok" || check["update"] != "available" || latest["version"] != "0.7.0" || hits != 1 {
		t.Fatalf("GET = %d %v (hits %d)", st, m, hits)
	}
	if in, _ := m["installed"].(map[string]any); in["version"] != "0.6.0" || in["commit"] != "abc1234" {
		t.Errorf("installed = %v", m["installed"])
	}
	getMap(t, ts, "GET", "/api/admin/update", admin, nil)
	if hits != 1 {
		t.Errorf("a second GET asked GitHub again (%d)", hits)
	}
	// Disable: no request, state disabled, even for check now.
	st, m = getMap(t, ts, "PATCH", "/api/admin/update/settings", admin, map[string]any{"enabled": false})
	if c, _ := m["check"].(map[string]any); st != 200 || c["state"] != "disabled" || c["latest"] != nil {
		t.Fatalf("PATCH disable = %d %v", st, m)
	}
	_, m = getMap(t, ts, "POST", "/api/admin/update/check", admin, nil)
	if c, _ := m["check"].(map[string]any); c["state"] != "disabled" || hits != 1 {
		t.Errorf("check now while disabled = %v (hits %d)", m, hits)
	}
	if st, _ := getMap(t, ts, "PATCH", "/api/admin/update/settings", admin, map[string]any{"nope": 1}); st != 400 {
		t.Errorf("unknown field = %d", st)
	}
	getMap(t, ts, "PATCH", "/api/admin/update/settings", admin, map[string]any{"enabled": true, "prereleases": true})
	_, m = getMap(t, ts, "GET", "/api/admin/update", admin, nil)
	if s, _ := m["settings"].(map[string]any); s["enabled"] != true || s["prereleases"] != true {
		t.Errorf("settings = %v", m["settings"])
	}
}

func TestAdminUpdateWithoutAChecker(t *testing.T) {
	ts, _ := newServer(t)
	admin := registerUser(t, ts.URL, "admin", "")
	_, m := getMap(t, ts, "GET", "/api/admin/update", admin, nil)
	if c, _ := m["check"].(map[string]any); c["state"] != "unchecked" || m["installed"].(map[string]any)["version"] != "dev" {
		t.Errorf("no checker = %v", m)
	}
}

func TestContractVersionMatchesTheChangelog(t *testing.T) {
	b, err := os.ReadFile("../../../docs/contracts/CHANGELOG.md")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`(?m)^## .*\(contract (\d+)\)`).FindSubmatch(b)
	if m == nil {
		t.Fatal("no heading with (contract N) in docs/contracts/CHANGELOG.md")
	}
	if n, _ := strconv.Atoi(string(m[1])); n != api.ContractVersion {
		t.Errorf("CHANGELOG says contract %d, api.ContractVersion = %d", n, api.ContractVersion)
	}
}
