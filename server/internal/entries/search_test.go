package entries_test

import (
	"context"
	"testing"

	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/levels"
	"qinqin/internal/model"
)

// seedSearch imports the shared dictionary and levels fixtures (好, 你好,
// 妳好; hsk-mini levels 1 and 2) into a fresh database and returns the
// entries store on it. 好 joins hsk-mini level 1 as a derived member.
func seedSearch(t *testing.T) entries.Store {
	t.Helper()
	ctx := context.Background()
	st := newStore(t)
	dictPack, err := dict.LoadPack("../dict/testdata/mkgloss")
	if err != nil {
		t.Fatalf("load dictionary fixture: %v", err)
	}
	if _, err := dict.Import(ctx, st.DB, dictPack); err != nil {
		t.Fatalf("import dictionary fixture: %v", err)
	}
	levelsPack, err := dict.LoadPack("../levels/testdata/hsk-mini")
	if err != nil {
		t.Fatalf("load levels fixture: %v", err)
	}
	if _, err := levels.Import(ctx, st.DB, levelsPack); err != nil {
		t.Fatalf("import levels fixture: %v", err)
	}
	return st
}

// mustSearch runs q and fails the test on error.
func mustSearch(t *testing.T, st entries.Store, q entries.SearchQuery) []model.SearchHit {
	t.Helper()
	hits, err := st.Search(context.Background(), q)
	if err != nil {
		t.Fatalf("search %+v: %v", q, err)
	}
	return hits
}

// hasWritten reports whether hits contains an entry with the written form.
func hasWritten(hits []model.SearchHit, written string) bool {
	for _, h := range hits {
		if h.Written == written {
			return true
		}
	}
	return false
}

func TestSearchToneInsensitive(t *testing.T) {
	st := seedSearch(t)
	for _, text := range []string{"nihao", "ni hao", "nǐ hǎo", "NI3HAO3"} {
		hits := mustSearch(t, st, entries.SearchQuery{Text: text, Lang: "zh"})
		if !hasWritten(hits, "你好") {
			t.Errorf("search %q: 你好 not found in %d hits", text, len(hits))
		}
	}
}

func TestSearchExactWrittenRanksFirst(t *testing.T) {
	st := seedSearch(t)
	hits := mustSearch(t, st, entries.SearchQuery{Text: "好", Lang: "zh"})
	if len(hits) == 0 {
		t.Fatal("search 好 found nothing")
	}
	if hits[0].Written != "好" || hits[0].Kind != "character" || hits[0].Source != "written" {
		t.Errorf("first hit = %q/%s via %s, want character 好 via written",
			hits[0].Written, hits[0].Kind, hits[0].Source)
	}
}

func TestSearchWrittenBeforeReadingMatches(t *testing.T) {
	st := seedSearch(t)
	// "hao" matches 好 by exact reading; a word whose written form is
	// literally "hao" must still rank ahead of it.
	exact := mustUpsert(t, st, &model.Entry{Language: "zh", Kind: "word", Written: "hao",
		Readings: []model.Reading{{Type: "pinyin", Value: "xx"}}})
	hits := mustSearch(t, st, entries.SearchQuery{Text: "hao", Lang: "zh"})
	if len(hits) != 2 || hits[0].ID != exact || hits[0].Source != "written" ||
		hits[1].Written != "好" || hits[1].Source != "pinyin" {
		t.Fatalf("hits = %+v, want written-form %d then 好 via pinyin", hits, exact)
	}
}

func TestSearchByGloss(t *testing.T) {
	st := seedSearch(t)
	hits := mustSearch(t, st, entries.SearchQuery{Text: "hello", Lang: "zh"})
	// The fixture's trad variant 妳好 carries the same sense as 你好.
	if len(hits) != 2 || hits[0].Written != "你好" || hits[1].Written != "妳好" ||
		hits[0].Source != "gloss" || hits[1].Source != "gloss" {
		t.Fatalf("hello hits = %+v, want 你好 and 妳好 via gloss", hits)
	}
}

func TestSearchKindAndLevelFilter(t *testing.T) {
	st := seedSearch(t)
	hits := mustSearch(t, st, entries.SearchQuery{
		Text: "hao", Lang: "zh", Kind: "character", SchemeID: "hsk-mini", LevelName: "1",
	})
	if len(hits) != 1 || hits[0].Written != "好" {
		t.Fatalf("hao character level-1 hits = %+v, want only derived member 好", hits)
	}
	none := mustSearch(t, st, entries.SearchQuery{
		Text: "hao", Lang: "zh", SchemeID: "hsk-mini", LevelName: "2",
	})
	if len(none) != 0 {
		t.Errorf("level 2 has no hao members, got %+v", none)
	}
}

func TestSearchLanguageScoped(t *testing.T) {
	st := seedSearch(t)
	zhID := mustUpsert(t, st, &model.Entry{Language: "zh", Kind: "character", Written: "手",
		Readings: []model.Reading{{Type: "pinyin", Value: "shǒu"}}})
	jaID := mustUpsert(t, st, &model.Entry{Language: "ja", Kind: "character", Written: "手",
		Readings: []model.Reading{{Type: "kun", Value: "て"}}})
	hits := mustSearch(t, st, entries.SearchQuery{Text: "手", Lang: "ja"})
	if len(hits) != 1 || hits[0].ID != jaID {
		t.Fatalf("ja search 手 = %+v, want only ja entry %d (zh is %d)", hits, jaID, zhID)
	}
}

func TestSearchRequiresLanguage(t *testing.T) {
	st := newStore(t)
	if _, err := st.Search(context.Background(), entries.SearchQuery{Text: "x"}); err == nil {
		t.Fatal("search without Lang succeeded, want error")
	}
}

func TestSearchLimit(t *testing.T) {
	st := newStore(t)
	for _, w := range []string{"aa", "ab", "ac"} {
		mustUpsert(t, st, &model.Entry{Language: "es", Kind: "word", Written: w,
			Readings: []model.Reading{{Type: "latin", Value: w}}})
	}
	hits := mustSearch(t, st, entries.SearchQuery{Text: "a", Lang: "es", Limit: 2})
	if len(hits) != 2 {
		t.Fatalf("limit 2 returned %d hits", len(hits))
	}
}
