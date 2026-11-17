package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"reflect"
	"testing"
)

const interfaceLanguagePath = "/api/me/interface-language"

// meInterfaceLanguage reads interfaceLanguage from GET /api/auth/me; the
// field must be present.
func meInterfaceLanguage(t *testing.T, url, token string) string {
	t.Helper()
	var me map[string]any
	decodeJSON(t, doRaw(t, http.MethodGet, url, "/api/auth/me", token, ""), &me)
	v, ok := me["interfaceLanguage"].(string)
	if !ok {
		t.Fatalf("me has no string interfaceLanguage: %v", me)
	}
	return v
}

func TestInterfaceLanguageFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/i18n/interface-language-api.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Cases []struct {
			Name    string `json:"name"`
			Request struct {
				Method  string          `json:"method"`
				Path    string          `json:"path"`
				Body    json.RawMessage `json:"body"`
				RawBody *string         `json:"rawBody"`
				Token   *bool           `json:"token"`
			} `json:"request"`
			Setup  []json.RawMessage `json:"setup"`
			Status int               `json:"status"`
			Body   map[string]any    `json:"body"`
			Me     *string           `json:"me"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if len(f.Cases) < 10 {
		t.Fatalf("only %d cases", len(f.Cases))
	}
	for _, c := range f.Cases {
		t.Run(c.Name, func(t *testing.T) {
			ts, _ := timeZoneServer(t, tzNow)
			token := registerUser(t, ts.URL, "owner", "")
			for _, s := range c.Setup {
				if resp := doRaw(t, http.MethodPut, ts.URL, interfaceLanguagePath, token, string(s)); resp.StatusCode != http.StatusOK {
					t.Fatalf("setup status %d", resp.StatusCode)
				}
			}
			auth := token
			if c.Request.Token != nil && !*c.Request.Token {
				auth = ""
			}
			body := string(c.Request.Body)
			if c.Request.RawBody != nil {
				body = *c.Request.RawBody
			}
			resp := doRaw(t, c.Request.Method, ts.URL, c.Request.Path, auth, body)
			if resp.StatusCode != c.Status {
				b, _ := io.ReadAll(resp.Body)
				t.Fatalf("status = %d, want %d (%s)", resp.StatusCode, c.Status, b)
			}
			var got map[string]any
			decodeJSON(t, resp, &got)
			if c.Status == http.StatusOK {
				if !reflect.DeepEqual(got, c.Body) {
					t.Errorf("body = %v, want %v", got, c.Body)
				}
			} else if got["error"] != c.Body["error"] {
				t.Errorf("error = %v, want %v", got["error"], c.Body["error"])
			}
			if c.Me != nil {
				if lang := meInterfaceLanguage(t, ts.URL, token); lang != *c.Me {
					t.Errorf("me interfaceLanguage = %q, want %q", lang, *c.Me)
				}
			}
		})
	}
}

func TestInterfaceLanguageGateAndIsolation(t *testing.T) {
	captureLog(t)
	ts, sqlDB := newLooseServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	bob := registerUser(t, ts.URL, "bob", alice)
	st, c, _, _ := createTok(t, ts.URL, alice, tokenBody("n", "write", 30, nil, "secret-pass-alice"))
	if st != 201 {
		t.Fatal(st)
	}
	registerUser(t, ts.URL, "bobby", alice)
	sqlDB.Exec(`UPDATE users SET must_change_password = 1, must_change_after = 0 WHERE username = 'bobby'`)
	pwc := login(t, ts.URL, "bobby")

	for _, k := range []struct {
		who, tok string
		status   int
		code     string
	}{
		{"anon", "", 401, "unauthorized"},
		{"bad token", "not-a-token", 401, "unauthorized"},
		{"restricted", pwc, 403, "password_change_required"},
		{"access token", c.Token, 403, "token_not_allowed"},
	} {
		resp := doRaw(t, http.MethodPut, ts.URL, interfaceLanguagePath, k.tok, `{"language":"en"}`)
		var e errBody
		json.NewDecoder(resp.Body).Decode(&e)
		if resp.StatusCode != k.status || e.Error != k.code {
			t.Errorf("%s: %d %q, want %d %q", k.who, resp.StatusCode, e.Error, k.status, k.code)
		}
	}
	var lang string
	if err := sqlDB.QueryRow(`SELECT interface_language FROM users WHERE username = 'bobby'`).Scan(&lang); err != nil || lang != "" {
		t.Errorf("the restricted session wrote %q (%v)", lang, err)
	}

	if resp := doRaw(t, http.MethodPut, ts.URL, interfaceLanguagePath, alice, `{"language":"zh-Hant"}`); resp.StatusCode != 200 {
		t.Fatalf("alice put: %d", resp.StatusCode)
	}
	if got := meInterfaceLanguage(t, ts.URL, bob); got != "" {
		t.Errorf("bob sees %q", got)
	}
	if resp := doRaw(t, http.MethodPut, ts.URL, interfaceLanguagePath, bob, `{"language":"pt-BR"}`); resp.StatusCode != 200 {
		t.Fatalf("bob put: %d", resp.StatusCode)
	}
	if got := meInterfaceLanguage(t, ts.URL, alice); got != "zh-Hant" {
		t.Errorf("alice sees %q", got)
	}
	if got := meInterfaceLanguage(t, ts.URL, bob); got != "pt-BR" {
		t.Errorf("bob sees %q", got)
	}
}
