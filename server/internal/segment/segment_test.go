package segment_test

import (
	"context"
	"path/filepath"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/model"
	"qinqin/internal/segment"
)

// seedSegment returns a service over a fresh database holding a few zh
// characters and words (simplified and traditional) plus an astral char.
func seedSegment(t *testing.T) segment.Service {
	t.Helper()
	ctx := context.Background()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	st := entries.Store{DB: sqlDB}
	add := func(kind, written string) {
		e := &model.Entry{Language: "zh", Kind: kind, Written: written,
			Readings: []model.Reading{{Type: "pinyin", Value: "x"}}}
		if _, err := st.Upsert(ctx, e); err != nil {
			t.Fatalf("upsert %q: %v", written, err)
		}
	}
	for _, c := range []string{"我", "喜", "欢", "学", "习", "汉", "语", "學", "習", "𠮷"} {
		add("character", c)
	}
	for _, w := range []string{"学习", "學習", "汉语", "喜欢"} {
		add("word", w)
	}
	return segment.Service{Entries: st}
}

func TestMatchAtLongestWord(t *testing.T) {
	svc := seedSegment(t)
	m, err := svc.MatchAt(context.Background(), "zh", "我喜欢学习汉语", 3)
	if err != nil || m == nil {
		t.Fatalf("MatchAt = %v, %v", m, err)
	}
	if m.Surface != "学习" || m.Start != 3 || m.End != 5 || m.Lemma != "学习" || m.Reason != "" {
		t.Errorf("match = %+v, want 学习 3..5", m)
	}
	if len(m.Entries) != 1 || m.Entries[0].Kind != "word" || m.Entries[0].ID == 0 {
		t.Errorf("entries = %+v, want one word candidate", m.Entries)
	}
}

func TestMatchAtFallsBackToSingleChar(t *testing.T) {
	svc := seedSegment(t)
	// 我喜 is not a word; 我 is a character.
	m, err := svc.MatchAt(context.Background(), "zh", "我喜", 0)
	if err != nil || m == nil {
		t.Fatalf("MatchAt = %v, %v", m, err)
	}
	if m.Surface != "我" || m.Start != 0 || m.End != 1 {
		t.Errorf("match = %+v, want 我 0..1", m)
	}
}

func TestMatchAtNothing(t *testing.T) {
	svc := seedSegment(t)
	for _, text := range []string{"，", " ", "a", "7", "。我"} {
		m, err := svc.MatchAt(context.Background(), "zh", text, 0)
		if err != nil || m != nil {
			t.Errorf("MatchAt(%q) = %+v, %v, want nil, nil", text, m, err)
		}
	}
}

func TestMatchAtAstral(t *testing.T) {
	svc := seedSegment(t)
	m, err := svc.MatchAt(context.Background(), "zh", "a𠮷b", 1)
	if err != nil || m == nil {
		t.Fatalf("MatchAt = %v, %v", m, err)
	}
	if m.Surface != "𠮷" || m.Start != 1 || m.End != 2 {
		t.Errorf("match = %+v, want 𠮷 1..2", m)
	}
}

func TestMatchAtOffsetOutOfRange(t *testing.T) {
	svc := seedSegment(t)
	for _, off := range []int{-1, 2, 99} {
		m, err := svc.MatchAt(context.Background(), "zh", "我喜", off)
		if err != nil || m != nil {
			t.Errorf("offset %d = %+v, %v, want nil, nil", off, m, err)
		}
	}
}

func TestMatchAtTraditionalAndSimplified(t *testing.T) {
	svc := seedSegment(t)
	for _, w := range []string{"學習", "学习"} {
		m, err := svc.MatchAt(context.Background(), "zh", w, 0)
		if err != nil || m == nil || m.Surface != w || m.End != 2 {
			t.Errorf("MatchAt(%q) = %+v, %v", w, m, err)
		}
	}
}

func TestMatchAtJapaneseDeinflected(t *testing.T) {
	lang.Register(lang.Ja{})
	ctx := context.Background()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	st := entries.Store{DB: sqlDB}
	for _, w := range []string{"昨日", "ケーキ", "食べる", "食", "食べ"} {
		e := &model.Entry{Language: "ja", Kind: "word", Written: w,
			Readings: []model.Reading{{Type: "kana", Value: "x"}}}
		if _, err := st.Upsert(ctx, e); err != nil {
			t.Fatalf("upsert %q: %v", w, err)
		}
	}
	svc := segment.Service{Entries: st}
	m, err := svc.MatchAt(ctx, "ja", "昨日ケーキを食べた", 6)
	if err != nil || m == nil {
		t.Fatalf("MatchAt = %v, %v", m, err)
	}
	if m.Surface != "食べた" || m.Lemma != "食べる" || m.Reason != "past" || m.Start != 6 || m.End != 9 {
		t.Errorf("match = %+v, want 食べた -> 食べる past 6..9", m)
	}
	if len(m.Entries) != 1 {
		t.Errorf("entries = %+v, want the 食べる entry", m.Entries)
	}
	// An exact dictionary hit of equal length beats a deinflected one.
	m, err = svc.MatchAt(ctx, "ja", "食べる", 0)
	if err != nil || m == nil || m.Surface != "食べる" || m.Reason != "" {
		t.Errorf("exact match = %+v, %v", m, err)
	}
}

func seedJa(t *testing.T, words ...string) segment.Service {
	t.Helper()
	lang.Register(lang.Ja{})
	ctx := context.Background()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	st := entries.Store{DB: sqlDB}
	for _, w := range words {
		e := &model.Entry{Language: "ja", Kind: "word", Written: w,
			Readings: []model.Reading{{Type: "kana", Value: "x"}}}
		if _, err := st.Upsert(ctx, e); err != nil {
			t.Fatalf("upsert %q: %v", w, err)
		}
	}
	return segment.Service{Entries: st}
}

func TestMatchAtExactBeatsDeinflected(t *testing.T) {
	// 食べた is itself an entry and also deinflects to the seeded 食べる.
	svc := seedJa(t, "食べた", "食べる")
	m, err := svc.MatchAt(context.Background(), "ja", "食べた", 0)
	if err != nil || m == nil {
		t.Fatalf("MatchAt = %v, %v", m, err)
	}
	if m.Surface != "食べた" || m.Lemma != "食べた" || m.Reason != "" {
		t.Errorf("match = %+v, want exact 食べた with no reason", m)
	}
}

func TestMatchAtPrefersShallowerDeinflection(t *testing.T) {
	// 読まれた -> 読まれる (past, depth 1) and -> 読む (passive past, depth 2).
	svc := seedJa(t, "読む", "読まれる")
	m, err := svc.MatchAt(context.Background(), "ja", "読まれた", 0)
	if err != nil || m == nil {
		t.Fatalf("MatchAt = %v, %v", m, err)
	}
	if m.Lemma != "読まれる" || m.Reason != "past" {
		t.Errorf("match = %+v, want shallower 読まれる (past)", m)
	}
}

func TestMatchAtIrregularVerbs(t *testing.T) {
	svc := seedJa(t, "する", "来る", "くる", "行く")
	for _, c := range []struct{ text, lemma, reason string }{
		{"した", "する", "past"},
		{"来ました", "来る", "polite past"},
		{"きて", "くる", "te-form"},
		{"行って", "行く", "te-form"},
	} {
		m, err := svc.MatchAt(context.Background(), "ja", c.text, 0)
		if err != nil || m == nil || m.Lemma != c.lemma || m.Reason != c.reason {
			t.Errorf("MatchAt(%q) = %+v, %v, want %s (%s)", c.text, m, err, c.lemma, c.reason)
		}
	}
}

func TestSegmentCoversText(t *testing.T) {
	svc := seedSegment(t)
	text := "我喜欢，学习 abc 汉语!"
	ms, err := svc.Segment(context.Background(), "zh", text)
	if err != nil {
		t.Fatalf("Segment: %v", err)
	}
	want := []struct {
		s          string
		start, end int
	}{{"我", 0, 1}, {"喜欢", 1, 3}, {"学习", 4, 6}, {"汉语", 11, 13}}
	if len(ms) != len(want) {
		t.Fatalf("matches = %+v, want %d", ms, len(want))
	}
	for i, w := range want {
		if ms[i].Surface != w.s || ms[i].Start != w.start || ms[i].End != w.end {
			t.Errorf("match %d = %+v, want %+v", i, ms[i], w)
		}
	}
}
