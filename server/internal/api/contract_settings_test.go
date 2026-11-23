package api_test

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"
)

// docs/contracts/settings/workspace-settings.json `merge` cases through
// PUT /api/workspaces/{id} {"settings": patch}: the RFC 7396 merge into the
// stored object and the 64 KiB cap, pinned as built.

type settingsMergeCase struct {
	Name     string          `json:"name"`
	Note     string          `json:"note"`
	Stored   json.RawMessage `json:"stored"`
	Patch    json.RawMessage `json:"patch"`
	RawPatch string          `json:"rawPatch"`
	Expect   struct {
		Status   int             `json:"status"`
		Error    string          `json:"error"`
		JSON     json.RawMessage `json:"json"`
		Settings json.RawMessage `json:"settings"`
	} `json:"expect"`
}

func TestContractWorkspaceSettingsMerge(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/settings/workspace-settings.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Rule     string              `json:"rule"`
		MaxBytes int                 `json:"maxSettingsBytes"`
		Merge    []settingsMergeCase `json:"merge"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if file.Rule != "settings/workspace-settings" || len(file.Merge) < 5 {
		t.Fatalf("rule %q, %d merge cases", file.Rule, len(file.Merge))
	}
	if file.MaxBytes != 64<<10 {
		t.Errorf("maxSettingsBytes %d, server 64 KiB", file.MaxBytes)
	}
	for _, c := range file.Merge {
		t.Run(c.Name, func(t *testing.T) {
			if c.Note == "" {
				t.Error("case without note")
			}
			ts, sqlDB := newServer(t)
			alice := registerUser(t, ts.URL, "alice", "")
			ws := createWorkspace(t, ts.URL, alice, "zh", "Chinese")
			expand := func(s string) string { return expandPush(s, ws, 0) }
			if _, err := sqlDB.Exec(`UPDATE workspaces SET settings = ? WHERE id = ?`, expand(string(c.Stored)), ws); err != nil {
				t.Fatal(err)
			}
			patch := c.RawPatch
			if patch == "" {
				patch = string(c.Patch)
			}
			req, _ := http.NewRequest(http.MethodPut, ts.URL+"/api/workspaces/"+strconv.FormatInt(ws, 10),
				strings.NewReader(`{"settings":`+expand(patch)+`}`))
			req.Header.Set("Authorization", "Bearer "+alice)
			req.Header.Set("Content-Type", "application/json")
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode != c.Expect.Status {
				t.Fatalf("status %d, want %d: %.300s", resp.StatusCode, c.Expect.Status, body)
			}
			if c.Expect.Error != "" && errorCode(t, body) != c.Expect.Error {
				t.Errorf("body %s, want error %q", body, c.Expect.Error)
			}
			if c.Expect.JSON != nil && !jsonValueEqual(body, c.Expect.JSON) {
				t.Errorf("body %s, want %s", body, c.Expect.JSON)
			}
			// What the workspace holds afterwards (unchanged on an error).
			want := c.Expect.Settings
			if want == nil {
				want = c.Stored
			}
			var stored string
			if err := sqlDB.QueryRow(`SELECT settings FROM workspaces WHERE id = ?`, ws).Scan(&stored); err != nil {
				t.Fatal(err)
			}
			if !jsonValueEqual([]byte(stored), []byte(expand(string(want)))) {
				t.Errorf("stored %.300s, want %.300s", stored, want)
			}
			if resp.StatusCode == http.StatusOK {
				var got struct {
					Settings json.RawMessage `json:"settings"`
				}
				json.Unmarshal(body, &got)
				if !jsonValueEqual(got.Settings, []byte(expand(string(want)))) {
					t.Errorf("answer settings %.300s, want %.300s", got.Settings, want)
				}
			}
		})
	}
}
