package i18n_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/i18n"
)

// docs/contracts/settings/interface-language.json (#297): the workspace's
// interface language, the setting that applies, and the reminder mail's.
type workspaceLanguageFixture struct {
	Rule  string `json:"rule"`
	Key   string `json:"key"`
	Parse []struct {
		Name     string          `json:"name"`
		Settings json.RawMessage `json:"settings"`
		Expect   string          `json:"expect"`
	} `json:"parse"`
	Resolve []struct {
		Name      string          `json:"name"`
		Workspace json.RawMessage `json:"workspace"`
		Account   string          `json:"account"`
		Browser   []string        `json:"browser"`
		Supported []string        `json:"supported"`
		Expect    string          `json:"expect"`
	} `json:"resolve"`
	Reminder []struct {
		Name       string            `json:"name"`
		Account    string            `json:"account"`
		Workspaces []json.RawMessage `json:"workspaces"`
		Expect     string            `json:"expect"`
	} `json:"reminder"`
}

func readWorkspaceLanguageFixture(t *testing.T) workspaceLanguageFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "contracts", "settings", "interface-language.json"))
	if err != nil {
		t.Fatal(err)
	}
	var f workspaceLanguageFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	if f.Rule != "settings/interface-language" || f.Key != i18n.WorkspaceLanguageKey {
		t.Fatalf("fixture names rule %q key %q", f.Rule, f.Key)
	}
	return f
}

func TestWorkspaceSettingFixture(t *testing.T) {
	f := readWorkspaceLanguageFixture(t)
	if len(f.Parse) < 10 {
		t.Fatalf("only %d parse cases", len(f.Parse))
	}
	for _, c := range f.Parse {
		if got := i18n.WorkspaceSetting(c.Settings); got != c.Expect {
			t.Errorf("parse %s: %q, want %q", c.Name, got, c.Expect)
		}
	}
}

func TestApplyingSettingFixture(t *testing.T) {
	f := readWorkspaceLanguageFixture(t)
	if len(f.Resolve) < 8 {
		t.Fatalf("only %d resolve cases", len(f.Resolve))
	}
	for _, c := range f.Resolve {
		var setting string
		if string(c.Workspace) == "null" || len(c.Workspace) == 0 {
			setting = c.Account
		} else {
			setting = i18n.ApplyingSetting(i18n.WorkspaceSetting(c.Workspace), c.Account)
		}
		// The server's "browser" is the request's Accept-Language.
		if got := i18n.Pick(setting, strings.Join(c.Browser, ", "), c.Supported); got != c.Expect {
			t.Errorf("resolve %s: %q, want %q", c.Name, got, c.Expect)
		}
	}
}

func TestReminderSettingFixture(t *testing.T) {
	f := readWorkspaceLanguageFixture(t)
	if len(f.Reminder) < 5 {
		t.Fatalf("only %d reminder cases", len(f.Reminder))
	}
	for _, c := range f.Reminder {
		own := make([]string, 0, len(c.Workspaces))
		for _, w := range c.Workspaces {
			own = append(own, i18n.WorkspaceSetting(w))
		}
		if got := i18n.CommonSetting(c.Account, own); got != c.Expect {
			t.Errorf("reminder %s: %q, want %q", c.Name, got, c.Expect)
		}
	}
}
