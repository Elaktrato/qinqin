package i18n

import "encoding/json"

// WorkspaceLanguageKey is the workspace-settings key of a workspace's own
// interface language (#297, docs/contracts/settings/interface-language.json).
const WorkspaceLanguageKey = "interfaceLanguage"

// WorkspaceSetting reads a workspace's own interface language from its
// settings object: a well-formed, non-empty tag, or "" ("use my account
// setting") for no settings, no key, or any other value.
func WorkspaceSetting(settings json.RawMessage) string {
	var obj map[string]json.RawMessage
	if len(settings) == 0 || json.Unmarshal(settings, &obj) != nil {
		return ""
	}
	var tag string
	if raw, ok := obj[WorkspaceLanguageKey]; !ok || json.Unmarshal(raw, &tag) != nil {
		return ""
	}
	if tag == "" || !IsLanguageSetting(tag) {
		return ""
	}
	return tag
}

// ApplyingSetting is the interface-language setting that applies in a
// workspace: its own when it has one, else the account's ("" = follow the
// browser). Pick negotiates it.
func ApplyingSetting(workspace, account string) string {
	if workspace != "" {
		return workspace
	}
	return account
}

// CommonSetting is the setting of a text about several workspaces (a
// reminder mail counts every workspace with live facts): the applying
// setting they share, else the account's — also when there are none.
// `workspaces` holds each workspace's own setting (WorkspaceSetting).
func CommonSetting(account string, workspaces []string) string {
	if len(workspaces) == 0 {
		return account
	}
	common := ApplyingSetting(workspaces[0], account)
	for _, w := range workspaces[1:] {
		if ApplyingSetting(w, account) != common {
			return account
		}
	}
	return common
}
