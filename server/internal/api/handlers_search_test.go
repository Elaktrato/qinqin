package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/levels"
	"qinqin/internal/model"
)

// searchHitBody mirrors one element of GET /api/search.
type searchHitBody struct {
	model.EntryBase
	Source string `json:"source"`
}

func TestSearchEndpoint(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	pack, err := dict.LoadPack(writeLevelsPack(t, "chars",
		`{"unit":"hanzi","levels":[{"name":"1","entries":["好"]},{"name":"2","entries":["行"]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := levels.Import(context.Background(), sqlDB, pack); err != nil {
		t.Fatal(err)
	}
	hao := lexID(t, sqlDB, "zh", "character", "好")
	xing := lexID(t, sqlDB, "zh", "character", "行")
	suru := lexID(t, sqlDB, "ja", "word", "j:1157170")

	search := func(query string) (int, []searchHitBody) {
		resp := doJSON(t, http.MethodGet, ts.URL, "/api/search?"+query, "", nil)
		if resp.StatusCode != http.StatusOK {
			return resp.StatusCode, nil
		}
		var hits []searchHitBody
		decodeJSON(t, resp, &hits)
		return resp.StatusCode, hits
	}
	type hit struct {
		id     int64
		source string
	}
	hitsOf := func(hs []searchHitBody) []hit {
		out := []hit{}
		for _, h := range hs {
			out = append(out, hit{h.ID, h.Source})
		}
		return out
	}

	// Public, language-scoped, tone-insensitive; the hit carries the
	// entry fields the web reads, radicalId included.
	status, hits := search("q=hao&lang=zh")
	if status != http.StatusOK || len(hits) == 0 || hits[0].ID != hao || hits[0].Source != "pinyin" ||
		hits[0].Written != "好" || hits[0].RadicalID == nil || hits[0].Attrs == nil || len(hits[0].Readings) != 2 {
		t.Errorf("hao = %d %+v, want 好 via pinyin first, with readings, attrs and radicalId", status, hits)
	}

	// Tiers: the exact form first, then reading prefixes ranked by id,
	// then glosses.
	if _, hits = search("q=行&lang=zh"); len(hits) != 1 || hitsOf(hits)[0] != (hit{xing, "written"}) {
		t.Errorf("行 = %+v, want 行 written", hitsOf(hits))
	}
	if _, hits = search("q=ha&lang=zh"); len(hits) != 2 || hitsOf(hits)[0] != (hit{hao, "pinyin"}) || hitsOf(hits)[1] != (hit{xing, "pinyin"}) {
		t.Errorf("ha = %+v, want 好 then 行 by pinyin prefix", hitsOf(hits))
	}
	if _, hits = search("q=row&lang=zh"); len(hits) != 1 || hitsOf(hits)[0] != (hit{xing, "gloss"}) {
		t.Errorf("row = %+v, want 行 by gloss", hitsOf(hits))
	}

	// Romaji reaches the kana reading of a Japanese word.
	if _, hits = search("q=suru&lang=ja"); len(hits) != 1 || hitsOf(hits)[0] != (hit{suru, "kana"}) || hits[0].Written != "為る" {
		t.Errorf("suru = %+v, want 為る via kana", hits)
	}

	// Kind and scheme/level filters ride on query parameters.
	if _, hits = search("q=ha&lang=zh&kind=character&scheme=chars&level=2"); len(hits) != 1 || hits[0].ID != xing {
		t.Errorf("filtered level 2 = %+v, want only 行", hitsOf(hits))
	}
	if _, hits = search("q=ha&lang=zh&kind=word"); len(hits) != 0 {
		t.Errorf("kind=word = %+v, want none", hitsOf(hits))
	}

	// The zh entries do not leak into a ja search.
	if _, hits = search("q=好&lang=ja"); len(hits) != 0 {
		t.Errorf("ja 好 = %+v, want none", hitsOf(hits))
	}

	// An empty result is [], not null.
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/search?q=zzzz&lang=zh", "", nil)
	var raw json.RawMessage
	decodeJSON(t, resp, &raw)
	if string(raw) != "[]" {
		t.Errorf("no-match search = %s, want []", raw)
	}

	// Language is required; a non-numeric limit is malformed; a level
	// needs a scheme.
	for _, q := range []string{"q=hao", "q=hao&lang=zh&limit=x", "q=hao&lang=zh&level=1"} {
		if status, _ := search(q); status != http.StatusBadRequest {
			t.Errorf("%s status = %d, want 400", q, status)
		}
	}
}
