package entries_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/model"
)

// The zh pack registers for these tests the same way main.go registers it
// for the server; its readings normalize and derive through Upsert.
func init() {
	lang.Register(lang.Zh{})
}

// newStore opens a fresh migrated database and returns the entries store on it.
func newStore(t *testing.T) entries.Store {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return entries.Store{DB: sqlDB}
}

// mustUpsert upserts e on st and returns its id, failing the test on error.
func mustUpsert(t *testing.T, st entries.Store, e *model.Entry) int64 {
	t.Helper()
	id, err := st.Upsert(context.Background(), e)
	if err != nil {
		t.Fatalf("upsert %q (%s/%s): %v", e.Written, e.Kind, e.Language, err)
	}
	return id
}

// entryIDs returns the ids of es, for failure messages.
func entryIDs(es []model.Entry) []int64 {
	ids := make([]int64, len(es))
	for i, e := range es {
		ids[i] = e.ID
	}
	return ids
}

// sameIDs reports whether es holds exactly the given ids, in any order.
func sameIDs(es []model.Entry, want ...int64) bool {
	if len(es) != len(want) {
		return false
	}
	for _, e := range es {
		found := false
		for _, w := range want {
			if e.ID == w {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// reading is a shorthand for building one reading.
func reading(readType, value string) model.Reading {
	return model.Reading{Type: readType, Value: value}
}

// findReading returns e's reading of the given type, or nil.
func findReading(e model.Entry, readType string) *model.Reading {
	for i := range e.Readings {
		if e.Readings[i].Type == readType {
			return &e.Readings[i]
		}
	}
	return nil
}

func TestUpsertGetRoundtrip(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)

	hao := model.Entry{
		Language: "zh", Kind: "character", Written: "好",
		Readings: []model.Reading{reading("pinyin", "hǎo")},
		Attrs:    map[string]string{"strokes": "6"},
	}
	id, err := st.Upsert(ctx, &hao)
	if err != nil {
		t.Fatalf("upsert 好: %v", err)
	}
	// Upsert fills each reading's Plain via the language pack and lets the
	// pack derive extras: zh appended the bopomofo form of hǎo.
	if len(hao.Readings) != 2 {
		t.Fatalf("Upsert left %d readings, want pinyin plus derived bopomofo", len(hao.Readings))
	}
	if py := findReading(hao, "pinyin"); py == nil || py.Plain != "hao" || py.Ord != 0 {
		t.Errorf("pinyin reading after Upsert = %+v, want plain hao at ord 0", py)
	}
	if bm := findReading(hao, "bopomofo"); bm == nil || bm.Value != "ㄏㄠˇ" || bm.Ord != 1 {
		t.Errorf("bopomofo reading after Upsert = %+v, want ㄏㄠˇ at ord 1", bm)
	}

	got, err := st.GetByID(ctx, id)
	if err != nil {
		t.Fatalf("GetByID(好): %v", err)
	}
	if got.ID != id || got.Language != "zh" || got.Kind != "character" || got.Written != "好" {
		t.Errorf("GetByID = %+v, want the upserted 好 entry", got)
	}
	if py := findReading(*got, "pinyin"); py == nil || py.Value != "hǎo" || py.Plain != "hao" {
		t.Errorf("stored pinyin reading = %+v, want hǎo/hao", py)
	}
	if bm := findReading(*got, "bopomofo"); bm == nil || bm.Value != "ㄏㄠˇ" {
		t.Errorf("stored bopomofo reading = %+v, want ㄏㄠˇ", bm)
	}
	if got.Attrs["strokes"] != "6" {
		t.Errorf("stored attrs = %v, want strokes 6", got.Attrs)
	}
	if got.RadicalID != nil {
		t.Errorf("RadicalID = %d, want nil before any SetRadical", *got.RadicalID)
	}
	if got.DeletedAt != nil {
		t.Errorf("DeletedAt = %v, want nil", got.DeletedAt)
	}
	if got.UpdatedAt.IsZero() {
		t.Error("UpdatedAt is zero, want the write timestamp")
	}

	same, err := st.GetByWritten(ctx, "好", "character", "zh")
	if err != nil {
		t.Fatalf("GetByWritten(好, character, zh): %v", err)
	}
	if same.ID != id {
		t.Errorf("GetByWritten id = %d, want %d", same.ID, id)
	}

	// Re-upserting the same (written, kind, language) updates in place and
	// keeps the id; tone-numbered pinyin converts to the same bopomofo.
	id2, err := st.Upsert(ctx, &model.Entry{
		Language: "zh", Kind: "character", Written: "好",
		Readings: []model.Reading{reading("pinyin", "hao3")},
		Attrs:    map[string]string{"strokes": "7"},
	})
	if err != nil {
		t.Fatalf("re-upsert 好: %v", err)
	}
	if id2 != id {
		t.Errorf("re-upsert id = %d, want %d", id2, id)
	}
	got, err = st.GetByID(ctx, id)
	if err != nil {
		t.Fatalf("GetByID(好) after re-upsert: %v", err)
	}
	if py := findReading(*got, "pinyin"); py == nil || py.Value != "hao3" || py.Plain != "hao" {
		t.Errorf("after re-upsert pinyin = %+v, want hao3/hao", py)
	}
	if bm := findReading(*got, "bopomofo"); bm == nil || bm.Value != "ㄏㄠˇ" {
		t.Errorf("after re-upsert bopomofo = %+v, want ㄏㄠˇ", bm)
	}
	if got.Attrs["strokes"] != "7" {
		t.Errorf("after re-upsert attrs = %v, want strokes 7", got.Attrs)
	}

	// Pinyin that cannot be converted derives no bopomofo; the upsert
	// still succeeds and the plain form is the pinyin letters.
	oddID := mustUpsert(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "㐀",
		Readings: []model.Reading{reading("pinyin", "xyz")},
	})
	odd, err := st.GetByID(ctx, oddID)
	if err != nil {
		t.Fatalf("GetByID(㐀): %v", err)
	}
	if bm := findReading(*odd, "bopomofo"); bm != nil {
		t.Errorf("bopomofo = %+v for unconvertible pinyin, want none", bm)
	}
	if py := findReading(*odd, "pinyin"); py == nil || py.Plain != "xyz" {
		t.Errorf("pinyin reading of 㐀 = %+v, want plain xyz", py)
	}
}

// countActiveReadings returns the entry's active reading rows, queried
// directly in the database.
func countActiveReadings(t *testing.T, st entries.Store, entryID int64) int {
	t.Helper()
	var n int
	if err := st.DB.QueryRow(`SELECT COUNT(*) FROM readings
		WHERE entry_id = ? AND deleted_at IS NULL`, entryID).Scan(&n); err != nil {
		t.Fatalf("count active readings of %d: %v", entryID, err)
	}
	return n
}

func TestUpsertShrinksReadings(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)

	// 好 with a pinyin and a latin reading stores three rows: the zh pack
	// derives a bopomofo reading from the pinyin one.
	id := mustUpsert(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "好",
		Readings: []model.Reading{reading("pinyin", "hǎo"), reading("latin", "good")},
	})
	if n := countActiveReadings(t, st, id); n != 3 {
		t.Fatalf("stored reading rows = %d, want 3 (pinyin, latin, derived bopomofo)", n)
	}

	// Re-upserting with only the pinyin reading replaces the list: the
	// entry reports pinyin plus derived bopomofo and nothing else.
	if _, err := st.Upsert(ctx, &model.Entry{
		Language: "zh", Kind: "character", Written: "好",
		Readings: []model.Reading{reading("pinyin", "hǎo")},
	}); err != nil {
		t.Fatalf("re-upsert 好 with one reading: %v", err)
	}
	got, err := st.GetByID(ctx, id)
	if err != nil {
		t.Fatalf("GetByID(好) after shrink: %v", err)
	}
	if len(got.Readings) != 2 { // pinyin + derived bopomofo
		t.Errorf("readings after shrink = %+v, want pinyin plus derived bopomofo only", got.Readings)
	}
	if r := findReading(*got, "latin"); r != nil {
		t.Errorf("latin reading after shrink = %+v, want it retired", r)
	}
	if n := countActiveReadings(t, st, id); n != 2 {
		t.Errorf("active reading rows after shrink = %d, want 2", n)
	}

	// The superseded latin row is soft-deleted in the database — never
	// returned, never hard-deleted.
	var deletedAt sql.NullString
	err = st.DB.QueryRow(`SELECT deleted_at FROM readings
		WHERE entry_id = ? AND type = 'latin'`, id).Scan(&deletedAt)
	if err != nil {
		t.Fatalf("latin reading row after shrink: %v (want a soft-deleted row)", err)
	}
	if !deletedAt.Valid || deletedAt.String == "" {
		t.Errorf("latin reading row deleted_at = %v, want a timestamp", deletedAt)
	}
}

func TestSameWrittenFormTwoLanguages(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)

	zhShou := mustUpsert(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "手",
		Readings: []model.Reading{reading("pinyin", "shǒu")},
	})
	jaShou := mustUpsert(t, st, &model.Entry{
		Language: "ja", Kind: "character", Written: "手",
		Readings: []model.Reading{reading("on", "シュ")},
	})
	if zhShou == jaShou {
		t.Fatalf("手 in zh and ja share id %d, want two entries", zhShou)
	}

	// Both entries are retrievable by id and carry their own readings.
	zh, err := st.GetByID(ctx, zhShou)
	if err != nil {
		t.Fatalf("GetByID(zh 手): %v", err)
	}
	if zh.Language != "zh" || zh.Written != "手" {
		t.Errorf("zh entry = %+v, want zh 手", zh)
	}
	if py := findReading(*zh, "pinyin"); py == nil || py.Plain != "shou" {
		t.Errorf("zh readings = %+v, want pinyin shou", zh.Readings)
	}
	ja, err := st.GetByID(ctx, jaShou)
	if err != nil {
		t.Fatalf("GetByID(ja 手): %v", err)
	}
	if ja.Language != "ja" || ja.Written != "手" {
		t.Errorf("ja entry = %+v, want ja 手", ja)
	}
	if on := findReading(*ja, "on"); on == nil || on.Value != "シュ" {
		t.Errorf("ja readings = %+v, want on シュ", ja.Readings)
	}

	// GetByWritten resolves the same written form per language.
	got, err := st.GetByWritten(ctx, "手", "character", "zh")
	if err != nil {
		t.Fatalf("GetByWritten(手, character, zh): %v", err)
	}
	if got.ID != zhShou {
		t.Errorf("GetByWritten zh = id %d, want %d", got.ID, zhShou)
	}
	got, err = st.GetByWritten(ctx, "手", "character", "ja")
	if err != nil {
		t.Fatalf("GetByWritten(手, character, ja): %v", err)
	}
	if got.ID != jaShou {
		t.Errorf("GetByWritten ja = id %d, want %d", got.ID, jaShou)
	}

	// Re-upserting the ja entry does not touch the zh one.
	id := mustUpsert(t, st, &model.Entry{
		Language: "ja", Kind: "character", Written: "手",
		Readings: []model.Reading{reading("kun", "て")},
	})
	if id != jaShou {
		t.Errorf("re-upsert ja 手 id = %d, want %d", id, jaShou)
	}
	zh, err = st.GetByID(ctx, zhShou)
	if err != nil {
		t.Fatalf("GetByID(zh 手) after ja re-upsert: %v", err)
	}
	if py := findReading(*zh, "pinyin"); py == nil || py.Plain != "shou" {
		t.Errorf("zh entry changed by ja re-upsert: readings = %+v", zh.Readings)
	}
}

func TestUpsertFillsReadingsViaPack(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)

	e := model.Entry{
		Language: "zh", Kind: "character", Written: "好",
		Readings: []model.Reading{reading("pinyin", "hǎo")},
	}
	id := mustUpsert(t, st, &e)

	// Upsert normalized the pinyin reading through the zh pack: its plain
	// form drops the tone mark.
	py := findReading(e, "pinyin")
	if py == nil || py.Plain != "hao" {
		t.Errorf("pinyin reading after Upsert = %+v, want plain hao", py)
	}

	// The stored entry carries the derived bopomofo reading too.
	got, err := st.GetByID(ctx, id)
	if err != nil {
		t.Fatalf("GetByID(好): %v", err)
	}
	py = findReading(*got, "pinyin")
	if py == nil || py.Value != "hǎo" || py.Plain != "hao" {
		t.Errorf("stored pinyin = %+v, want hǎo/hao", py)
	}
	bm := findReading(*got, "bopomofo")
	if bm == nil || bm.Value != "ㄏㄠˇ" {
		t.Errorf("stored bopomofo = %+v, want ㄏㄠˇ", bm)
	}
}

func TestGenericPackFallback(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)

	// es has no code pack: the generic pack lowercases the plain form and
	// derives nothing.
	id := mustUpsert(t, st, &model.Entry{
		Language: "es", Kind: "word", Written: "hola",
		Readings: []model.Reading{reading("latin", "Hola")},
	})
	got, err := st.GetByID(ctx, id)
	if err != nil {
		t.Fatalf("GetByID(hola): %v", err)
	}
	if got.Language != "es" || got.Kind != "word" || got.Written != "hola" {
		t.Errorf("entry = %+v, want the es word hola", got)
	}
	if len(got.Readings) != 1 {
		t.Fatalf("readings = %+v, want the single latin reading (nothing derived)", got.Readings)
	}
	if r := got.Readings[0]; r.Type != "latin" || r.Value != "Hola" || r.Plain != "hola" {
		t.Errorf("latin reading = %+v, want Hola/hola", r)
	}
}

func TestVariantLinks(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)

	fa := mustUpsert(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "发",
		Readings: []model.Reading{reading("pinyin", "fā")},
	})
	faTrad := mustUpsert(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "發",
		Readings: []model.Reading{reading("pinyin", "fā")},
	})
	faHair := mustUpsert(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "髮",
		Readings: []model.Reading{reading("pinyin", "fà")},
	})

	if err := st.LinkVariant(ctx, fa, faTrad); err != nil {
		t.Fatalf("link 发↔發: %v", err)
	}
	if err := st.LinkVariant(ctx, fa, faHair); err != nil {
		t.Fatalf("link 发↔髮: %v", err)
	}

	variants, err := st.Variants(ctx, fa)
	if err != nil {
		t.Fatalf("Variants(发): %v", err)
	}
	if !sameIDs(variants, faTrad, faHair) {
		t.Errorf("Variants(发) = %v, want ids of 發 and 髮", entryIDs(variants))
	}
	// Listed variants carry their readings along.
	if py := findReading(variants[0], "pinyin"); py == nil || py.Plain != "fa" {
		t.Errorf("variant readings = %+v, want pinyin plain fa", variants[0].Readings)
	}
	if bm := findReading(variants[0], "bopomofo"); bm == nil {
		t.Errorf("variant readings = %+v, want the derived bopomofo too", variants[0].Readings)
	}

	// The link is symmetric: 發 and 髮 each see 发.
	variants, err = st.Variants(ctx, faTrad)
	if err != nil {
		t.Fatalf("Variants(發): %v", err)
	}
	if !sameIDs(variants, fa) {
		t.Errorf("Variants(發) = %v, want just 发", entryIDs(variants))
	}
	variants, err = st.Variants(ctx, faHair)
	if err != nil {
		t.Fatalf("Variants(髮): %v", err)
	}
	if !sameIDs(variants, fa) {
		t.Errorf("Variants(髮) = %v, want just 发", entryIDs(variants))
	}

	// Linking an existing pair again is a no-op.
	if err := st.LinkVariant(ctx, fa, faTrad); err != nil {
		t.Fatalf("re-link 发↔發: %v", err)
	}
	variants, err = st.Variants(ctx, fa)
	if err != nil {
		t.Fatalf("Variants(发) after re-link: %v", err)
	}
	if !sameIDs(variants, faTrad, faHair) {
		t.Errorf("Variants(发) after re-link = %v, want the unchanged pair", entryIDs(variants))
	}
}

func TestGetByWrittenNotFound(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)

	if _, err := st.GetByWritten(ctx, "龥", "character", "zh"); !errors.Is(err, entries.ErrNotFound) {
		t.Errorf("GetByWritten(unknown) = %v, want ErrNotFound", err)
	}
	if _, err := st.GetByID(ctx, 9999); !errors.Is(err, entries.ErrNotFound) {
		t.Errorf("GetByID(unknown) = %v, want ErrNotFound", err)
	}
	// The same written form in another language does not match.
	mustUpsert(t, st, &model.Entry{
		Language: "ja", Kind: "character", Written: "手",
		Readings: []model.Reading{reading("on", "シュ")},
	})
	if _, err := st.GetByWritten(ctx, "手", "character", "zh"); !errors.Is(err, entries.ErrNotFound) {
		t.Errorf("GetByWritten(手, character, zh) = %v, want ErrNotFound", err)
	}

	// Soft-deleted rows are never returned by queries.
	id := mustUpsert(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "好",
		Readings: []model.Reading{reading("pinyin", "hǎo")},
	})
	if _, err := st.DB.Exec(`UPDATE entries SET deleted_at = ?, updated_at = ? WHERE id = ?`,
		"2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", id); err != nil {
		t.Fatalf("soft-delete 好: %v", err)
	}
	if _, err := st.GetByID(ctx, id); !errors.Is(err, entries.ErrNotFound) {
		t.Errorf("GetByID(soft-deleted) = %v, want ErrNotFound", err)
	}
	if _, err := st.GetByWritten(ctx, "好", "character", "zh"); !errors.Is(err, entries.ErrNotFound) {
		t.Errorf("GetByWritten(soft-deleted) = %v, want ErrNotFound", err)
	}
	// Soft-deleted readings never resurface either.
	if _, err := st.DB.Exec(`UPDATE readings SET deleted_at = ?, updated_at = ? WHERE entry_id = ?`,
		"2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", id); err != nil {
		t.Fatalf("soft-delete readings of 好: %v", err)
	}

	// Upserting the same key again revives the soft-deleted row in place.
	id2 := mustUpsert(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "好",
		Readings: []model.Reading{reading("pinyin", "hǎo")},
	})
	if id2 != id {
		t.Errorf("re-upsert of soft-deleted row id = %d, want %d revived in place", id2, id)
	}
	got, err := st.GetByID(ctx, id2)
	if err != nil {
		t.Errorf("GetByID(revived 好) = %v, want the entry back", err)
	} else if len(got.Readings) != 2 {
		t.Errorf("revived readings = %+v, want pinyin plus derived bopomofo", got.Readings)
	}
}

func TestRadicalLinks(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)

	hao := mustUpsert(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "好",
		Readings: []model.Reading{reading("pinyin", "hǎo")},
		Attrs:    map[string]string{"strokes": "6"},
	})
	nu := mustUpsert(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "女",
		Readings: []model.Reading{reading("pinyin", "nǚ")},
	})
	zi := mustUpsert(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "子",
		Readings: []model.Reading{reading("pinyin", "zǐ")},
	})

	if err := st.SetRadical(ctx, hao, nu); err != nil {
		t.Fatalf("SetRadical(好, 女): %v", err)
	}
	got, err := st.GetByID(ctx, hao)
	if err != nil {
		t.Fatalf("GetByID(好): %v", err)
	}
	if got.RadicalID == nil || *got.RadicalID != nu {
		t.Errorf("RadicalID of 好 = %v, want id of 女 (%d)", got.RadicalID, nu)
	}
	chars, err := st.CharsUnder(ctx, nu)
	if err != nil {
		t.Fatalf("CharsUnder(女): %v", err)
	}
	if !sameIDs(chars, hao) {
		t.Errorf("CharsUnder(女) = %v, want just 好", entryIDs(chars))
	}
	// Listed chars keep their readings and attrs.
	if len(chars) != 1 || chars[0].Attrs["strokes"] != "6" {
		t.Errorf("char under radical = %+v, want attrs strokes 6", chars)
	}

	// A character has one radical: re-setting moves it to the new one.
	if err := st.SetRadical(ctx, hao, zi); err != nil {
		t.Fatalf("SetRadical(好, 子): %v", err)
	}
	got, err = st.GetByID(ctx, hao)
	if err != nil {
		t.Fatalf("GetByID(好) after re-set: %v", err)
	}
	if got.RadicalID == nil || *got.RadicalID != zi {
		t.Errorf("RadicalID of 好 = %v, want id of 子 (%d)", got.RadicalID, zi)
	}
	chars, err = st.CharsUnder(ctx, nu)
	if err != nil {
		t.Fatalf("CharsUnder(女) after re-set: %v", err)
	}
	if len(chars) != 0 {
		t.Errorf("CharsUnder(女) after re-set = %v, want empty", entryIDs(chars))
	}
	chars, err = st.CharsUnder(ctx, zi)
	if err != nil {
		t.Fatalf("CharsUnder(子) after re-set: %v", err)
	}
	if !sameIDs(chars, hao) {
		t.Errorf("CharsUnder(子) after re-set = %v, want just 好", entryIDs(chars))
	}
}

func TestWordCharLinks(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)

	ni := mustUpsert(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "你",
		Readings: []model.Reading{reading("pinyin", "nǐ")},
	})
	hao := mustUpsert(t, st, &model.Entry{
		Language: "zh", Kind: "character", Written: "好",
		Readings: []model.Reading{reading("pinyin", "hǎo")},
	})
	nihao := mustUpsert(t, st, &model.Entry{
		Language: "zh", Kind: "word", Written: "你好",
		Readings: []model.Reading{reading("pinyin", "nǐ hǎo")},
	})

	if err := st.LinkWordChar(ctx, nihao, ni); err != nil {
		t.Fatalf("link 你好→你: %v", err)
	}
	if err := st.LinkWordChar(ctx, nihao, hao); err != nil {
		t.Fatalf("link 你好→好: %v", err)
	}
	// Linking an existing pair again is a no-op.
	if err := st.LinkWordChar(ctx, nihao, hao); err != nil {
		t.Fatalf("re-link 你好→好: %v", err)
	}

	words, err := st.WordsContaining(ctx, hao)
	if err != nil {
		t.Fatalf("WordsContaining(好): %v", err)
	}
	if !sameIDs(words, nihao) {
		t.Fatalf("WordsContaining(好) = %v, want just 你好", entryIDs(words))
	}
	if len(words) != 1 || words[0].Kind != "word" {
		t.Fatalf("word entry = %+v, want word 你好", words)
	}
	if bm := findReading(words[0], "bopomofo"); bm == nil || bm.Value != "ㄋㄧˇ ㄏㄠˇ" {
		t.Errorf("word readings = %+v, want derived bopomofo ㄋㄧˇ ㄏㄠˇ", words[0].Readings)
	}

	words, err = st.WordsContaining(ctx, ni)
	if err != nil {
		t.Fatalf("WordsContaining(你): %v", err)
	}
	if !sameIDs(words, nihao) {
		t.Errorf("WordsContaining(你) = %v, want just 你好", entryIDs(words))
	}

	// Word-character links are not variants.
	variants, err := st.Variants(ctx, hao)
	if err != nil {
		t.Fatalf("Variants(好): %v", err)
	}
	if len(variants) != 0 {
		t.Errorf("Variants(好) = %v, want empty", entryIDs(variants))
	}
}
