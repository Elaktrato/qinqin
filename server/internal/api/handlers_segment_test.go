package api_test

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// seedSegmentWords upserts zh 学 (character) and 学习 (word), returning the
// word's id.
func seedSegmentWords(t *testing.T) (tsURL string, wordID int64) {
	t.Helper()
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	st := entries.Store{DB: sqlDB}
	r := []model.Reading{{Type: "pinyin", Value: "x"}}
	mustUpsertEntry(t, st, &model.Entry{Language: "zh", Kind: "character", Written: "学", Readings: r})
	wordID = mustUpsertEntry(t, st, &model.Entry{Language: "zh", Kind: "word", Written: "学习", Readings: r})
	return ts.URL, wordID
}

type segmentMatchBody struct {
	Surface string `json:"surface"`
	Start   int    `json:"start"`
	End     int    `json:"end"`
	Lemma   string `json:"lemma"`
	Reason  string `json:"reason"`
	Entries []struct {
		ID   int64  `json:"id"`
		Kind string `json:"kind"`
	} `json:"entries"`
}

func segmentAtPath(language, text, offset string) string {
	q := url.Values{"lang": {language}, "text": {text}, "offset": {offset}}
	return "/api/segment/at?" + q.Encode()
}

func TestSegmentAt(t *testing.T) {
	tsURL, wordID := seedSegmentWords(t)
	resp := doJSON(t, http.MethodGet, tsURL, segmentAtPath("zh", "我学习", "1"), "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var body struct {
		Match *segmentMatchBody `json:"match"`
	}
	decodeJSON(t, resp, &body)
	m := body.Match
	if m == nil || m.Surface != "学习" || m.Start != 1 || m.End != 3 || m.Lemma != "学习" || m.Reason != "" {
		t.Fatalf("match = %+v, want 学习 1..3", m)
	}
	if len(m.Entries) != 1 || m.Entries[0].ID != wordID || m.Entries[0].Kind != "word" {
		t.Errorf("entries = %+v, want the word %d", m.Entries, wordID)
	}
}

func TestSegmentAtNoMatch(t *testing.T) {
	tsURL, _ := seedSegmentWords(t)
	resp := doJSON(t, http.MethodGet, tsURL, segmentAtPath("zh", "，学", "0"), "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	raw, _ := io.ReadAll(resp.Body)
	if got := strings.TrimSpace(string(raw)); got != `{"match":null}` {
		t.Errorf("body = %s, want {\"match\":null}", got)
	}
}

func TestSegmentAtBadOffset(t *testing.T) {
	tsURL, _ := seedSegmentWords(t)
	for _, path := range []string{
		segmentAtPath("zh", "学", "x"),
		segmentAtPath("zh", "学", ""),
		segmentAtPath("", "学", "0"),
		segmentAtPath("zh", "", "0"),
	} {
		resp := doJSON(t, http.MethodGet, tsURL, path, "", nil)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400", path, resp.StatusCode)
		}
	}
}

func TestSegmentBatch(t *testing.T) {
	tsURL, _ := seedSegmentWords(t)
	tok := registerUser(t, tsURL, "reader", "")
	resp := doJSON(t, http.MethodPost, tsURL, "/api/segment", tok,
		map[string]string{"lang": "zh", "text": "我学习学"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var body struct {
		Matches []segmentMatchBody `json:"matches"`
	}
	decodeJSON(t, resp, &body)
	if len(body.Matches) != 2 || body.Matches[0].Surface != "学习" || body.Matches[0].Start != 1 ||
		body.Matches[1].Surface != "学" || body.Matches[1].Start != 3 {
		t.Errorf("matches = %+v, want 学习@1 then 学@3", body.Matches)
	}

	resp = doJSON(t, http.MethodPost, tsURL, "/api/segment", tok, map[string]string{"lang": "zh", "text": "。"})
	raw, _ := io.ReadAll(resp.Body)
	if got := strings.TrimSpace(string(raw)); got != `{"matches":[]}` {
		t.Errorf("empty body = %s, want {\"matches\":[]}", got)
	}

	resp = doJSON(t, http.MethodPost, tsURL, "/api/segment", tok, map[string]string{"text": "学"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("missing lang = %d, want 400", resp.StatusCode)
	}
}

func TestSegmentBatchRequiresUser(t *testing.T) {
	tsURL, _ := seedSegmentWords(t)
	resp := doJSON(t, http.MethodPost, tsURL, "/api/segment", "",
		map[string]string{"lang": "zh", "text": "学习"})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("anonymous POST /api/segment = %d, want 401", resp.StatusCode)
	}
}

func TestSegmentBatchTooLarge(t *testing.T) {
	tsURL, _ := seedSegmentWords(t)
	tok := registerUser(t, tsURL, "reader", "")
	resp := doJSON(t, http.MethodPost, tsURL, "/api/segment", tok,
		map[string]string{"lang": "zh", "text": strings.Repeat("学", 256<<10)})
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413", resp.StatusCode)
	}
}

func TestSegmentTextRuneCaps(t *testing.T) {
	tsURL, _ := seedSegmentWords(t)
	tok := registerUser(t, tsURL, "reader", "")
	post := func(n int) int {
		resp := doJSON(t, http.MethodPost, tsURL, "/api/segment", tok,
			map[string]string{"lang": "zh", "text": strings.Repeat("学", n)})
		return resp.StatusCode
	}
	if got := post(5000); got != http.StatusOK {
		t.Errorf("5000 runes = %d, want 200", got)
	}
	if got := post(5001); got != http.StatusRequestEntityTooLarge {
		t.Errorf("5001 runes = %d, want 413", got)
	}
	resp := doJSON(t, http.MethodGet, tsURL, segmentAtPath("zh", strings.Repeat("学", 64), "0"), "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Errorf("GET at 64 runes = %d, want 200", resp.StatusCode)
	}
	resp = doJSON(t, http.MethodGet, tsURL, segmentAtPath("zh", strings.Repeat("学", 65), "0"), "", nil)
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("GET at 65 runes = %d, want 413", resp.StatusCode)
	}
}

func TestSegmentUnsupportedLanguage(t *testing.T) {
	tsURL, _ := seedSegmentWords(t)
	tok := registerUser(t, tsURL, "reader", "")
	resp := doJSON(t, http.MethodGet, tsURL, segmentAtPath("xx", "学", "0"), "", nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("GET at unknown lang = %d, want 400", resp.StatusCode)
	}
	resp = doJSON(t, http.MethodPost, tsURL, "/api/segment", tok, map[string]string{"lang": "xx", "text": "学"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("POST unknown lang = %d, want 400", resp.StatusCode)
	}
}

func TestSegmentAtOutOfRangeOffset(t *testing.T) {
	tsURL, _ := seedSegmentWords(t)
	for _, off := range []string{"-1", "5"} {
		resp := doJSON(t, http.MethodGet, tsURL, segmentAtPath("zh", "学", off), "", nil)
		raw, _ := io.ReadAll(resp.Body)
		if got := strings.TrimSpace(string(raw)); resp.StatusCode != http.StatusOK || got != `{"match":null}` {
			t.Errorf("offset %s = %d %s, want 200 {\"match\":null}", off, resp.StatusCode, got)
		}
	}
}
