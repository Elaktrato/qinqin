package levels_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/levels"
	"qinqin/internal/model"
)

// hskMini is the shared levels pack fixture, relative to this package's
// test working directory.
const hskMini = "testdata/hsk-mini"

// newDB opens a fresh migrated database.
func newDB(t *testing.T) *sql.DB {
	t.Helper()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	return sqlDB
}

// mustEntry upserts one zh entry and returns its id.
func mustEntry(t *testing.T, st entries.Store, kind, written, pinyin string) int64 {
	t.Helper()
	id, err := st.Upsert(context.Background(), &model.Entry{
		Language: "zh",
		Kind:     kind,
		Written:  written,
		Readings: []model.Reading{{Type: "pinyin", Value: pinyin}},
	})
	if err != nil {
		t.Fatalf("upsert %s (%s): %v", written, kind, err)
	}
	return id
}

// fixtureEntries are the entry ids the fixture scheme's tests refer to.
type fixtureEntries struct {
	nihao, xiexie, yinhang int64            // the fixture's member words
	chars                  map[string]int64 // every character by written form
}

// seedFixture upserts the fixture scheme's words and the characters they
// are written with, plus 发, which no scheme touches.
func seedFixture(t *testing.T, st entries.Store) fixtureEntries {
	t.Helper()
	fe := fixtureEntries{
		nihao:   mustEntry(t, st, "word", "你好", "nǐ hǎo"),
		xiexie:  mustEntry(t, st, "word", "谢谢", "xiè xie"),
		yinhang: mustEntry(t, st, "word", "银行", "yín háng"),
		chars:   map[string]int64{},
	}
	for _, c := range []struct{ written, pinyin string }{
		{"你", "nǐ"}, {"好", "hǎo"}, {"谢", "xiè"}, {"银", "yín"}, {"行", "xíng"}, {"发", "fā"},
	} {
		fe.chars[c.written] = mustEntry(t, st, "character", c.written, c.pinyin)
	}
	return fe
}

// levelsManifest is the manifest of a test levels pack.
func levelsManifest(id, format string) string {
	return `{"id":"` + id + `","name":"Test scheme","version":"1.0","type":"levels",` +
		`"language":"zh","license":"CC BY-SA 4.0","attribution":"Qinqin test fixtures",` +
		`"format":"` + format + `"}`
}

// buildPackFormat writes a manifest.json of the given format and a
// levels.json into a fresh temp directory and loads the pack from there.
// An empty levelsJSON writes no data file.
func buildPackFormat(t *testing.T, id, format, levelsJSON string) dict.Pack {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(levelsManifest(id, format)), 0o644); err != nil {
		t.Fatalf("write manifest.json: %v", err)
	}
	if levelsJSON != "" {
		if err := os.WriteFile(filepath.Join(dir, "levels.json"), []byte(levelsJSON), 0o644); err != nil {
			t.Fatalf("write levels.json: %v", err)
		}
	}
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("load pack %s: %v", id, err)
	}
	return pack
}

// buildPack writes a manifest.json (format json) and levels.json into a
// fresh temp directory and loads the pack from there.
func buildPack(t *testing.T, id, levelsJSON string) dict.Pack {
	t.Helper()
	return buildPackFormat(t, id, "json", levelsJSON)
}

func TestSchemeImportAndBadges(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	sqlDB := newDB(t)
	ctx := context.Background()
	fe := seedFixture(t, entries.Store{DB: sqlDB})

	pack, err := dict.LoadPack(hskMini)
	if err != nil {
		t.Fatalf("load fixture pack: %v", err)
	}
	res, err := levels.Import(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("import fixture scheme: %v", err)
	}
	if res.Levels != 2 || res.Members != 3 || res.Derived != 5 || len(res.Skipped) != 0 {
		t.Errorf("import result = %+v, want 2 levels, 3 members, 5 derived, nothing skipped", res)
	}

	// The scheme is listed with its levels in pack order.
	schemes, err := levels.List(ctx, sqlDB)
	if err != nil {
		t.Fatalf("list schemes: %v", err)
	}
	if len(schemes) != 1 {
		t.Fatalf("levels.List = %+v, want one scheme", schemes)
	}
	s := schemes[0]
	if s.ID == 0 || s.PackID != "hsk-mini" || s.Name != "HSK mini" || s.Unit != levels.UnitWord ||
		s.Language != "zh" || s.Version != "1.0" || s.License != "CC BY-SA 4.0" ||
		s.Attribution != "Qinqin test fixtures" {
		t.Errorf("listed scheme = %+v, want the fixture pack's registry row", s)
	}
	if len(s.Levels) != 2 || s.Levels[0].Name != "1" || s.Levels[0].Ord != 0 ||
		s.Levels[1].Name != "2" || s.Levels[1].Ord != 1 {
		t.Errorf("scheme levels = %+v, want 1 then 2 in pack order", s.Levels)
	}

	// The member word carries its badge; its characters carry derived ones.
	if got, err := levels.ForEntry(ctx, sqlDB, fe.nihao); err != nil || !slices.Equal(got, []model.Badge{{
		SchemeID: s.ID, SchemeName: "HSK mini", LevelName: "1", Derived: false,
	}}) {
		t.Errorf("badges of 你好 = %v (err %v), want HSK mini level 1", got, err)
	}
	if got, err := levels.ForEntry(ctx, sqlDB, fe.chars["好"]); err != nil || !slices.Equal(got, []model.Badge{{
		SchemeID: s.ID, SchemeName: "HSK mini", LevelName: "1", Derived: true,
	}}) {
		t.Errorf("badges of 好 = %v (err %v), want derived HSK mini level 1", got, err)
	}
	// An entry no scheme touches has no badges.
	if got, err := levels.ForEntry(ctx, sqlDB, fe.chars["发"]); err != nil || len(got) != 0 {
		t.Errorf("badges of 发 = %v (err %v), want none", got, err)
	}

	// Level membership lists direct and derived members alike.
	for _, tc := range []struct {
		level string
		want  []int64
	}{
		{"1", []int64{fe.nihao, fe.xiexie, fe.chars["你"], fe.chars["好"], fe.chars["谢"]}},
		{"2", []int64{fe.yinhang, fe.chars["银"], fe.chars["行"]}},
	} {
		got, err := levels.EntryIDs(ctx, sqlDB, s.ID, tc.level)
		if err != nil {
			t.Fatalf("EntryIDs(%q): %v", tc.level, err)
		}
		if len(got) != len(tc.want) {
			t.Errorf("EntryIDs(%q) = %v, want %v", tc.level, got, tc.want)
			continue
		}
		for _, id := range tc.want {
			if !slices.Contains(got, id) {
				t.Errorf("EntryIDs(%q) = %v, want member %d", tc.level, got, id)
			}
		}
	}
	// Unknown levels and schemes are ErrNotFound.
	for _, tc := range []struct {
		scheme int64
		level  string
	}{
		{s.ID, "3"},
		{999999, "1"},
	} {
		if _, err := levels.EntryIDs(ctx, sqlDB, tc.scheme, tc.level); !errors.Is(err, levels.ErrNotFound) {
			t.Errorf("EntryIDs(%d, %q) err = %v, want ErrNotFound", tc.scheme, tc.level, err)
		}
	}

	// Re-importing the same pack replaces it: the counts repeat, one
	// scheme row remains, and no duplicate memberships linger.
	res2, err := levels.Import(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("re-import fixture scheme: %v", err)
	}
	if res2.Levels != res.Levels || res2.Members != res.Members ||
		res2.Derived != res.Derived || !slices.Equal(res2.Skipped, res.Skipped) {
		t.Errorf("re-import result = %+v, want the same counts as %+v", res2, res)
	}
	if schemes, err = levels.List(ctx, sqlDB); err != nil || len(schemes) != 1 {
		t.Errorf("levels.List after re-import = %v (err %v), want one scheme", schemes, err)
	}
	var active int
	if err := sqlDB.QueryRow(`
		SELECT COUNT(*) FROM level_members m
		JOIN levels l ON l.id = m.level_id AND l.deleted_at IS NULL
		JOIN schemes sc ON sc.id = l.scheme_id AND sc.deleted_at IS NULL
		WHERE sc.pack_id = 'hsk-mini' AND m.deleted_at IS NULL`).Scan(&active); err != nil {
		t.Fatalf("count active members: %v", err)
	}
	if active != 8 {
		t.Errorf("active members after re-import = %d, want 8", active)
	}
}

func TestSchemeEntryIDs(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	sqlDB := newDB(t)
	ctx := context.Background()
	st := entries.Store{DB: sqlDB}

	nihao := mustEntry(t, st, "word", "你好", "nǐ hǎo")
	xiexie := mustEntry(t, st, "word", "谢谢", "xiè xie")
	ni := mustEntry(t, st, "character", "你", "nǐ")
	hao := mustEntry(t, st, "character", "好", "hǎo")
	xie := mustEntry(t, st, "character", "谢", "xiè")

	// 你好 joins both levels; 谢谢 only level 2. The characters derive
	// into the lowest level whose words are written with them.
	pack := buildPack(t, "scheme-members", `{"unit":"word","levels":[
		{"name":"1","entries":["你好"]},
		{"name":"2","entries":["你好","谢谢"]}]}`)
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("import scheme: %v", err)
	}
	schemes, err := levels.List(ctx, sqlDB)
	if err != nil || len(schemes) != 1 {
		t.Fatalf("levels.List = %v (err %v), want one scheme", schemes, err)
	}
	s := schemes[0]

	level1 := []int64{nihao, ni, hao}
	level2 := []int64{xiexie, xie}
	slices.Sort(level1)
	slices.Sort(level2)
	want := append(append([]int64{}, level1...), level2...)

	got, err := levels.SchemeEntryIDs(ctx, sqlDB, s.ID)
	if err != nil {
		t.Fatalf("SchemeEntryIDs: %v", err)
	}
	// Distinct — 你好 sits in both levels — ordered by level then entry id.
	if !slices.Equal(got, want) {
		t.Errorf("SchemeEntryIDs = %v, want %v (level order, then entry id, distinct)", got, want)
	}

	// An unknown scheme is ErrNotFound.
	if _, err := levels.SchemeEntryIDs(ctx, sqlDB, 999999); !errors.Is(err, levels.ErrNotFound) {
		t.Errorf("SchemeEntryIDs(unknown) err = %v, want ErrNotFound", err)
	}
}

func TestDerivedLevelKeepsLowest(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	sqlDB := newDB(t)
	ctx := context.Background()
	st := entries.Store{DB: sqlDB}
	// 好 is written in a level-1 word (你好) and a level-2 word (好人).
	nihao := mustEntry(t, st, "word", "你好", "nǐ hǎo")
	haoren := mustEntry(t, st, "word", "好人", "hǎo rén")
	ni := mustEntry(t, st, "character", "你", "nǐ")
	hao := mustEntry(t, st, "character", "好", "hǎo")
	ren := mustEntry(t, st, "character", "人", "rén")

	pack := buildPack(t, "lowest", `{"unit":"word","levels":[
		{"name":"1","entries":["你好","你好"]},
		{"name":"2","entries":["好人"]}]}`)
	res, err := levels.Import(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("import scheme: %v", err)
	}
	// The repeated form joins level 1 once; 好 derives from the level-1
	// word only, keeping its lowest level.
	if res.Members != 2 || res.Derived != 3 || len(res.Skipped) != 0 {
		t.Fatalf("import result = %+v, want 2 members, 3 derived, nothing skipped", res)
	}
	got, err := levels.ForEntry(ctx, sqlDB, hao)
	if err != nil {
		t.Fatalf("badges of 好: %v", err)
	}
	if len(got) != 1 || got[0].LevelName != "1" || !got[0].Derived {
		t.Errorf("badges of 好 = %+v, want only derived level 1", got)
	}
	if got, err := levels.ForEntry(ctx, sqlDB, ni); err != nil || len(got) != 1 || got[0].LevelName != "1" {
		t.Errorf("badges of 你 = %v (err %v), want level 1", got, err)
	}
	if got, err := levels.ForEntry(ctx, sqlDB, ren); err != nil || len(got) != 1 || got[0].LevelName != "2" {
		t.Errorf("badges of 人 = %v (err %v), want level 2", got, err)
	}

	schemes, err := levels.List(ctx, sqlDB)
	if err != nil || len(schemes) != 1 {
		t.Fatalf("levels.List = %v (err %v), want one scheme", schemes, err)
	}
	lvl1, err := levels.EntryIDs(ctx, sqlDB, schemes[0].ID, "1")
	if err != nil {
		t.Fatalf("EntryIDs(1): %v", err)
	}
	if len(lvl1) != 3 || !slices.Contains(lvl1, nihao) || !slices.Contains(lvl1, ni) || !slices.Contains(lvl1, hao) {
		t.Errorf("level 1 members = %v, want 你好 plus derived 你 and 好", lvl1)
	}
	lvl2, err := levels.EntryIDs(ctx, sqlDB, schemes[0].ID, "2")
	if err != nil {
		t.Fatalf("EntryIDs(2): %v", err)
	}
	if len(lvl2) != 2 || !slices.Contains(lvl2, haoren) || !slices.Contains(lvl2, ren) {
		t.Errorf("level 2 members = %v, want 好人 plus derived 人", lvl2)
	}
}

func TestSkippedUnknownForms(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	sqlDB := newDB(t)
	ctx := context.Background()
	st := entries.Store{DB: sqlDB}
	// 电脑 is no entry; the character 谢 is missing too.
	nihao := mustEntry(t, st, "word", "你好", "nǐ hǎo")
	xiexie := mustEntry(t, st, "word", "谢谢", "xiè xie")
	ni := mustEntry(t, st, "character", "你", "nǐ")
	hao := mustEntry(t, st, "character", "好", "hǎo")

	pack := buildPack(t, "skipped", `{"unit":"word","levels":[
		{"name":"1","entries":["你好","电脑"]},
		{"name":"2","entries":["谢谢"]}]}`)
	res, err := levels.Import(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("import scheme: %v", err)
	}
	if res.Members != 2 || res.Derived != 2 {
		t.Errorf("import result = %+v, want 2 members (你好, 谢谢) and 2 derived (你, 好)", res)
	}
	if !slices.Equal(res.Skipped, []string{"电脑", "谢"}) {
		t.Errorf("skipped forms = %v, want [电脑 谢]", res.Skipped)
	}

	// No entry was created for the unknown forms.
	var total int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM entries`).Scan(&total); err != nil {
		t.Fatalf("count entries: %v", err)
	}
	if total != 4 {
		t.Errorf("entries = %d, want the 4 seeded rows, no new ones", total)
	}
	var unknown int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM entries WHERE written = '电脑'`).Scan(&unknown); err != nil {
		t.Fatalf("count 电脑: %v", err)
	}
	if unknown != 0 {
		t.Errorf("entries for 电脑 = %d, want 0", unknown)
	}

	// The known members still badge.
	if got, err := levels.ForEntry(ctx, sqlDB, nihao); err != nil || len(got) != 1 || got[0].LevelName != "1" {
		t.Errorf("badges of 你好 = %v (err %v), want level 1", got, err)
	}
	if got, err := levels.ForEntry(ctx, sqlDB, xiexie); err != nil || len(got) != 1 || got[0].LevelName != "2" {
		t.Errorf("badges of 谢谢 = %v (err %v), want level 2", got, err)
	}
	for _, id := range []int64{ni, hao} {
		if got, err := levels.ForEntry(ctx, sqlDB, id); err != nil || len(got) != 1 ||
			got[0].LevelName != "1" || !got[0].Derived {
			t.Errorf("badges of %d = %v (err %v), want derived level 1", id, got, err)
		}
	}
}

func TestCharacterUnitScheme(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	sqlDB := newDB(t)
	ctx := context.Background()
	st := entries.Store{DB: sqlDB}
	hao := mustEntry(t, st, "character", "好", "hǎo")
	ni := mustEntry(t, st, "character", "你", "nǐ")

	// "hanzi" is the pack spelling of the character unit.
	if _, err := levels.Import(ctx, sqlDB, buildPack(t, "zh-curriculum",
		`{"unit":"hanzi","levels":[{"name":"1","entries":["好","你"]}]}`)); err != nil {
		t.Fatalf("import hanzi-unit scheme: %v", err)
	}
	// "character" — the entry kind the unit normalizes to — works too.
	if _, err := levels.Import(ctx, sqlDB, buildPack(t, "zh-chars",
		`{"unit":"character","levels":[{"name":"1","entries":["好"]}]}`)); err != nil {
		t.Fatalf("import character-unit scheme: %v", err)
	}

	schemes, err := levels.List(ctx, sqlDB)
	if err != nil {
		t.Fatalf("list schemes: %v", err)
	}
	if len(schemes) != 2 {
		t.Fatalf("levels.List = %+v, want two schemes", schemes)
	}
	for _, s := range schemes {
		if s.Unit != levels.UnitCharacter {
			t.Errorf("unit of scheme %s = %q, want %q", s.PackID, s.Unit, levels.UnitCharacter)
		}
	}

	// Character units rank their members directly — nothing derives —
	// and an entry carries badges from any number of schemes.
	got, err := levels.ForEntry(ctx, sqlDB, hao)
	if err != nil {
		t.Fatalf("badges of 好: %v", err)
	}
	if len(got) != 2 || got[0].Derived || got[1].Derived || got[0].SchemeID == got[1].SchemeID {
		t.Errorf("badges of 好 = %+v, want one direct badge per scheme", got)
	}
	if g, err := levels.ForEntry(ctx, sqlDB, ni); err != nil || len(g) != 1 || g[0].Derived {
		t.Errorf("badges of 你 = %v (err %v), want one direct badge", g, err)
	}
}

func TestUninstallAndReimportRevives(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	sqlDB := newDB(t)
	ctx := context.Background()
	fe := seedFixture(t, entries.Store{DB: sqlDB})

	pack, err := dict.LoadPack(hskMini)
	if err != nil {
		t.Fatalf("load fixture pack: %v", err)
	}
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("import fixture scheme: %v", err)
	}
	schemes, err := levels.List(ctx, sqlDB)
	if err != nil || len(schemes) != 1 {
		t.Fatalf("levels.List = %v (err %v), want one scheme", schemes, err)
	}
	id := schemes[0].ID

	if err := levels.Uninstall(ctx, sqlDB, id); err != nil {
		t.Fatalf("uninstall scheme: %v", err)
	}
	if schemes, err = levels.List(ctx, sqlDB); err != nil || len(schemes) != 0 {
		t.Errorf("levels.List after uninstall = %v (err %v), want none", schemes, err)
	}
	if got, err := levels.ForEntry(ctx, sqlDB, fe.nihao); err != nil || len(got) != 0 {
		t.Errorf("badges of 你好 after uninstall = %v (err %v), want none", got, err)
	}
	var tombstoned int
	if err := sqlDB.QueryRow(`
		SELECT COUNT(*) FROM schemes WHERE id = ? AND deleted_at IS NOT NULL`, id).Scan(&tombstoned); err != nil {
		t.Fatalf("count tombstoned scheme: %v", err)
	}
	if tombstoned != 1 {
		t.Errorf("tombstoned scheme rows = %d, want 1", tombstoned)
	}

	// Unknown and already-uninstalled schemes are ErrNotFound.
	for _, bad := range []int64{id, 999999} {
		if err := levels.Uninstall(ctx, sqlDB, bad); !errors.Is(err, levels.ErrNotFound) {
			t.Errorf("uninstall %d err = %v, want ErrNotFound", bad, err)
		}
	}

	// Re-importing the pack revives the scheme and its memberships.
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("re-import fixture scheme: %v", err)
	}
	if got, err := levels.ForEntry(ctx, sqlDB, fe.chars["好"]); err != nil || len(got) != 1 ||
		got[0].LevelName != "1" || !got[0].Derived {
		t.Errorf("badges of 好 after revive = %v (err %v), want derived level 1", got, err)
	}
}

func TestImportRejectsInvalidPacks(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	sqlDB := newDB(t)
	ctx := context.Background()

	// A dictionary pack is not a levels pack.
	dictPack, err := dict.LoadPack("../dict/testdata/mkgloss")
	if err != nil {
		t.Fatalf("load dictionary fixture: %v", err)
	}
	if _, err := levels.Import(ctx, sqlDB, dictPack); !errors.Is(err, levels.ErrNotLevels) {
		t.Errorf("import dictionary pack err = %v, want ErrNotLevels", err)
	}

	for name, levelsJSON := range map[string]string{
		"unknown unit":   `{"unit":"syllable","levels":[{"name":"1","entries":["你好"]}]}`,
		"no levels":      `{"unit":"word","levels":[]}`,
		"blank name":     `{"unit":"word","levels":[{"name":"  ","entries":["你好"]}]}`,
		"repeat name":    `{"unit":"word","levels":[{"name":"1","entries":["你好"]},{"name":"1","entries":["谢谢"]}]}`,
		"blank form":     `{"unit":"word","levels":[{"name":"1","entries":["你好",""]}]}`,
		"malformed json": `{"unit":`,
	} {
		if _, err := levels.Import(ctx, sqlDB, buildPack(t, "invalid-"+name, levelsJSON)); !errors.Is(err, dict.ErrInvalidPack) {
			t.Errorf("import %s err = %v, want ErrInvalidPack", name, err)
		}
	}

	// A missing levels.json and a non-json format are invalid too.
	if _, err := levels.Import(ctx, sqlDB, buildPack(t, "no-data", "")); !errors.Is(err, dict.ErrInvalidPack) {
		t.Errorf("import pack without levels.json err = %v, want ErrInvalidPack", err)
	}
	if _, err := levels.Import(ctx, sqlDB, buildPackFormat(t, "cedict-format", "cedict",
		`{"unit":"word","levels":[{"name":"1","entries":["你好"]}]}`)); !errors.Is(err, dict.ErrInvalidPack) {
		t.Errorf("import cedict-format levels pack err = %v, want ErrInvalidPack", err)
	}
}
