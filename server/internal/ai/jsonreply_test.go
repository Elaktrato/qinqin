package ai

import (
	"errors"
	"strings"
	"testing"
)

func TestDecodeStrict(t *testing.T) {
	type out struct {
		Text       string `json:"text"`
		Unreadable bool   `json:"unreadable"`
	}
	req := []string{"text", "unreadable"}
	ok := []string{
		`{"text":"a","unreadable":false}`,
		"  \n{\"text\":\"a\",\"unreadable\":false}\n ",
		"```json\n{\"text\":\"a\",\"unreadable\":false}\n```",
		"```\n{\"text\":\"a\",\"unreadable\":false}\n```",
		`{"text":"","unreadable":true}`,
	}
	for _, s := range ok {
		var o out
		if err := decodeStrict(s, &o, req); err != nil {
			t.Errorf("decodeStrict(%q) = %v", s, err)
		}
	}
	bad := map[string]string{
		"empty":        "",
		"whitespace":   " \n\t ",
		"extra field":  `{"text":"a","unreadable":false,"note":"x"}`,
		"missing":      `{"text":"a"}`,
		"null":         `{"text":null,"unreadable":false}`,
		"not json":     `here you go: {"text":"a","unreadable":false}`,
		"trailing":     `{"text":"a","unreadable":false} thanks`,
		"two objects":  `{"text":"a","unreadable":false}{"text":"b","unreadable":false}`,
		"array":        `[{"text":"a","unreadable":false}]`,
		"wrong type":   `{"text":1,"unreadable":false}`,
		"double fence": "```json\n```json\n{\"text\":\"a\",\"unreadable\":false}\n```\n```",
	}
	for name, s := range bad {
		var o out
		err := decodeStrict(s, &o, req)
		if err == nil {
			t.Errorf("%s: accepted %q", name, s)
		}
	}
}

func TestRepairMessage(t *testing.T) {
	long := strings.Repeat("é", 5000)
	m := repairMessage(long, errors.New(`json: unknown field "note"`))
	if n := strings.Count(m, "é"); n > 2000 {
		t.Errorf("bad output echoed %d runes, want at most 2000", n)
	}
	if !strings.Contains(m, `unknown field "note"`) || !strings.Contains(strings.ToLower(m), "json") {
		t.Errorf("message = %q", m)
	}
}
