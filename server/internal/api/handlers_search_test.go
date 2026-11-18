package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/levels"
	"qinqin/internal/model"
)

// searchHitBody mirrors one element of GET /api/search.
type searchHitBody struct {
	model.EntryBase
	Source  string `json:"source"`
	Glosses []struct {
		DictionaryID int64  `json:"dictionaryId"`
		Gloss        string `json:"gloss"`
	} `json:"glosses"`
	Levels []struct {
		Scheme string `json:"scheme"`
		Level  string `json:"level"`
	} `json:"levels"`
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
	if len(hits[0].Glosses) == 0 || hits[0].Glosses[0].DictionaryID == 0 || hits[0].Glosses[0].Gloss == "" {
		t.Errorf("hao glosses = %+v, want the first gloss of its dictionary", hits[0].Glosses)
	}
	if len(hits[0].Levels) != 1 || hits[0].Levels[0].Scheme != "Empty scheme" || hits[0].Levels[0].Level != "1" {
		t.Errorf("hao levels = %+v, want Empty scheme 1", hits[0].Levels)
	}

	// Tiers: the exact form first, then reading prefixes ranked by id,
	// then glosses.
	if _, hits = search("q=行&lang=zh"); len(hits) != 1 || hitsOf(hits)[0] != (hit{xing, "written"}) {
		t.Errorf("行 = %+v, want 行 written", hitsOf(hits))
	}
	// CC-CEDICT carries no priority, so within a tier the hits tie and
	// only the set is asserted here; rank order is checked below on
	// Japanese, where it differs from id order.
	if _, hits = search("q=ha&lang=zh"); len(hits) != 2 || !slices.Contains(hitsOf(hits), hit{hao, "pinyin"}) || !slices.Contains(hitsOf(hits), hit{xing, "pinyin"}) {
		t.Errorf("ha = %+v, want 好 and 行 by pinyin prefix", hitsOf(hits))
	}
	// Either reading of the merged two-line 行 entry finds it.
	for _, q := range []string{"xing", "hang"} {
		if _, hits = search("q=" + q + "&lang=zh"); len(hits) == 0 || hitsOf(hits)[0] != (hit{xing, "pinyin"}) {
			t.Errorf("%s = %+v, want 行 via pinyin first", q, hitsOf(hits))
		}
	}
	if _, hits = search("q=row&lang=zh"); len(hits) != 1 || hitsOf(hits)[0] != (hit{xing, "gloss"}) {
		t.Errorf("row = %+v, want 行 by gloss", hitsOf(hits))
	}

	// Romaji reaches the kana reading of a Japanese word; within the
	// tier the usually-kana 為る with priority ranks above 刷る although
	// 刷る has the lower id.
	if suri := lexID(t, sqlDB, "ja", "word", "j:1397500"); suri > suru {
		t.Fatalf("fixture: 刷る id %d should be below 為る id %d", suri, suru)
	}
	if _, hits = search("q=suru&lang=ja"); len(hits) != 2 || hitsOf(hits)[0] != (hit{suru, "kana"}) || hits[0].Written != "する" || hits[1].Written != "刷る" {
		// 為る is usually written in kana (first sense uk): its display form is する.
		t.Errorf("suru = %+v, want する (為る) then 刷る via kana", hitsOf(hits))
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
