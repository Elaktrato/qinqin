package entries_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/entries"
	"qinqin/internal/model"
)

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
		t.Fatalf("upsert %q (%s): %v", e.Written, e.Kind, err)
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

func TestUpsertGetRoundtrip(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)

	hao := model.Entry{Kind: "hanzi", Written: "好", Pinyin: "hǎo", Strokes: 6}
	id, err := st.Upsert(ctx, &hao)
	if err != nil {
		t.Fatalf("upsert 好: %v", err)
	}
	if hao.PinyinPlain != "hao" {
		t.Errorf("Upsert filled PinyinPlain = %q, want %q", hao.PinyinPlain, "hao")
	}
	if hao.Bopomofo != "ㄏㄠˇ" {
		t.Errorf("Upsert filled Bopomofo = %q, want %q", hao.Bopomofo, "ㄏㄠˇ")
	}

	got, err := st.GetByID(ctx, id)
	if err != nil {
		t.Fatalf("GetByID(好): %v", err)
	}
	if got.ID != id || got.Kind != "hanzi" || got.Written != "好" ||
		got.Pinyin != "hǎo" || got.PinyinPlain != "hao" || got.Bopomofo != "ㄏㄠˇ" ||
		got.Strokes != 6 {
		t.Errorf("GetByID = %+v, want the upserted 好 entry", got)
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

	same, err := st.GetByWritten(ctx, "好", "hanzi")
	if err != nil {
		t.Fatalf("GetByWritten(好, hanzi): %v", err)
	}
	if same.ID != id {
		t.Errorf("GetByWritten id = %d, want %d", same.ID, id)
	}

	// Re-upserting the same (written, kind) updates in place and keeps the id;
	// tone-numbered pinyin converts to the same bopomofo.
	id2, err := st.Upsert(ctx, &model.Entry{Kind: "hanzi", Written: "好", Pinyin: "hao3", Strokes: 7})
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
	if got.Pinyin != "hao3" || got.Strokes != 7 {
		t.Errorf("after re-upsert = pinyin %q strokes %d, want hao3/7", got.Pinyin, got.Strokes)
	}
	if got.PinyinPlain != "hao" || got.Bopomofo != "ㄏㄠˇ" {
		t.Errorf("after re-upsert plain/bopomofo = %q/%q, want hao/ㄏㄠˇ", got.PinyinPlain, got.Bopomofo)
	}

	// Pinyin that cannot be converted leaves Bopomofo empty; the upsert still succeeds.
	oddID := mustUpsert(t, st, &model.Entry{Kind: "hanzi", Written: "㐀", Pinyin: "xyz"})
	odd, err := st.GetByID(ctx, oddID)
	if err != nil {
		t.Fatalf("GetByID(㐀): %v", err)
	}
	if odd.Bopomofo != "" {
		t.Errorf("Bopomofo = %q for unconvertible pinyin, want empty", odd.Bopomofo)
	}
	if odd.PinyinPlain != "xyz" {
		t.Errorf("PinyinPlain = %q, want %q", odd.PinyinPlain, "xyz")
	}
}

func TestVariantLinks(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)

	fa := mustUpsert(t, st, &model.Entry{Kind: "hanzi", Written: "发", Pinyin: "fā"})
	faTrad := mustUpsert(t, st, &model.Entry{Kind: "hanzi", Written: "發", Pinyin: "fā"})
	faHair := mustUpsert(t, st, &model.Entry{Kind: "hanzi", Written: "髮", Pinyin: "fà"})

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

	if _, err := st.GetByWritten(ctx, "龥", "hanzi"); !errors.Is(err, entries.ErrNotFound) {
		t.Errorf("GetByWritten(unknown) = %v, want ErrNotFound", err)
	}
	if _, err := st.GetByID(ctx, 9999); !errors.Is(err, entries.ErrNotFound) {
		t.Errorf("GetByID(unknown) = %v, want ErrNotFound", err)
	}

	// Soft-deleted rows are never returned by queries.
	id := mustUpsert(t, st, &model.Entry{Kind: "hanzi", Written: "好", Pinyin: "hǎo"})
	if _, err := st.DB.Exec(`UPDATE entries SET deleted_at = ?, updated_at = ? WHERE id = ?`,
		"2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", id); err != nil {
		t.Fatalf("soft-delete 好: %v", err)
	}
	if _, err := st.GetByID(ctx, id); !errors.Is(err, entries.ErrNotFound) {
		t.Errorf("GetByID(soft-deleted) = %v, want ErrNotFound", err)
	}
	if _, err := st.GetByWritten(ctx, "好", "hanzi"); !errors.Is(err, entries.ErrNotFound) {
		t.Errorf("GetByWritten(soft-deleted) = %v, want ErrNotFound", err)
	}

	// Upserting the same key again revives the soft-deleted row in place.
	id2 := mustUpsert(t, st, &model.Entry{Kind: "hanzi", Written: "好", Pinyin: "hǎo"})
	if id2 != id {
		t.Errorf("re-upsert of soft-deleted row id = %d, want %d revived in place", id2, id)
	}
	if _, err := st.GetByID(ctx, id2); err != nil {
		t.Errorf("GetByID(revived 好) = %v, want the entry back", err)
	}
}

func TestRadicalLinks(t *testing.T) {
	ctx := context.Background()
	st := newStore(t)

	hao := mustUpsert(t, st, &model.Entry{Kind: "hanzi", Written: "好", Pinyin: "hǎo", Strokes: 6})
	nu := mustUpsert(t, st, &model.Entry{Kind: "hanzi", Written: "女", Pinyin: "nǚ"})
	zi := mustUpsert(t, st, &model.Entry{Kind: "hanzi", Written: "子", Pinyin: "zǐ"})

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

	ni := mustUpsert(t, st, &model.Entry{Kind: "hanzi", Written: "你", Pinyin: "nǐ"})
	hao := mustUpsert(t, st, &model.Entry{Kind: "hanzi", Written: "好", Pinyin: "hǎo"})
	nihao := mustUpsert(t, st, &model.Entry{Kind: "word", Written: "你好", Pinyin: "nǐ hǎo"})

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
	if words[0].Kind != "word" || words[0].Bopomofo != "ㄋㄧˇ ㄏㄠˇ" {
		t.Errorf("word entry = %+v, want word 你好 with bopomofo ㄋㄧˇ ㄏㄠˇ", words[0])
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
