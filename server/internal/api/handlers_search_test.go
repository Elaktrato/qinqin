package api_test

import (
	"context"
	"net/http"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/levels"
	"qinqin/internal/model"
)

// searchHitBody mirrors one element of GET /api/search.
type searchHitBody struct {
	ID      int64  `json:"id"`
	Kind    string `json:"kind"`
	Written string `json:"written"`
	Source  string `json:"source"`
}

func TestSearchEndpoint(t *testing.T) {
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	ctx := context.Background()
	for _, p := range []string{"../dict/testdata/mkgloss", levelsFixture} {
		pack, err := dict.LoadPack(p)
		if err != nil {
			t.Fatalf("load %s: %v", p, err)
		}
		if pack.Manifest.Type == "levels" {
			_, err = levels.Import(ctx, sqlDB, pack)
		} else {
			_, err = dict.Import(ctx, sqlDB, pack)
		}
		if err != nil {
			t.Fatalf("import %s: %v", p, err)
		}
	}
	mustUpsertEntry(t, entries.Store{DB: sqlDB}, &model.Entry{Language: "ja", Kind: "character", Written: "好",
		Readings: []model.Reading{{Type: "kun", Value: "この"}}})

	search := func(query string) (int, []searchHitBody) {
		resp := doJSON(t, http.MethodGet, ts.URL, "/api/search?"+query, "", nil)
		if resp.StatusCode != http.StatusOK {
			return resp.StatusCode, nil
		}
		var hits []searchHitBody
		decodeJSON(t, resp, &hits)
		return resp.StatusCode, hits
	}

	// Public, language-scoped, tone-insensitive.
	status, hits := search("q=nihao&lang=zh")
	if status != http.StatusOK || len(hits) == 0 || hits[0].Written != "你好" || hits[0].Source != "pinyin" {
		t.Errorf("nihao = %d %+v, want 你好 via pinyin first", status, hits)
	}

	// Kind and scheme/level filters ride on query parameters.
	_, hits = search("q=hao&lang=zh&kind=character&scheme=hsk-mini&level=1")
	if len(hits) != 1 || hits[0].Written != "好" {
		t.Errorf("filtered = %+v, want only 好", hits)
	}

	// The ja 好 does not leak into a zh search and vice versa.
	_, hits = search("q=" + "好" + "&lang=ja")
	if len(hits) != 1 || hits[0].Kind != "character" {
		t.Errorf("ja 好 = %+v, want one ja hit", hits)
	}

	// An empty result is [], not null.
	resp := doJSON(t, http.MethodGet, ts.URL, "/api/search?q=zzzz&lang=zh", "", nil)
	var raw []searchHitBody
	decodeJSON(t, resp, &raw)
	if raw == nil {
		t.Error("no-match search decoded to null, want []")
	}

	// Language is required; a non-numeric limit is malformed.
	if status, _ := search("q=hao"); status != http.StatusBadRequest {
		t.Errorf("missing lang status = %d, want 400", status)
	}
	if status, _ := search("q=hao&lang=zh&limit=x"); status != http.StatusBadRequest {
		t.Errorf("bad limit status = %d, want 400", status)
	}
}
