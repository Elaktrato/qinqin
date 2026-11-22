package main

import (
	"slices"
	"testing"
)

const fixtureRules = "testdata/rules.json"

func fixture(t *testing.T) (*export, Rules) {
	t.Helper()
	p, err := loadPin(fixturePin)
	if err != nil {
		t.Fatal(err)
	}
	r, err := loadRules(fixtureRules)
	if err != nil {
		t.Fatal(err)
	}
	ex, err := loadExport(fixtureExport, p, []string{"cmn", "jpn"}, "eng")
	if err != nil {
		t.Fatalf("loadExport: %v", err)
	}
	return ex, r
}

func ids(cs []*candidate) []int64 {
	var out []int64
	for _, c := range cs {
		out = append(out, c.s.ID)
	}
	slices.Sort(out)
	return out
}

func TestLoadExportClassifiesLicences(t *testing.T) {
	ex, _ := fixture(t)
	for id, want := range map[int64]string{
		1001: licenceBY,
		1011: licenceCC0, // in sentences_CC0 with the same text
		1018: licenceBY,  // in sentences_CC0, but with another text
		2011: licenceCC0,
		4002: licenceCC0,
		2001: licenceBY,
	} {
		s := ex.sentences[id]
		if s == nil {
			t.Errorf("sentence %d not loaded", id)
			continue
		}
		if s.Licence != want {
			t.Errorf("sentence %d licence = %q, want %q", id, s.Licence, want)
		}
	}
	// Only the pack languages and their linked English translations are
	// kept: not yue, and no English sentence nobody links to.
	if ex.sentences[1020] != nil {
		t.Error("a yue sentence was loaded")
	}
	if ex.sentences[1007] == nil || ex.sentences[1007].Owner != "" {
		t.Error("orphan 1007 should load with an empty owner")
	}
	if got := ex.links[1013]; !slices.Equal(got, []int64{2013, 2014, 2015}) {
		t.Errorf("links of 1013 = %v", got)
	}
	if !ex.negative[1009] || ex.negative[1001] {
		t.Errorf("negative reviews = %v", ex.negative)
	}
	if ex.skill("cmn", "lin") != "5" || ex.skill("eng", "tom") != "2" {
		t.Errorf("skills = %v", ex.skills)
	}
}

func TestFilterLanguageChinese(t *testing.T) {
	ex, r := fixture(t)
	kept, read, drops := filterLanguage(ex, r, r.Languages["zh"])
	if read != 19 {
		t.Errorf("read %d cmn sentences, want 19", read)
	}
	want := map[string]int{
		stepOrphan: 1, stepNativeOnly: 0, stepTag: 1, stepDenyTag: 1, stepReview: 1,
		stepLength: 2, stepDenyWord: 1, stepTranslation: 1, stepDuplicate: 1,
	}
	for step, n := range want {
		if drops.n[step] != n {
			t.Errorf("%s dropped %d, want %d", step, drops.n[step], n)
		}
	}
	if got := ids(kept); !slices.Equal(got, []int64{1001, 1002, 1003, 1004, 1011, 1013, 1014, 1017, 1018, 1019}) {
		t.Errorf("kept %v", got)
	}
	byID := map[int64]*candidate{}
	for _, c := range kept {
		byID[c.s.ID] = c
	}
	// A native English owner beats a lower id; an orphan is never used.
	if tr := byID[1013].tr; tr.ID != 2015 {
		t.Errorf("translation of 1013 = %d, want 2015 (native owner)", tr.ID)
	}
	if !byID[1001].native || byID[1003].native {
		t.Error("native flags wrong")
	}
	// The near-duplicate 1005 lost to 1001 (native owner).
	if byID[1005] != nil {
		t.Error("near-duplicate 1005 kept")
	}
}

func TestFilterLanguageJapanese(t *testing.T) {
	ex, r := fixture(t)
	kept, read, drops := filterLanguage(ex, r, r.Languages["ja"])
	if read != 8 || drops.n[stepDuplicate] != 1 {
		t.Errorf("read %d, duplicates %d; want 8, 1", read, drops.n[stepDuplicate])
	}
	if got := ids(kept); !slices.Equal(got, []int64{3001, 3002, 3003, 3004, 3005, 3006, 3007}) {
		t.Errorf("kept %v", got)
	}
	for _, c := range kept {
		if c.s.ID == 3002 && c.tr.ID != 4002 {
			t.Errorf("translation of 3002 = %d, want 4002 (4003 is tagged @change)", c.tr.ID)
		}
	}
}

func TestFilterNativeOnly(t *testing.T) {
	ex, r := fixture(t)
	r.NativeOnly = true
	kept, _, drops := filterLanguage(ex, r, r.Languages["zh"])
	for _, c := range kept {
		if !c.native {
			t.Errorf("nativeOnly kept %d", c.s.ID)
		}
	}
	if drops.n[stepNativeOnly] == 0 {
		t.Error("nativeOnly dropped nothing")
	}
}

func TestDupKey(t *testing.T) {
	if dupKey("我喜欢学习汉语。") != dupKey("我喜欢 学习汉语！") || dupKey("Ｈｅｌｌｏ!") != dupKey("hello") {
		t.Error("dupKey must ignore punctuation, spaces, width and case")
	}
	if dupKey("我喜欢") == dupKey("我喜歡") {
		t.Error("dupKey must not merge different characters")
	}
}
