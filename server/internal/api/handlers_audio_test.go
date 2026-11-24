package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/audio"
	"qinqin/internal/lexicon"
	"qinqin/internal/pack"
)

type audioEnv struct {
	ts           *httptest.Server
	token        string
	nihao, xing  int64
	sha, xingSHA string
}

// newAudioEnv serves an instance with a generated zh audio pack (synthetic
// Ogg-magic clips, written here and never committed) and two entries.
func newAudioEnv(t *testing.T) audioEnv {
	t.Helper()
	ts, sqlDB, dir := newServerWithDir(t)
	token := registerUser(t, ts.URL, "alice", "")
	ctx := context.Background()

	var dictID int64
	if err := sqlDB.QueryRow(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES ('d', 'd', '1', 'x', 'x', '2026-01-01T00:00:00Z') RETURNING id`).Scan(&dictID); err != nil {
		t.Fatal(err)
	}
	st := lexicon.Store{DB: sqlDB}
	put := func(kind, key string, readings ...string) int64 {
		e := &lexicon.Entry{Language: "zh", Kind: kind, Key: key, Forms: []lexicon.Form{{Text: key}}}
		for _, r := range readings {
			e.Readings = append(e.Readings, lexicon.Reading{Type: "pinyin", Value: r, Plain: r})
		}
		id, err := st.Put(ctx, e, dictID)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	env := audioEnv{ts: ts, token: token}
	env.nihao = put("word", "你好", "nǐ hǎo")
	env.xing = put("character", "行", "xíng", "háng")

	pdir := t.TempDir()
	files := map[string]string{
		"manifest.json": `{"id":"zh-audio","name":"Test audio","version":"1","type":"audio","language":"zh","license":"per file","attribution":"Testers","notice":"Synthetic.","format":"audio-index"}`,
		"index.tsv": "kind\tform\treading\tfile\tlicense\tattribution\tsource\n" +
			"term\t你好\tnǐ hǎo\taudio/t.ogg\tCC0\tAnn\thttps://example.test/t\n" +
			"syllable\t\txing2\taudio/x.ogg\tCC BY 4.0\tBob\t\n",
		"audio/t.ogg": "OggS-term-clip",
		"audio/x.ogg": "OggS-xing-clip",
	}
	for name, content := range files {
		p := filepath.Join(pdir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	pk, err := pack.LoadPack(pdir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := audio.Import(ctx, sqlDB, pk, filepath.Join(dir, "audio")); err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.QueryRow(`SELECT sha256 FROM audio_clips WHERE kind = 'term'`).Scan(&env.sha); err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.QueryRow(`SELECT sha256 FROM audio_clips WHERE kind = 'syllable'`).Scan(&env.xingSHA); err != nil {
		t.Fatal(err)
	}
	return env
}

func (e audioEnv) get(t *testing.T, path, token string, hdr ...string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, e.ts.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func TestAudioRoutesNeedSignIn(t *testing.T) {
	e := newAudioEnv(t)
	for _, path := range []string{
		fmt.Sprintf("/api/audio/entries/%d", e.nihao),
		"/api/audio/clips/" + e.sha + ".ogg",
	} {
		if resp := e.get(t, path, ""); resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("GET %s without a token = %d, want 401", path, resp.StatusCode)
		}
	}
	resp := doJSON(t, http.MethodPost, e.ts.URL, "/api/audio/resolve", "", map[string]any{"entryIds": []int64{e.nihao}})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("POST resolve without a token = %d, want 401", resp.StatusCode)
	}
}

type clipJSON struct {
	URL, PackID, License, Attribution, Source string
}
type resolutionJSON struct {
	Terms     []clipJSON   `json:"terms"`
	Syllables [][]clipJSON `json:"syllables"`
}

func TestAudioEntryResolution(t *testing.T) {
	e := newAudioEnv(t)
	resp := e.get(t, fmt.Sprintf("/api/audio/entries/%d", e.nihao), e.token)
	var got resolutionJSON
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&got) != nil {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if len(got.Terms) != 1 || got.Terms[0].URL != "/api/audio/clips/"+e.sha+".ogg" ||
		got.Terms[0].PackID != "zh-audio" || got.Terms[0].License != "CC0" ||
		got.Terms[0].Attribution != "Ann" || got.Terms[0].Source != "https://example.test/t" {
		t.Errorf("terms = %+v", got.Terms)
	}
	if len(got.Syllables) != 1 || got.Syllables[0] != nil {
		t.Errorf("syllables = %+v, want [null] (hao3 has no clip)", got.Syllables)
	}

	// 行: one slot per pinyin reading; only xíng has a clip.
	resp = e.get(t, fmt.Sprintf("/api/audio/entries/%d", e.xing), e.token)
	got = resolutionJSON{}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if len(got.Syllables) != 2 || len(got.Syllables[0]) != 1 || got.Syllables[1] != nil || got.Terms == nil {
		t.Errorf("行 = %+v", got)
	}

	for _, path := range []string{"/api/audio/entries/999999", "/api/audio/entries/abc"} {
		if resp := e.get(t, path, e.token); resp.StatusCode != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", path, resp.StatusCode)
		}
	}
}

func TestAudioResolveBatch(t *testing.T) {
	e := newAudioEnv(t)
	resp := doJSON(t, http.MethodPost, e.ts.URL, "/api/audio/resolve", e.token,
		map[string]any{"entryIds": []int64{e.nihao, e.xing, 999999}})
	var got map[string]resolutionJSON
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&got) != nil {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if len(got) != 2 || len(got[fmt.Sprint(e.nihao)].Terms) != 1 || len(got[fmt.Sprint(e.xing)].Syllables) != 2 {
		t.Errorf("batch = %+v, want the two known entries", got)
	}

	ids := make([]int64, 201)
	for i := range ids {
		ids[i] = int64(i + 1)
	}
	resp = doJSON(t, http.MethodPost, e.ts.URL, "/api/audio/resolve", e.token, map[string]any{"entryIds": ids})
	if resp.StatusCode != http.StatusUnprocessableEntity {
		t.Errorf("201 ids = %d, want 422", resp.StatusCode)
	}
	big := bytes.Repeat([]byte(" "), 17<<10)
	req, _ := http.NewRequest(http.MethodPost, e.ts.URL+"/api/audio/resolve", bytes.NewReader(append([]byte(`{"entryIds":[]}`), big...)))
	req.Header.Set("Authorization", "Bearer "+e.token)
	r2, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	r2.Body.Close()
	if r2.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("17 KiB body = %d, want 413", r2.StatusCode)
	}
	resp = doJSON(t, http.MethodPost, e.ts.URL, "/api/audio/resolve", e.token, map[string]any{"entryIds": "x"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("malformed = %d, want 400", resp.StatusCode)
	}
}

func TestAudioClipStreaming(t *testing.T) {
	e := newAudioEnv(t)
	resp := e.get(t, "/api/audio/clips/"+e.sha+".ogg", e.token)
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK || string(body) != "OggS-term-clip" {
		t.Fatalf("clip = %d %q", resp.StatusCode, body)
	}
	for k, want := range map[string]string{
		"Content-Type":           "audio/ogg",
		"Cache-Control":          "private, max-age=31536000, immutable",
		"X-Content-Type-Options": "nosniff",
	} {
		if got := resp.Header.Get(k); got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}
	resp = e.get(t, "/api/audio/clips/"+e.sha+".ogg", e.token, "Range", "bytes=0-3")
	body, _ = io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusPartialContent || string(body) != "OggS" {
		t.Errorf("range = %d %q, want 206 OggS", resp.StatusCode, body)
	}

	other := strings.Repeat("a", 64)
	for name, path := range map[string]string{
		"wrong ext":    "/api/audio/clips/" + e.sha + ".mp3",
		"unreferenced": "/api/audio/clips/" + other + ".ogg",
		"uppercase":    "/api/audio/clips/" + strings.ToUpper(e.sha) + ".ogg",
		"dotdot":       "/api/audio/clips/..%2F..%2Fqinqin.db",
		"dotdot2":      "/api/audio/clips/" + e.sha + ".ogg/../../x",
		"no ext":       "/api/audio/clips/" + e.sha,
		"short":        "/api/audio/clips/abc.ogg",
	} {
		if resp := e.get(t, path, e.token); resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s: GET %s = %d, want 404", name, path, resp.StatusCode)
		}
	}
}

func TestAudioPacksPublic(t *testing.T) {
	e := newAudioEnv(t)
	resp := e.get(t, "/api/audio-packs", "")
	var packs []struct {
		PackID, Name, Language, License, Attribution, Notice string
		ClipCount                                            int
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&packs) != nil {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if len(packs) != 1 || packs[0].PackID != "zh-audio" || packs[0].ClipCount != 2 ||
		packs[0].License != "per file" || packs[0].Notice != "Synthetic." || packs[0].Language != "zh" {
		t.Errorf("packs = %+v", packs)
	}
	ts, _ := newServer(t)
	resp = getEntry(t, ts.URL, "/api/audio-packs")
	body, _ := io.ReadAll(resp.Body)
	if strings.TrimSpace(string(body)) != "[]" {
		t.Errorf("no packs = %q, want []", body)
	}
}

func TestAudioCredits(t *testing.T) {
	e := newAudioEnv(t)
	resp := e.get(t, "/api/audio-packs/zh-audio/credits?limit=1", "")
	var got struct {
		Total, Offset, Limit int
		Clips                []struct{ Kind, Form, Reading, License, Attribution, Source string }
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&got) != nil {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if got.Total != 2 || got.Limit != 1 || len(got.Clips) != 1 || got.Clips[0].Attribution != "Ann" || got.Clips[0].Form != "你好" {
		t.Errorf("credits = %+v", got)
	}
	resp = e.get(t, "/api/audio-packs/zh-audio/credits?offset=1&limit=9999", "")
	got = struct {
		Total, Offset, Limit int
		Clips                []struct{ Kind, Form, Reading, License, Attribution, Source string }
	}{}
	_ = json.NewDecoder(resp.Body).Decode(&got)
	if got.Limit != 500 || got.Offset != 1 || len(got.Clips) != 1 || got.Clips[0].Attribution != "Bob" {
		t.Errorf("paged credits = %+v, want limit capped at 500", got)
	}
	if resp := e.get(t, "/api/audio-packs/nope/credits", ""); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown pack = %d, want 404", resp.StatusCode)
	}
	if resp := e.get(t, "/api/audio-packs/zh-audio/credits?limit=x", ""); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("bad limit = %d, want 400", resp.StatusCode)
	}
}
