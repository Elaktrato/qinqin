package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestShippedRulesLoad(t *testing.T) {
	r, err := loadRules("rules.json")
	if err != nil {
		t.Fatalf("rules.json: %v", err)
	}
	for _, code := range []string{"zh", "ja"} {
		l, ok := r.Languages[code]
		if !ok {
			t.Fatalf("rules.json lacks %s", code)
		}
		if l.PackID != code+"-sentences-tatoeba" {
			t.Errorf("%s pack id = %q", code, l.PackID)
		}
	}
	if r.Languages["zh"].Tatoeba != "cmn" || r.Languages["ja"].Tatoeba != "jpn" || r.TranslationLanguage != "eng" {
		t.Errorf("language codes: %+v", r)
	}
	if r.Languages["zh"].Dictionary != "plugins/data/cedict" || r.Languages["ja"].Dictionary != "plugins/data/jmdict" {
		t.Errorf("dictionaries: %q %q", r.Languages["zh"].Dictionary, r.Languages["ja"].Dictionary)
	}
}

const rulesBody = `{
  "translationLanguage": "eng",
  "maxTranslationRunes": 100,
  "dropOrphans": true,
  "dropNegativeReviews": true,
  "nativeOnly": false,
  "nativeSkill": "5",
  "dropTags": ["@needs native check"],
  "denyTags": [],
  "maxPerWord": 3,
  "sampleSize": 10,
  "languages": {
    "zh": {"tatoeba": "cmn", "packId": "zh-sentences-tatoeba", "name": "N", "dictionary": "d", "readingType": "pinyin",
           "minRunes": 4, "maxRunes": 30, "minCoverage": 1, "denyWords": [], "skipWords": [], "defaultReadings": {}}
  }
}`

func TestLoadRulesRejectsBadRules(t *testing.T) {
	dir := t.TempDir()
	for name, body := range map[string]string{
		"unknown field":   strings.Replace(rulesBody, `"maxPerWord": 3`, `"maxPerWord": 3, "maxPerWrod": 4`, 1),
		"min above max":   strings.Replace(rulesBody, `"minRunes": 4`, `"minRunes": 40`, 1),
		"zero cap":        strings.Replace(rulesBody, `"maxPerWord": 3`, `"maxPerWord": 0`, 1),
		"coverage > 1":    strings.Replace(rulesBody, `"minCoverage": 1`, `"minCoverage": 1.5`, 1),
		"no pack id":      strings.Replace(rulesBody, `"packId": "zh-sentences-tatoeba", `, "", 1),
		"bad reading":     strings.Replace(rulesBody, `"readingType": "pinyin"`, `"readingType": "romaji"`, 1),
		"no translation":  strings.Replace(rulesBody, `"translationLanguage": "eng"`, `"translationLanguage": ""`, 1),
		"unknown lang":    strings.Replace(rulesBody, `"zh": {`, `"xx": {`, 1),
		"no translations": strings.Replace(rulesBody, `"maxTranslationRunes": 100`, `"maxTranslationRunes": 0`, 1),
	} {
		path := filepath.Join(dir, strings.ReplaceAll(name, " ", "-")+".json")
		writeFile(t, path, body)
		if _, err := loadRules(path); err == nil {
			t.Errorf("%s: loadRules accepted it", name)
		}
	}
	path := filepath.Join(dir, "ok.json")
	writeFile(t, path, rulesBody)
	if _, err := loadRules(path); err != nil {
		t.Errorf("valid rules: %v", err)
	}
}
