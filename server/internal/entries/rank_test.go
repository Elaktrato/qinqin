package entries_test

import (
	"context"
	"strings"
	"testing"

	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// jaWord upserts a Japanese word written written, read kana (in order),
// with attrs, and returns its id.
func jaWord(t *testing.T, st entries.Store, written string, attrs map[string]string, kana ...string) int64 {
	t.Helper()
	rs := make([]model.Reading, len(kana))
	for i, k := range kana {
		rs[i] = reading("kana", k)
	}
	return mustUpsert(t, st, &model.Entry{Language: "ja", Kind: "word", Written: written, Readings: rs, Attrs: attrs})
}

// writtenByReading returns the written forms EntriesByReading finds for
// plain, in order.
func writtenByReading(t *testing.T, st entries.Store, plain string) string {
	t.Helper()
	hits, err := st.EntriesByReading(context.Background(), "ja", "kana", []string{plain})
	if err != nil {
		t.Fatalf("EntriesByReading(%s): %v", plain, err)
	}
	var out []string
	for _, h := range hits[plain] {
		out = append(out, h.Written)
	}
	return strings.Join(out, ",")
}

// Reading hits rank usually-kana words first, then by JMdict priority
// (higher first, none = 0), then by the matched reading's position, then
// by entry id.
func TestEntriesByReadingRanksByUkThenPriority(t *testing.T) {
	lang.Register(lang.Ja{})
	st := newStore(t)
	jaWord(t, st, "射る", map[string]string{"jmdict.pri": "60"}, "いる")
	jaWord(t, st, "入る", map[string]string{"jmdict.pri": "90"}, "はいる", "いる")
	jaWord(t, st, "煎る", nil, "いる")
	jaWord(t, st, "要る", map[string]string{"jmdict.pri": "70", "jmdict.uk": "1"}, "いる")
	jaWord(t, st, "居る", map[string]string{"jmdict.pri": "82", "jmdict.uk": "1"}, "いる")
	jaWord(t, st, "鋳る", nil, "いる")

	// uk first (居る 82 before 要る 70), then priority (入る 90 before
	// 射る 60, though いる is 入る's second reading), then the rest by
	// ord and id.
	if got, want := writtenByReading(t, st, "いる"), "居る,要る,入る,射る,煎る,鋳る"; got != want {
		t.Errorf("いる = %s, want %s", got, want)
	}
}

// A uk word only gets the uk boost when it also carries a priority score:
// an archaic uk-only word (癒る) ranks below scored non-uk homophones,
// though still above unscored ones by ord and id.
func TestEntriesByReadingUkWithoutPriorityGetsNoBoost(t *testing.T) {
	lang.Register(lang.Ja{})
	st := newStore(t)
	jaWord(t, st, "癒る", map[string]string{"jmdict.uk": "1"}, "いる")
	jaWord(t, st, "射る", map[string]string{"jmdict.pri": "52"}, "いる")
	jaWord(t, st, "鋳る", nil, "いる")
	jaWord(t, st, "居る", map[string]string{"jmdict.pri": "82", "jmdict.uk": "1"}, "いる")
	if got, want := writtenByReading(t, st, "いる"), "居る,射る,癒る,鋳る"; got != want {
		t.Errorf("いる = %s, want %s", got, want)
	}
}

// Priorities sort as numbers, not text: "100" ranks above "99" and "82".
func TestEntriesByReadingSortsPriorityNumerically(t *testing.T) {
	lang.Register(lang.Ja{})
	st := newStore(t)
	jaWord(t, st, "八十二", map[string]string{"jmdict.pri": "82"}, "かな")
	jaWord(t, st, "九十九", map[string]string{"jmdict.pri": "99"}, "かな")
	jaWord(t, st, "百", map[string]string{"jmdict.pri": "100"}, "かな")
	if got, want := writtenByReading(t, st, "かな"), "百,九十九,八十二"; got != want {
		t.Errorf("かな = %s, want %s", got, want)
	}
}

// Without ranking attrs the order is the reading's position, then id —
// the order before ranking data existed.
func TestEntriesByReadingWithoutAttrsKeepsOrdThenID(t *testing.T) {
	lang.Register(lang.Ja{})
	st := newStore(t)
	jaWord(t, st, "擦る", nil, "こする", "する")
	jaWord(t, st, "刷る", nil, "する")
	jaWord(t, st, "為る", nil, "する")
	if got, want := writtenByReading(t, st, "する"), "刷る,為る,擦る"; got != want {
		t.Errorf("する = %s, want %s", got, want)
	}
}
