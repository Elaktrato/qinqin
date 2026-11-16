package freq_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"qinqin/internal/freq"
	"qinqin/internal/lang"
	"qinqin/internal/lexicon"
)

// The server registers its language packs at start; the kana fallback
// (コレ -> これ) needs the Japanese one.
func init() { lang.Register(lang.Ja{}) }

// resolution is docs/contracts/frequency/starter-resolution.json.
type resolution struct {
	Language string `json:"language"`
	Lexicon  []struct {
		Key      string   `json:"key"`
		Forms    []string `json:"forms"`
		Readings []string `json:"readings"`
		Pri      int      `json:"pri"`
		UK       bool     `json:"uk"`
	} `json:"lexicon"`
	Packs map[string][]struct {
		Term    string `json:"term"`
		Reading string `json:"reading"`
		Rank    int    `json:"rank"`
	} `json:"packs"`
	Cases []struct {
		Name     string `json:"name"`
		Pack     string `json:"pack"`
		Size     int    `json:"size"`
		Expected []struct {
			Key  string `json:"key"`
			Rank int    `json:"rank"`
		} `json:"expected"`
	} `json:"cases"`
}

func loadResolution(t *testing.T) resolution {
	t.Helper()
	raw, err := os.ReadFile("../../../docs/contracts/frequency/starter-resolution.json")
	if err != nil {
		t.Fatal(err)
	}
	var r resolution
	if err := json.Unmarshal(raw, &r); err != nil {
		t.Fatal(err)
	}
	return r
}

// seedLexicon puts the fixture's toy entries and returns key -> id.
func seedLexicon(t *testing.T, sqlDB *sql.DB, r resolution) map[string]int64 {
	t.Helper()
	var dictID int64
	if err := sqlDB.QueryRow(`
		INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES ('toy', 'toy', '1', 'CC0-1.0', 'test', '2026-01-01T00:00:00Z') RETURNING id`).Scan(&dictID); err != nil {
		t.Fatal(err)
	}
	st := lexicon.Store{DB: sqlDB}
	ids := map[string]int64{}
	for _, e := range r.Lexicon {
		entry := &lexicon.Entry{Language: r.Language, Kind: "word", Key: e.Key, Pri: e.Pri, UK: e.UK}
		for _, f := range e.Forms {
			entry.Forms = append(entry.Forms, lexicon.Form{Text: f})
		}
		for _, rd := range e.Readings {
			entry.Readings = append(entry.Readings, lexicon.Reading{Type: "kana", Value: rd, Plain: rd})
		}
		id, err := st.Put(context.Background(), entry, dictID)
		if err != nil {
			t.Fatal(err)
		}
		ids[e.Key] = id
	}
	return ids
}

func packCSV(r resolution, name string) string {
	var b strings.Builder
	for _, row := range r.Packs[name] {
		fmt.Fprintf(&b, "%s,%s,%d\n", row.Term, row.Reading, row.Rank)
	}
	return b.String()
}

// seedResolution imports the lexicon and both toy packs and returns the
// installed packs by fixture name.
func seedResolution(t *testing.T) (*sql.DB, resolution, map[string]int64, map[string]freq.PackInfo) {
	t.Helper()
	sqlDB := openDB(t)
	r := loadResolution(t)
	ids := seedLexicon(t, sqlDB, r)
	for name := range r.Packs {
		mustImport(t, sqlDB, csvPack(t, "toy-"+name, packCSV(r, name)))
	}
	packs := packsByName(t, sqlDB)
	return sqlDB, r, ids, packs
}

func packsByName(t *testing.T, sqlDB *sql.DB) map[string]freq.PackInfo {
	t.Helper()
	all, err := freq.Store{DB: sqlDB}.Packs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]freq.PackInfo{}
	for _, p := range all {
		out[strings.TrimPrefix(p.PackID, "toy-")] = p
	}
	return out
}

// counting wraps a resolver and counts its calls.
type counting struct {
	r     freq.Resolver
	calls atomic.Int64
}

func (c *counting) BestWordReadingID(ctx context.Context, language, form, reading string) (int64, error) {
	c.calls.Add(1)
	return c.r.BestWordReadingID(ctx, language, form, reading)
}

func want(r resolution, ids map[string]int64, i int) []freq.TopEntry {
	out := []freq.TopEntry{}
	for _, e := range r.Cases[i].Expected {
		out = append(out, freq.TopEntry{EntryID: ids[e.Key], Rank: e.Rank})
	}
	return out
}

func entriesOf(es []freq.TopEntry) []freq.TopEntry {
	out := []freq.TopEntry{}
	for _, e := range es {
		out = append(out, freq.TopEntry{EntryID: e.EntryID, Rank: e.Rank})
	}
	return out
}

func TestTopFollowsTheResolutionContract(t *testing.T) {
	sqlDB, r, ids, packs := seedResolution(t)
	st := freq.Store{DB: sqlDB}
	lx := freq.StarterResolver{Lexicon: lexicon.Store{DB: sqlDB}}
	if packs["main"].ContentHash == "" {
		t.Fatal("PackInfo.ContentHash is empty")
	}
	var cache freq.TopCache
	for i, c := range r.Cases {
		got, err := st.Top(context.Background(), lx, packs[c.Pack], c.Size)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(entriesOf(got), want(r, ids, i)) {
			t.Errorf("%s: Top = %v, want %v", c.Name, got, want(r, ids, i))
		}
		cached, err := cache.Get(context.Background(), st, lx, packs[c.Pack], "v1", c.Size)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(entriesOf(cached), want(r, ids, i)) {
			t.Errorf("%s: TopCache.Get = %v, want %v", c.Name, cached, want(r, ids, i))
		}
	}
}

func TestTopCacheResolvesOncePerContentHash(t *testing.T) {
	sqlDB, r, ids, packs := seedResolution(t)
	st := freq.Store{DB: sqlDB}
	res := &counting{r: freq.StarterResolver{Lexicon: lexicon.Store{DB: sqlDB}}}
	var cache freq.TopCache
	ctx := context.Background()
	first, err := cache.Get(ctx, st, res, packs["main"], "v1", 3)
	if err != nil {
		t.Fatal(err)
	}
	calls := res.calls.Load()
	if calls == 0 {
		t.Fatal("the first Get resolved nothing")
	}
	again, err := cache.Get(ctx, st, res, packs["main"], "v1", 500)
	if err != nil {
		t.Fatal(err)
	}
	if res.calls.Load() != calls {
		t.Errorf("second Get resolved %d more rows, want 0 (cached)", res.calls.Load()-calls)
	}
	if !reflect.DeepEqual(entriesOf(again[:3]), entriesOf(first)) {
		t.Errorf("size 3 = %v is not the prefix of size 500 = %v", first, again)
	}

	// A re-import with other rows changes the content hash: recomputed.
	mustImport(t, sqlDB, csvPack(t, "toy-main", "飲む,,1\n"+packCSV(r, "main")))
	packs2 := packsByName(t, sqlDB)
	if packs2["main"].ContentHash == packs["main"].ContentHash {
		t.Fatal("re-import kept the content hash")
	}
	fresh, err := cache.Get(ctx, st, res, packs2["main"], "v1", 3)
	if err != nil {
		t.Fatal(err)
	}
	if res.calls.Load() == calls {
		t.Error("Get after a re-import did not recompute")
	}
	if len(fresh) == 0 || fresh[0].EntryID != ids["nomu"] || fresh[0].Rank != 1 {
		t.Errorf("after re-import Top 3 = %v, want 飲む first", fresh)
	}
}

func TestTopCacheConcurrentGet(t *testing.T) {
	sqlDB, r, ids, packs := seedResolution(t)
	st := freq.Store{DB: sqlDB}
	res := &counting{r: freq.StarterResolver{Lexicon: lexicon.Store{DB: sqlDB}}}
	var cache freq.TopCache
	var wg sync.WaitGroup
	errs := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, err := cache.Get(context.Background(), st, res, packs["main"], "v1", 3)
			if err == nil && !reflect.DeepEqual(entriesOf(got), want(r, ids, 0)) {
				err = fmt.Errorf("Get = %v", got)
			}
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Error(err)
		}
	}
	single := &counting{r: freq.StarterResolver{Lexicon: lexicon.Store{DB: sqlDB}}}
	if _, err := st.Top(context.Background(), single, packs["main"], 2000); err != nil {
		t.Fatal(err)
	}
	if res.calls.Load() != single.calls.Load() {
		t.Errorf("8 concurrent Gets resolved %d rows, one Top(2000) resolves %d: computed more than once",
			res.calls.Load(), single.calls.Load())
	}
}

// TestKanaRowsPreferKanaOnlyWordsForStarterDecksOnly: the level-word rule
// keeps resolving の to the usually-kana 乃; only the starter resolver
// prefers the kana-only word, and only one with a priority.
func TestKanaRowsPreferKanaOnlyWordsForStarterDecksOnly(t *testing.T) {
	sqlDB, _, ids, _ := seedResolution(t)
	ctx := context.Background()
	lx := lexicon.Store{DB: sqlDB}
	starter := freq.StarterResolver{Lexicon: lx}
	for _, tc := range []struct{ term, reading, level, start string }{
		{"の", "", "no-kanji", "no"},
		{"の", "の", "no-kanji", "no"},
		{"こと", "", "koto", "koto"},
		{"する", "", "suru", "suru"},
		{"コレ", "", "kore", "kore"},
		{"乃", "の", "no-kanji", "no-kanji"},
	} {
		if id, err := lx.BestWordReadingID(ctx, "ja", tc.term, tc.reading); err != nil || id != ids[tc.level] {
			t.Errorf("level rule %s/%s = %d, %v; want %s", tc.term, tc.reading, id, err, tc.level)
		}
		if id, err := starter.BestWordReadingID(ctx, "ja", tc.term, tc.reading); err != nil || id != ids[tc.start] {
			t.Errorf("starter rule %s/%s = %d, %v; want %s", tc.term, tc.reading, id, err, tc.start)
		}
	}
}

// TestTopCacheFollowsTheLexicon: a dictionary install changes what rows
// resolve to, so the lexicon version is part of the key.
func TestTopCacheFollowsTheLexicon(t *testing.T) {
	sqlDB, _, _, packs := seedResolution(t)
	st := freq.Store{DB: sqlDB}
	lx := lexicon.Store{DB: sqlDB}
	res := freq.StarterResolver{Lexicon: lx}
	ctx := context.Background()
	var cache freq.TopCache
	v1, err := lx.CharactersVersion(ctx)
	if err != nil {
		t.Fatal(err)
	}
	before, err := cache.Get(ctx, st, res, packs["main"], v1, 500)
	if err != nil {
		t.Fatal(err)
	}
	// A new dictionary brings a word for the unresolved row ぬ.
	var dictID int64
	if err := sqlDB.QueryRow(`INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES ('more', 'more', '1', 'CC0-1.0', 'test', '2026-01-02T00:00:00Z') RETURNING id`).Scan(&dictID); err != nil {
		t.Fatal(err)
	}
	nu, err := lx.Put(ctx, &lexicon.Entry{Language: "ja", Kind: "word", Key: "nu", Pri: 60,
		Readings: []lexicon.Reading{{Type: "kana", Value: "ぬ", Plain: "ぬ"}}}, dictID)
	if err != nil {
		t.Fatal(err)
	}
	v2, err := lx.CharactersVersion(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if v2 == v1 {
		t.Fatal("the lexicon version did not change")
	}
	after, err := cache.Get(ctx, st, res, packs["main"], v2, 500)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before)+1 || after[1].EntryID != nu {
		t.Errorf("after the install = %v (before %v), want ぬ second", after, before)
	}
}

type panicking struct{}

func (panicking) BestWordReadingID(context.Context, string, string, string) (int64, error) {
	panic("resolver broke")
}

// TestTopCachePanicDoesNotWedge: a panicking computation releases its
// waiters and is not cached; the next Get computes afresh.
func TestTopCachePanicDoesNotWedge(t *testing.T) {
	sqlDB, r, ids, packs := seedResolution(t)
	st := freq.Store{DB: sqlDB}
	var cache freq.TopCache
	func() {
		defer func() {
			if recover() == nil {
				t.Error("the panic did not reach the caller")
			}
		}()
		_, _ = cache.Get(context.Background(), st, panicking{}, packs["main"], "v1", 3)
	}()
	done := make(chan []freq.TopEntry, 1)
	go func() {
		got, err := cache.Get(context.Background(), st, freq.StarterResolver{Lexicon: lexicon.Store{DB: sqlDB}}, packs["main"], "v1", 3)
		if err != nil {
			t.Error(err)
		}
		done <- got
	}()
	select {
	case got := <-done:
		if !reflect.DeepEqual(entriesOf(got), want(r, ids, 0)) {
			t.Errorf("Get after a panic = %v", got)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Get after a panic hangs")
	}
}
