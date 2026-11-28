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

// The Chinese keys (#349): function words by reading, level costs, the
// compound rule and the readings table.
func TestParseRulesChineseKeys(t *testing.T) {
	ok := `{"format": 1, "language": "xx", "costs": {"token": 100, "weakReading": 0, "noPriorityKana": 0, "kanjiSplit": 0, "unmatched": 300, "levelStep": 10, "unlisted": 80}, "compounds": "parts", "partFunctionWords": ["的"], "functionPos": [], "functionWords": ["的"], "functionReadings": {"的": "de"}, "readings": {"长": "cháng"}}`
	if _, err := segment.ParseRules([]byte(ok)); err != nil {
		t.Fatalf("valid rules: %v", err)
	}
	for name, text := range map[string]string{
		"function word without a reading": strings.Replace(ok, `{"的": "de"}`, `{}`, 1),
		"reading of no function word":     strings.Replace(ok, `{"的": "de"}`, `{"的": "de", "了": "le"}`, 1),
		"empty function reading":          strings.Replace(ok, `{"的": "de"}`, `{"的": ""}`, 1),
		"unknown compounds rule":          strings.Replace(ok, `"parts"`, `"whole"`, 1),
		"part word that is no function":   strings.Replace(ok, `"partFunctionWords": ["的"]`, `"partFunctionWords": ["了"]`, 1),
		"empty reading":                   strings.Replace(ok, `{"长": "cháng"}`, `{"长": ""}`, 1),
		"unmatched not above unlisted":    strings.Replace(ok, `"unmatched": 300`, `"unmatched": 180`, 1),
		"level step out of range":         strings.Replace(ok, `"levelStep": 10`, `"levelStep": 10001`, 1),
	} {
		if _, err := segment.ParseRules([]byte(text)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
