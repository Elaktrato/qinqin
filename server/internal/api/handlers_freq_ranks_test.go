package api_test

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/freq"
	"qinqin/internal/model"
)

// importFreqPack installs a freq-csv pack with the given rows.
func importFreqPack(t *testing.T, sqlDB *sql.DB, id, language, rows string) int64 {
	t.Helper()
	dir := t.TempDir()
	manifest := fmt.Sprintf(`{"id":%q,"name":"Pack %s","version":"1","type":"frequency","language":%q,`+
		`"license":"CC BY-SA 4.0","attribution":"test","format":"freq-csv"}`, id, id, language)
	for name, body := range map[string]string{"manifest.json": manifest, "freq.csv": "term,reading,rank\n" + rows} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := freq.Import(context.Background(), sqlDB, &p); err != nil {
		t.Fatalf("import %s: %v", id, err)
	}
	var packID int64
	if err := sqlDB.QueryRow(`SELECT id FROM frequency_packs WHERE pack_id = ?`, id).Scan(&packID); err != nil {
		t.Fatal(err)
	}
	return packID
}

// seedRanks seeds the entry excerpts and a ja pack: する (the usually-kana
// 為る by its reading), 刷る, and a row no entry has.
func seedRanks(t *testing.T) (tsURL string, sqlDB *sql.DB, packID int64) {
	t.Helper()
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	packID = importFreqPack(t, sqlDB, "toy-freq", "ja", "する,,1\n無い,,2\n刷る,,3\n")
	return ts.URL, sqlDB, packID
}

type rankBody struct {
	Pack *struct {
		ID          int64  `json:"id"`
		PackID      string `json:"packId"`
		Name        string `json:"name"`
		License     string `json:"license"`
		Attribution string `json:"attribution"`
	} `json:"pack"`
	Ranks []struct {
		ID   int64 `json:"id"`
		Rank int   `json:"rank"`
	} `json:"ranks"`
}

func postRanks(t *testing.T, tsURL, token string, body any) *http.Response {
	t.Helper()
	return doJSON(t, http.MethodPost, tsURL, "/api/entries/frequency-ranks", token, body)
}

func TestFrequencyRanksRequiresSession(t *testing.T) {
	ts, _ := newServer(t)
	if resp := postRanks(t, ts.URL, "", map[string]any{"language": "ja", "ids": []int64{1}}); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("without token: status = %d, want 401", resp.StatusCode)
	}
}

func TestFrequencyRanksRejectsBadBodies(t *testing.T) {
	ts, _ := newServer(t)
	alice := registerUser(t, ts.URL, "alice", "")
	big := make([]int64, 501)
	for i := range big {
		big[i] = int64(i + 1)
	}
	for name, tc := range map[string]struct {
		body any
		msg  string
	}{
		"no ids":   {map[string]any{"language": "ja", "ids": []int64{}}, "1 to 500 entry ids"},
		"501 ids":  {map[string]any{"language": "ja", "ids": big}, "1 to 500 entry ids"},
		"zero id":  {map[string]any{"language": "ja", "ids": []int64{0}}, "1 to 500 entry ids"},
		"language": {map[string]any{"ids": []int64{1}}, "anguage is required"},
		"blank":    {map[string]any{"language": " ", "ids": []int64{1}}, "anguage is required"},
	} {
		resp := postRanks(t, ts.URL, alice, tc.body)
		if text := readAll(t, resp); resp.StatusCode != http.StatusBadRequest || errorCode(t, []byte(text)) != "bad_request" || !strings.Contains(text, tc.msg) {
			t.Errorf("%s: status = %d body %q, want 400 %q", name, resp.StatusCode, text, tc.msg)
		}
	}
	ids := make([]int64, 4000)
	for i := range ids {
		ids[i] = 1000000 + int64(i)
	}
	if resp := postRanks(t, ts.URL, alice, map[string]any{"language": "ja", "ids": ids}); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("over 16 KiB: status = %d, want 413", resp.StatusCode)
	}
}

func TestFrequencyRanksOrderAndOmission(t *testing.T) {
	tsURL, sqlDB, packID := seedRanks(t)
	alice := registerUser(t, tsURL, "alice", "")
	bob := registerUser(t, tsURL, "bob", alice)
	suru := lexID(t, sqlDB, "ja", "word", "j:1157170")
	suru2 := lexID(t, sqlDB, "ja", "word", "j:1397500")
	hao := lexID(t, sqlDB, "zh", "character", "好")
	body := map[string]any{"language": "ja", "ids": []int64{suru2, 999999, hao, suru, suru2}}

	resp := postRanks(t, tsURL, alice, body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	raw := readAll(t, resp)
	var got rankBody
	decodeJSON(t, &http.Response{Body: io.NopCloser(strings.NewReader(raw))}, &got)
	if got.Pack == nil || got.Pack.ID != packID || got.Pack.PackID != "toy-freq" || got.Pack.Name != "Pack toy-freq" ||
		got.Pack.License != "CC BY-SA 4.0" || got.Pack.Attribution != "test" {
		t.Errorf("pack = %+v", got.Pack)
	}
	want := fmt.Sprintf(`[{%d 3} {%d 1}]`, suru2, suru)
	if fmt.Sprint(got.Ranks) != want {
		t.Errorf("ranks = %v, want %s (request order, unknown and zh omitted, duplicate once)", got.Ranks, want)
	}
	// Shared data only: another user gets the same bytes.
	if other := readAll(t, postRanks(t, tsURL, bob, body)); other != raw {
		t.Errorf("bob's answer differs:\n%s\n%s", other, raw)
	}

	// A language without a pack: pack null, no ranks.
	resp = postRanks(t, tsURL, alice, map[string]any{"language": "zh", "ids": []int64{hao}})
	if text := readAll(t, resp); resp.StatusCode != http.StatusOK || strings.TrimSpace(text) != `{"pack":null,"ranks":[]}` {
		t.Errorf("zh: status %d body %s, want {\"pack\":null,\"ranks\":[]}", resp.StatusCode, text)
	}
}

type topBody struct {
	PackID  string `json:"packId"`
	Name    string `json:"name"`
	Size    int    `json:"size"`
	Entries []struct {
		model.EntryBase
		Rank int `json:"rank"`
	} `json:"entries"`
}

func getTop(t *testing.T, tsURL, token string, packID int64, query string) *http.Response {
	t.Helper()
	return doJSON(t, http.MethodGet, tsURL, fmt.Sprintf("/api/frequency-packs/%d/top%s", packID, query), token, nil)
}

func TestFrequencyTopRequiresSession(t *testing.T) {
	tsURL, _, packID := seedRanks(t)
	if resp := getTop(t, tsURL, "", packID, "?size=500"); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("without token: status = %d, want 401", resp.StatusCode)
	}
}

func TestFrequencyTopRejectsBadRequests(t *testing.T) {
	tsURL, sqlDB, packID := seedRanks(t)
	alice := registerUser(t, tsURL, "alice", "")
	for _, q := range []string{"", "?size=3", "?size=abc", "?size=5000"} {
		if resp := getTop(t, tsURL, alice, packID, q); resp.StatusCode != http.StatusBadRequest {
			t.Errorf("size %q: status = %d, want 400", q, resp.StatusCode)
		}
	}
	if resp := getTop(t, tsURL, alice, packID+100, "?size=500"); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown pack: status = %d, want 404", resp.StatusCode)
	}
	if resp := doJSON(t, http.MethodGet, tsURL, "/api/frequency-packs/x/top?size=500", alice, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("non-numeric pack: status = %d, want 404", resp.StatusCode)
	}
	if _, err := sqlDB.Exec(`UPDATE frequency_packs SET deleted_at = '2026-11-16T00:00:00Z' WHERE id = ?`, packID); err != nil {
		t.Fatal(err)
	}
	if resp := getTop(t, tsURL, alice, packID, "?size=500"); resp.StatusCode != http.StatusNotFound {
		t.Errorf("uninstalled pack: status = %d, want 404", resp.StatusCode)
	}
}

func TestFrequencyTopEntriesInRankOrder(t *testing.T) {
	tsURL, sqlDB, packID := seedRanks(t)
	alice := registerUser(t, tsURL, "alice", "")
	bob := registerUser(t, tsURL, "bob", alice)
	suru := lexID(t, sqlDB, "ja", "word", "j:1157170")
	suru2 := lexID(t, sqlDB, "ja", "word", "j:1397500")

	resp := getTop(t, tsURL, alice, packID, "?size=500")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	raw := readAll(t, resp)
	var got topBody
	decodeJSON(t, &http.Response{Body: io.NopCloser(strings.NewReader(raw))}, &got)
	if got.PackID != "toy-freq" || got.Name != "Pack toy-freq" || got.Size != 500 || len(got.Entries) != 2 {
		t.Fatalf("top = %+v", got)
	}
	// 為る is usually kana: the deck shows (and a copy snapshots) する.
	if e := got.Entries[0]; e.ID != suru || e.Rank != 1 || e.Written != "する" || e.Kind != "word" || e.Language != "ja" || len(e.Readings) == 0 {
		t.Errorf("first entry = %+v, want する (為る) rank 1 with its base fields", e)
	}
	if e := got.Entries[1]; e.ID != suru2 || e.Rank != 3 {
		t.Errorf("second entry = %+v, want 刷る rank 3", e)
	}
	if other := readAll(t, getTop(t, tsURL, bob, packID, "?size=500")); other != raw {
		t.Errorf("bob's answer differs:\n%s\n%s", other, raw)
	}

	// A re-import with other rows is answered from the new content.
	importFreqPack(t, sqlDB, "toy-freq", "ja", "刷る,,1\n")
	resp = getTop(t, tsURL, alice, packID, "?size=1000")
	var again topBody
	decodeJSON(t, resp, &again)
	if again.Size != 1000 || len(again.Entries) != 1 || again.Entries[0].ID != suru2 || again.Entries[0].Rank != 1 {
		t.Errorf("after re-import top = %+v, want only 刷る", again)
	}
}

// TestFrequencyTopFollowsDictionaryInstalls: a dictionary installed after
// the first answer resolves rows that were skipped before.
func TestFrequencyTopFollowsDictionaryInstalls(t *testing.T) {
	tsURL, sqlDB, packID := seedRanks(t)
	alice := registerUser(t, tsURL, "alice", "")
	var first topBody
	decodeJSON(t, getTop(t, tsURL, alice, packID, "?size=500"), &first)
	if len(first.Entries) != 2 {
		t.Fatalf("top = %+v, want 2 entries", first)
	}
	lookupImport(t, sqlDB, dict.Manifest{
		ID: "jmdict-more", Name: "JMdict more", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	}, "jmdict.xml", `<?xml version="1.0" encoding="UTF-8"?>
<JMdict>
<entry>
<ent_seq>1529520</ent_seq>
<k_ele><keb>無い</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>ない</reb><re_pri>ichi1</re_pri></r_ele>
<sense><gloss>nonexistent</gloss></sense>
</entry>
</JMdict>
`)
	var second topBody
	decodeJSON(t, getTop(t, tsURL, alice, packID, "?size=500"), &second)
	if len(second.Entries) != 3 || second.Entries[1].Written != "無い" || second.Entries[1].Rank != 2 {
		t.Errorf("after the install top = %+v, want 無い second", second)
	}
}
