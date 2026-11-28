package segment_test

import (
	"strings"
	"testing"

	"qinqin/internal/segment"
)

func TestParseRulesRefusesBadFiles(t *testing.T) {
	ok := `{"format": 1, "language": "xx", "costs": {"token": 100, "weakReading": 70, "noPriorityKana": 30, "kanjiSplit": 100, "unmatched": 250}, "splitWords": [], "functionPos": ["prt"], "functionWords": ["は"]}`
	if _, err := segment.ParseRules([]byte(ok)); err != nil {
		t.Fatalf("valid rules: %v", err)
	}
	for name, text := range map[string]string{
		"unknown key":                 strings.Replace(ok, `"format": 1`, `"format": 1, "extra": 1`, 1),
		"trailing data":               ok + ` {}`,
		"format 2":                    strings.Replace(ok, `"format": 1`, `"format": 2`, 1),
		"unmatched not above a token": strings.Replace(ok, `"unmatched": 250`, `"unmatched": 200`, 1),
		"zero token":                  strings.Replace(ok, `"token": 100`, `"token": 0`, 1),
		"negative cost":               strings.Replace(ok, `"kanjiSplit": 100`, `"kanjiSplit": -1`, 1),
		"no function words":           strings.Replace(ok, `["は"]`, `[]`, 1),
		"empty function part":         strings.Replace(ok, `["prt"]`, `["prt", ""]`, 1),
		"empty split word":            strings.Replace(ok, `"splitWords": []`, `"splitWords": [""]`, 1),
	} {
		if _, err := segment.ParseRules([]byte(text)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
