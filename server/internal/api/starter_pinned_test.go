package api_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"qinqin/internal/realdict"
)

// #345, #346 on the shipped CC-CEDICT: each Starter entry carries the set's pinned reading, and its gloss is the
// first everyday gloss of that reading — never a surname, abbreviation, variant or slang line.
func TestStarterSetGlossesFollowThePinnedReading(t *testing.T) {
	ts, sqlDB, _ := newServerWithDir(t)
	realdict.Import(t, sqlDB, "zh", "猫", "喝", "书", "水", "三", "马", "鸡", "蛇")
	token := registerUser(t, ts.URL, "alice", "")
	code, raw := getStarter(t, ts.URL, "/api/starter-sets/starter-zh", token)
	if code != http.StatusOK {
		t.Fatalf("status %d: %s", code, raw)
	}
	var body struct {
		Entries []struct {
			Written string `json:"written"`
			Reading string `json:"reading"`
			Gloss   string `json:"gloss"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	got := map[string][2]string{}
	for _, e := range body.Entries {
		got[e.Written] = [2]string{e.Reading, e.Gloss}
	}
	for word, want := range map[string][2]string{
		"猫": {"māo", "cat (CL:隻|只[zhi1])"},
		"喝": {"hē", "to drink"},
		"书": {"shū", "book"},
		"水": {"shuǐ", "water"},
		"三": {"", "three"},
		"马": {"", "horse"},
		"鸡": {"", "fowl"},
		"蛇": {"shé", "snake"},
	} {
		if got[word] != want {
			t.Errorf("%s = %q, want %q", word, got[word], want)
		}
	}
}
