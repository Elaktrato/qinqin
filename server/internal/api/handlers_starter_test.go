package api_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"qinqin/internal/lexicon"
)

func getStarter(t *testing.T, base, path, token string) (int, []byte) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, base+path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, raw
}

func TestStarterSetsListIsPublic(t *testing.T) {
	ts, _, _ := newServerWithDir(t)
	code, raw := getStarter(t, ts.URL, "/api/starter-sets", "")
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	var list []struct {
		ID            string `json:"id"`
		Language      string `json:"language"`
		License       string `json:"license"`
		WordCount     int    `json:"wordCount"`
		HumanReviewed bool   `json:"humanReviewed"`
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatal(err)
	}
	seen := map[string]int{}
	for _, s := range list {
		seen[s.Language] = s.WordCount
		if s.License == "" {
			t.Errorf("%s has no licence", s.ID)
		}
	}
	if seen["ja"] == 0 || seen["zh"] == 0 {
		t.Errorf("sets by language = %v, want ja and zh", seen)
	}
}

func TestStarterSetNeedsSignInAndKnowsItsIDs(t *testing.T) {
	ts, _, _ := newServerWithDir(t)
	if code, _ := getStarter(t, ts.URL, "/api/starter-sets/starter-ja", ""); code != http.StatusUnauthorized {
		t.Errorf("anonymous = %d, want 401", code)
	}
	token := registerUser(t, ts.URL, "alice", "")
	if code, _ := getStarter(t, ts.URL, "/api/starter-sets/nope", token); code != http.StatusNotFound {
		t.Errorf("unknown set = %d, want 404", code)
	}
}

// The words the installed dictionaries have, in the set's order; the rest are left out.
func TestStarterSetResolvesInSetOrder(t *testing.T) {
	ts, sqlDB, _ := newServerWithDir(t)
	token := registerUser(t, ts.URL, "alice", "")
	var dictID int64
	if err := sqlDB.QueryRow(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES ('d', 'd', '1', 'x', 'x', '2026-01-01T00:00:00Z') RETURNING id`).Scan(&dictID); err != nil {
		t.Fatal(err)
	}
	st := lexicon.Store{DB: sqlDB}
	put := func(key, form, kana string) int64 {
		e := &lexicon.Entry{Language: "ja", Kind: "word", Key: key, Forms: []lexicon.Form{{Text: form}},
			Readings: []lexicon.Reading{{Type: "kana", Value: kana, Plain: kana}},
			Senses:   []lexicon.Sense{{Glosses: []string{"gloss of " + form}}}}
		id, err := st.Put(context.Background(), e, dictID)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	// inserted out of set order: 猫 (second in the set) before 犬 (first)
	cat := put("j:2", "猫", "ねこ")
	dog := put("j:1", "犬", "いぬ")

	code, raw := getStarter(t, ts.URL, "/api/starter-sets/starter-ja", token)
	if code != http.StatusOK {
		t.Fatalf("status %d: %s", code, raw)
	}
	var body struct {
		ID      string `json:"id"`
		Entries []struct {
			ID             int64  `json:"id"`
			Written        string `json:"written"`
			Gloss          string `json:"gloss"`
			PictureConcept string `json:"pictureConcept"`
		} `json:"entries"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	if body.ID != "starter-ja" || len(body.Entries) != 2 {
		t.Fatalf("body = %s", raw)
	}
	if body.Entries[0].ID != dog || body.Entries[1].ID != cat {
		t.Errorf("order = %d, %d; want the set's order %d (犬), %d (猫)", body.Entries[0].ID, body.Entries[1].ID, dog, cat)
	}
	if body.Entries[0].Written != "犬" || body.Entries[0].Gloss != "gloss of 犬" || body.Entries[0].PictureConcept != "1F415" {
		t.Errorf("first entry = %+v", body.Entries[0])
	}
}
