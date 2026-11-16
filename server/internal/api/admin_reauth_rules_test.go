package api

import (
	"encoding/json"
	"os"
	"testing"

	"qinqin/internal/auth"
)

// docs/contracts/auth/admin-reauth.json pins when a PATCH needs the acting
// administrator's re-authentication; the web app reads the same cases.
func TestAdminReauthRulesMatchTheContract(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/contracts/auth/admin-reauth.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		UserPatch []struct {
			Name   string
			Self   bool
			Target struct{ Admin bool }
			Patch  map[string]json.RawMessage
			Reauth bool
		} `json:"userPatch"`
		AuthSettings []struct {
			Name    string
			Current struct {
				Registration   string `json:"registration"`
				EmailPolicy    string `json:"emailPolicy"`
				MFAEnforced    bool   `json:"mfaEnforced"`
				EmailCodeLogin bool   `json:"emailCodeLogin"`
			}
			Patch  json.RawMessage
			Reauth bool
		} `json:"authSettings"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(fx.UserPatch) == 0 || len(fx.AuthSettings) == 0 {
		t.Fatal("empty fixture")
	}
	for _, c := range fx.UserPatch {
		var p userPatchChange
		if v, ok := c.Patch["admin"]; ok {
			p.Admin = new(bool)
			json.Unmarshal(v, p.Admin)
		}
		if v, ok := c.Patch["disabled"]; ok {
			p.Disabled = new(bool)
			json.Unmarshal(v, p.Disabled)
		}
		_, p.SetEmail = c.Patch["email"]
		if got := userPatchNeedsReauth(c.Target.Admin, c.Self, p); got != c.Reauth {
			t.Errorf("userPatch %q: reauth %v, fixture says %v", c.Name, got, c.Reauth)
		}
	}
	for _, c := range fx.AuthSettings {
		var p struct {
			Registration   *string `json:"registration"`
			EmailPolicy    *string `json:"emailPolicy"`
			MFAEnforced    *bool   `json:"mfaEnforced"`
			EmailCodeLogin *bool   `json:"emailCodeLogin"`
			SignOutOthers  bool    `json:"signOutOthers"`
		}
		if err := json.Unmarshal(c.Patch, &p); err != nil {
			t.Fatal(err)
		}
		cur := auth.Settings{Registration: c.Current.Registration, EmailPolicy: c.Current.EmailPolicy, MFAEnforced: c.Current.MFAEnforced, EmailCodeLogin: c.Current.EmailCodeLogin}
		sp := auth.SettingsPatch{Registration: p.Registration, EmailPolicy: p.EmailPolicy, MFAEnforced: p.MFAEnforced, EmailCodeLogin: p.EmailCodeLogin}
		if got := settingsPatchNeedsReauth(cur, sp, p.SignOutOthers); got != c.Reauth {
			t.Errorf("authSettings %q: reauth %v, fixture says %v", c.Name, got, c.Reauth)
		}
	}
}
