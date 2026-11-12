package lexicon_test

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"qinqin/internal/db"
	"qinqin/internal/lexicon"
)

// newStore opens a fresh migrated database and returns the lexicon store on it.
func newStore(t *testing.T) lexicon.Store {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return lexicon.Store{DB: sqlDB}
}

// addDictionary inserts a dictionaries row and returns its id.
func addDictionary(t *testing.T, st lexicon.Store, packID string) int64 {
	t.Helper()
	var id int64
	if err := st.DB.QueryRow(`
		INSERT INTO dictionaries (pack_id, name, version, license, attribution, updated_at)
		VALUES (?, ?, '1', 'CC-BY-SA', 'test', '2026-01-01T00:00:00Z')
		RETURNING id`, packID, packID).Scan(&id); err != nil {
		t.Fatalf("insert dictionary %s: %v", packID, err)
	}
	return id
}

// mustPut puts e for dictionaryID and returns its id, failing the test on error.
func mustPut(t *testing.T, st lexicon.Store, e *lexicon.Entry, dictionaryID int64) int64 {
	t.Helper()
	id, err := st.Put(context.Background(), e, dictionaryID)
	if err != nil {
		t.Fatalf("put %s/%s/%s: %v", e.Language, e.Kind, e.Key, err)
	}
	return id
}

// mustGet loads entry id, failing the test on error.
func mustGet(t *testing.T, st lexicon.Store, id int64) *lexicon.Entry {
	t.Helper()
	e, err := st.Get(context.Background(), id)
	if err != nil {
		t.Fatalf("get %d: %v", id, err)
	}
	return e
}

// suru is a JMdict-like word with two kanji forms and a kana reading.
func suru() *lexicon.Entry {
	return &lexicon.Entry{
		Language: "ja", Kind: "word", Key: "1157170",
		Forms: []lexicon.Form{
			{Text: "為る", Flags: []string{}, Pri: 0},
			{Text: "爲る", Flags: []string{"oK"}, Pri: 0},
		},
		Readings: []lexicon.Reading{
			{Type: "kana", Value: "する", Plain: "する", Flags: []string{}, Pri: 10},
		},
		Senses: []lexicon.Sense{
			{POS: []string{"vs-i"}, Tags: []string{}, Glosses: []string{"to do", "to carry out"}, Xrefs: []string{"為さる"}},
			{POS: []string{"vs-i"}, Tags: []string{"uk"}, Glosses: []string{"to make"}, Xrefs: []string{}},
		},
		Pri:   10,
		UK:    true,
		Attrs: map[string]string{"source": "jmdict"},
	}
}

// glosses returns every sense's glosses, flattened, for comparisons.
func glosses(ss []lexicon.Sense) [][]string {
	out := make([][]string, len(ss))
	for i, s := range ss {
		out[i] = s.Glosses
	}
	return out
}

// ids returns the ids of es, in order.
func ids(es []lexicon.Entry) []int64 {
	out := make([]int64, len(es))
	for i, e := range es {
		out[i] = e.ID
	}
	return out
}

func TestPutGetRoundTrip(t *testing.T) {
	st := newStore(t)
	dict := addDictionary(t, st, "jmdict")
	id := mustPut(t, st, suru(), dict)

	got := mustGet(t, st, id)
	want := suru()
	if got.ID != id || got.Language != "ja" || got.Kind != "word" || got.Key != "1157170" {
		t.Fatalf("identity = %d %s/%s/%s, want %d ja/word/1157170", got.ID, got.Language, got.Kind, got.Key, id)
	}
	if got.Pri != 10 || !got.UK {
		t.Errorf("pri/uk = %d/%v, want 10/true", got.Pri, got.UK)
	}
	if !reflect.DeepEqual(got.Attrs, want.Attrs) {
		t.Errorf("attrs = %v, want %v", got.Attrs, want.Attrs)
	}
	if got.UpdatedAt.IsZero() {
		t.Errorf("UpdatedAt is zero")
	}
	for i := range want.Forms {
		want.Forms[i].Ord = i
	}
	if !reflect.DeepEqual(got.Forms, want.Forms) {
		t.Errorf("forms = %+v, want %+v", got.Forms, want.Forms)
	}
	for i := range want.Readings {
		want.Readings[i].Ord = i
	}
	if !reflect.DeepEqual(got.Readings, want.Readings) {
		t.Errorf("readings = %+v, want %+v", got.Readings, want.Readings)
	}
	if len(got.Senses) != 2 {
		t.Fatalf("senses = %+v, want 2", got.Senses)
	}
	for i, s := range got.Senses {
		w := want.Senses[i]
		if s.ID == 0 || s.DictionaryID != dict || s.Ord != i {
			t.Errorf("sense %d id/dict/ord = %d/%d/%d, want nonzero/%d/%d", i, s.ID, s.DictionaryID, s.Ord, dict, i)
		}
		if !reflect.DeepEqual(s.POS, w.POS) || !reflect.DeepEqual(s.Tags, w.Tags) ||
			!reflect.DeepEqual(s.Glosses, w.Glosses) || !reflect.DeepEqual(s.Xrefs, w.Xrefs) {
			t.Errorf("sense %d = %+v, want %+v", i, s, w)
		}
	}
}

func TestGetUnknownIsNotFound(t *testing.T) {
	st := newStore(t)
	if _, err := st.Get(context.Background(), 42); !errors.Is(err, lexicon.ErrNotFound) {
		t.Fatalf("Get(42) err = %v, want ErrNotFound", err)
	}
}

func TestPutUpsertsByKey(t *testing.T) {
	st := newStore(t)
	dict := addDictionary(t, st, "jmdict")
	id := mustPut(t, st, suru(), dict)

	e := suru()
	e.Forms = e.Forms[:1]
	e.Readings[0].Value, e.Readings[0].Plain = "スル", "スル"
	if again := mustPut(t, st, e, dict); again != id {
		t.Fatalf("re-put id = %d, want %d", again, id)
	}
	got := mustGet(t, st, id)
	if len(got.Forms) != 1 || got.Forms[0].Text != "為る" {
		t.Errorf("forms = %+v, want only 為る", got.Forms)
	}
	if len(got.Readings) != 1 || got.Readings[0].Value != "スル" {
		t.Errorf("readings = %+v, want only スル", got.Readings)
	}
}

func TestPutRevivesSoftDeleted(t *testing.T) {
	st := newStore(t)
	dict := addDictionary(t, st, "jmdict")
	id := mustPut(t, st, suru(), dict)
	if _, err := st.DB.Exec(`UPDATE lx_entries SET deleted_at = updated_at WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := st.Get(context.Background(), id); !errors.Is(err, lexicon.ErrNotFound) {
		t.Fatalf("Get deleted err = %v, want ErrNotFound", err)
	}
	if again := mustPut(t, st, suru(), dict); again != id {
		t.Fatalf("revive id = %d, want %d", again, id)
	}
	mustGet(t, st, id)
}

func TestPutReplacesOnlyOwnDictionarySenses(t *testing.T) {
	st := newStore(t)
	jm := addDictionary(t, st, "jmdict")
	other := addDictionary(t, st, "other")

	id := mustPut(t, st, suru(), jm)
	e := suru()
	e.Senses = []lexicon.Sense{{Glosses: []string{"other gloss"}}}
	mustPut(t, st, e, other)

	// Re-put the jmdict entry with a single, changed sense.
	e = suru()
	e.Senses = []lexicon.Sense{{POS: []string{"vs-i"}, Glosses: []string{"to do (new)"}}}
	mustPut(t, st, e, jm)

	got := mustGet(t, st, id)
	byDict := map[int64][][]string{}
	for _, s := range got.Senses {
		byDict[s.DictionaryID] = append(byDict[s.DictionaryID], s.Glosses)
	}
	if want := [][]string{{"to do (new)"}}; !reflect.DeepEqual(byDict[jm], want) {
		t.Errorf("jmdict senses = %v, want %v", byDict[jm], want)
	}
	if want := [][]string{{"other gloss"}}; !reflect.DeepEqual(byDict[other], want) {
		t.Errorf("other senses = %v, want %v (must survive a jmdict re-put)", byDict[other], want)
	}
}

func TestPutIsIdempotent(t *testing.T) {
	st := newStore(t)
	dict := addDictionary(t, st, "jmdict")
	id := mustPut(t, st, suru(), dict)

	// Back-date every stamp so a re-stamp (second resolution) is visible.
	old := "2000-01-01T00:00:00Z"
	for _, tbl := range []string{"lx_entries", "lx_forms", "lx_readings", "lx_senses"} {
		if _, err := st.DB.Exec(`UPDATE `+tbl+` SET updated_at = ?`, old); err != nil {
			t.Fatal(err)
		}
	}
	count := func() int {
		var n int
		if err := st.DB.QueryRow(`SELECT
			(SELECT COUNT(*) FROM lx_forms) + (SELECT COUNT(*) FROM lx_readings) +
			(SELECT COUNT(*) FROM lx_senses)`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	before := count()

	mustPut(t, st, suru(), dict)

	got := mustGet(t, st, id)
	if want, _ := time.Parse(time.RFC3339, old); !got.UpdatedAt.Equal(want) {
		t.Errorf("UpdatedAt = %v after identical Put, want unchanged %v", got.UpdatedAt, want)
	}
	if after := count(); after != before {
		t.Errorf("child rows = %d after identical Put, want %d (no tombstones/inserts)", after, before)
	}
	var stamped int
	if err := st.DB.QueryRow(`SELECT
		(SELECT COUNT(*) FROM lx_forms WHERE updated_at <> ?) +
		(SELECT COUNT(*) FROM lx_readings WHERE updated_at <> ?) +
		(SELECT COUNT(*) FROM lx_senses WHERE updated_at <> ?)`, old, old, old).Scan(&stamped); err != nil {
		t.Fatal(err)
	}
	if stamped != 0 {
		t.Errorf("%d child rows re-stamped by identical Put, want 0", stamped)
	}

	// A real change does stamp the entry.
	e := suru()
	e.Pri = 20
	mustPut(t, st, e, dict)
	if got := mustGet(t, st, id); got.UpdatedAt.Year() == 2000 {
		t.Errorf("UpdatedAt not stamped after a changed Put")
	}
}

func TestByFormMatchesAnyForm(t *testing.T) {
	st := newStore(t)
	dict := addDictionary(t, st, "jmdict")
	id := mustPut(t, st, suru(), dict)
	zh := suru()
	zh.Language = "zh"
	mustPut(t, st, zh, dict)

	got, err := st.ByForm(context.Background(), "ja", []string{"為る", "爲る", "無い"})
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"為る", "爲る"} {
		es := got[f]
		if len(es) != 1 || es[0].ID != id {
			t.Fatalf("ByForm[%s] = %v, want [%d]", f, ids(es), id)
		}
		if len(es[0].Forms) != 2 || len(es[0].Readings) != 1 || len(es[0].Senses) != 2 {
			t.Errorf("ByForm[%s] children not loaded: %+v", f, es[0])
		}
	}
	if _, ok := got["無い"]; ok {
		t.Errorf("ByForm has an entry for an unknown form")
	}
}

func TestByFormSkipsDeleted(t *testing.T) {
	st := newStore(t)
	dict := addDictionary(t, st, "jmdict")
	id := mustPut(t, st, suru(), dict)
	if _, err := st.DB.Exec(`UPDATE lx_entries SET deleted_at = updated_at WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	got, err := st.ByForm(context.Background(), "ja", []string{"為る"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("ByForm = %v, want nothing for a deleted entry", got)
	}
}

func TestByReadingUsesPlain(t *testing.T) {
	st := newStore(t)
	dict := addDictionary(t, st, "cedict")
	e := &lexicon.Entry{
		Language: "zh", Kind: "word", Key: "你好",
		Forms:    []lexicon.Form{{Text: "你好"}},
		Readings: []lexicon.Reading{{Type: "pinyin", Value: "nǐ hǎo", Plain: "nihao"}},
		Senses:   []lexicon.Sense{{Glosses: []string{"hello"}}},
	}
	id := mustPut(t, st, e, dict)

	got, err := st.ByReading(context.Background(), "zh", []string{"nihao", "nǐ hǎo"})
	if err != nil {
		t.Fatal(err)
	}
	if es := got["nihao"]; len(es) != 1 || es[0].ID != id {
		t.Fatalf("ByReading[nihao] = %v, want [%d]", ids(got["nihao"]), id)
	}
	if !reflect.DeepEqual(glosses(got["nihao"][0].Senses), [][]string{{"hello"}}) {
		t.Errorf("senses not loaded: %+v", got["nihao"][0].Senses)
	}
	if _, ok := got["nǐ hǎo"]; ok {
		t.Errorf("ByReading matched the display value, want plain only")
	}
	if other, _ := st.ByReading(context.Background(), "ja", []string{"nihao"}); len(other) != 0 {
		t.Errorf("ByReading crossed languages: %v", other)
	}
}

func TestBestPrefersUkWithPriority(t *testing.T) {
	st := newStore(t)
	dict := addDictionary(t, st, "jmdict")
	put := func(key string, pri int, uk bool) int64 {
		return mustPut(t, st, &lexicon.Entry{
			Language: "ja", Kind: "word", Key: key,
			Forms: []lexicon.Form{{Text: "為る"}}, Pri: pri, UK: uk,
		}, dict)
	}
	put("a-uk-nopri", 0, true)   // uk without priority: no boost
	put("b-pri-high", 30, false) // highest priority, not uk
	ukPri := put("c-uk-pri", 5, true)

	got, err := st.Best(context.Background(), "ja", "word", "為る")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != ukPri {
		t.Fatalf("Best = %d (%s), want %d (uk with priority)", got.ID, got.Key, ukPri)
	}

	// Without the uk-with-priority entry, priority decides; ties by id.
	if _, err := st.DB.Exec(`UPDATE lx_entries SET deleted_at = updated_at WHERE id = ?`, ukPri); err != nil {
		t.Fatal(err)
	}
	if got, err = st.Best(context.Background(), "ja", "word", "為る"); err != nil || got.Key != "b-pri-high" {
		t.Fatalf("Best = %v, %v; want b-pri-high", got, err)
	}
	put("d-pri-high-later", 30, false)
	if got, err = st.Best(context.Background(), "ja", "word", "為る"); err != nil || got.Key != "b-pri-high" {
		t.Fatalf("Best tie = %v, %v; want b-pri-high (lower id)", got, err)
	}

	if _, err := st.Best(context.Background(), "ja", "character", "為る"); !errors.Is(err, lexicon.ErrNotFound) {
		t.Errorf("Best other kind err = %v, want ErrNotFound", err)
	}
}

func TestGetManyKeepsOrder(t *testing.T) {
	st := newStore(t)
	dict := addDictionary(t, st, "jmdict")
	var put []int64
	for _, k := range []string{"a", "b", "c"} {
		put = append(put, mustPut(t, st, &lexicon.Entry{
			Language: "ja", Kind: "word", Key: k, Forms: []lexicon.Form{{Text: k}},
		}, dict))
	}
	got, err := st.GetMany(context.Background(), []int64{put[2], 999, put[0], put[1]})
	if err != nil {
		t.Fatal(err)
	}
	if want := []int64{put[2], put[0], put[1]}; !reflect.DeepEqual(ids(got), want) {
		t.Fatalf("GetMany = %v, want %v", ids(got), want)
	}
	if got[0].Key != "c" || len(got[0].Forms) != 1 {
		t.Errorf("GetMany[0] = %+v, want c with its form", got[0])
	}
}

func TestLinkVariantsSymmetricAndIdempotent(t *testing.T) {
	st := newStore(t)
	dict := addDictionary(t, st, "unihan")
	char := func(c string) int64 {
		return mustPut(t, st, &lexicon.Entry{
			Language: "zh", Kind: "character", Key: c, Forms: []lexicon.Form{{Text: c}},
		}, dict)
	}
	a, b, r := char("说"), char("說"), char("讠")
	ctx := context.Background()
	for range 2 {
		if err := st.Link(ctx, a, b, "variant"); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.Link(ctx, a, r, "radical"); err != nil {
		t.Fatal(err)
	}
	if err := st.Link(ctx, a, b, "wordchar"); err == nil {
		t.Errorf("Link with unknown type succeeded")
	}
	var n int
	if err := st.DB.QueryRow(`SELECT COUNT(*) FROM lx_links WHERE type = 'variant'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Errorf("variant link rows = %d, want 2 (both directions, once)", n)
	}
	for _, c := range []struct{ from, want int64 }{{a, b}, {b, a}} {
		vs, err := st.Variants(ctx, c.from)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(ids(vs), []int64{c.want}) {
			t.Errorf("Variants(%d) = %v, want [%d]", c.from, ids(vs), c.want)
		}
	}
}
