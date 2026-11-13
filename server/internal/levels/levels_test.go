package levels_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/dict"
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

// importDictionary writes a dictionary pack (manifest m plus one data
// file) into a temp directory and imports it into the lexicon with the
// real importer.
func importDictionary(t *testing.T, sqlDB *sql.DB, m dict.Manifest, file, content string) {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{"manifest.json": string(manifest), file: content} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	p, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack(%s): %v", m.ID, err)
	}
	if _, err := dict.ImportLexicon(context.Background(), sqlDB, &p); err != nil {
		t.Fatalf("import %s: %v", m.ID, err)
	}
}

// importCedict imports CC-CEDICT lines as the zh dictionary pack
// "cedict-test".
func importCedict(t *testing.T, sqlDB *sql.DB, lines ...string) {
	t.Helper()
	lang.Register(lang.Zh{})
	importDictionary(t, sqlDB, dict.Manifest{
		ID: "cedict-test", Name: "CC-CEDICT test", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "MDBG", Format: "cedict",
	}, "dictionary.txt", strings.Join(lines, "\n")+"\n")
}

// lexID returns the id of the zh lexicon entry of kind keyed key (a
// CC-CEDICT entry's key is its simplified form).
func lexID(t *testing.T, sqlDB *sql.DB, kind, key string) int64 {
	t.Helper()
	var id int64
	if err := sqlDB.QueryRow(`SELECT id FROM entries
		WHERE language = 'zh' AND kind = ? AND ext_key = ? AND deleted_at IS NULL`, kind, key).Scan(&id); err != nil {
		t.Fatalf("lexicon entry %s/%s: %v", kind, key, err)
	}
	return id
}

// CC-CEDICT lines of the fixture words and characters.
const (
	lineNihao   = "你好 你好 [ni3 hao3] /hello/"
	lineXiexie  = "謝謝 谢谢 [xie4 xie5] /thanks/"
	lineYinhang = "銀行 银行 [yin2 hang2] /bank/"
	lineHaoren  = "好人 好人 [hao3 ren2] /good person/"
	lineNi      = "你 你 [ni3] /you/"
	lineHao     = "好 好 [hao3] /good/"
	lineXie     = "謝 谢 [xie4] /to thank/"
	lineYin     = "銀 银 [yin2] /silver/"
	lineXing    = "行 行 [xing2] /to walk/"
	lineFa      = "發 发 [fa1] /to send out/"
	lineRen     = "人 人 [ren2] /person/"
)

// fixtureEntries are the entry ids the fixture scheme's tests refer to.
type fixtureEntries struct {
	nihao, xiexie, yinhang int64            // the fixture's member words
	chars                  map[string]int64 // every character by written form
}

// seedFixture imports the fixture scheme's words and the characters they
// are written with, plus 发, which no scheme touches.
func seedFixture(t *testing.T, sqlDB *sql.DB) fixtureEntries {
	t.Helper()
	importCedict(t, sqlDB, lineNihao, lineXiexie, lineYinhang, lineNi, lineHao, lineXie, lineYin, lineXing, lineFa)
	fe := fixtureEntries{
		nihao:   lexID(t, sqlDB, "word", "你好"),
		xiexie:  lexID(t, sqlDB, "word", "谢谢"),
		yinhang: lexID(t, sqlDB, "word", "银行"),
		chars:   map[string]int64{},
	}
	for _, c := range []string{"你", "好", "谢", "银", "行", "发"} {
		fe.chars[c] = lexID(t, sqlDB, "character", c)
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
	fe := seedFixture(t, sqlDB)

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
	importCedict(t, sqlDB, lineNihao, lineXiexie, lineNi, lineHao, lineXie)
	nihao := lexID(t, sqlDB, "word", "你好")
	xiexie := lexID(t, sqlDB, "word", "谢谢")
	ni := lexID(t, sqlDB, "character", "你")
	hao := lexID(t, sqlDB, "character", "好")
	xie := lexID(t, sqlDB, "character", "谢")

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
	// 好 is written in a level-1 word (你好) and a level-2 word (好人).
	importCedict(t, sqlDB, lineNihao, lineHaoren, lineNi, lineHao, lineRen)
	nihao := lexID(t, sqlDB, "word", "你好")
	haoren := lexID(t, sqlDB, "word", "好人")
	ni := lexID(t, sqlDB, "character", "你")
	hao := lexID(t, sqlDB, "character", "好")
	ren := lexID(t, sqlDB, "character", "人")

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

// TestSingleCharacterWords: a word list names one-character words (HSK 1
// lists 好 and 人), which CC-CEDICT gives as character entries, not
// words. Such a form falls back to its character entry and joins the
// level directly (not derived), even when a word of the same level
// listed before it already derived it (好人 before 人); a later word
// written with it does not add a second, higher badge.
func TestSingleCharacterWords(t *testing.T) {
	lang.Register(lang.Zh{})

	sqlDB := newDB(t)
	ctx := context.Background()
	importCedict(t, sqlDB, lineNihao, lineHaoren, lineNi, lineHao, lineRen)
	nihao := lexID(t, sqlDB, "word", "你好")
	haoren := lexID(t, sqlDB, "word", "好人")
	ni := lexID(t, sqlDB, "character", "你")
	hao := lexID(t, sqlDB, "character", "好")
	ren := lexID(t, sqlDB, "character", "人")

	pack := buildPack(t, "single", `{"unit":"word","levels":[
		{"name":"1","entries":["好","你好"]},
		{"name":"2","entries":["好人","人","猫"]}]}`)
	res, err := levels.Import(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("import scheme: %v", err)
	}
	// Direct: 好, 你好, 人, 好人. Derived: 你 only — 好 and 人 are direct
	// members of the level their own word sits in. 猫 has no entry.
	if res.Members != 4 || res.Derived != 1 || !slices.Equal(res.Skipped, []string{"猫"}) {
		t.Errorf("import result = %+v, want 4 members, 1 derived, skipped [猫]", res)
	}
	for _, c := range []struct {
		name    string
		id      int64
		level   string
		derived bool
	}{
		{"好", hao, "1", false},
		{"人", ren, "2", false},
		{"你", ni, "1", true},
		{"你好", nihao, "1", false},
		{"好人", haoren, "2", false},
	} {
		got, err := levels.ForEntry(ctx, sqlDB, c.id)
		if err != nil || len(got) != 1 || got[0].LevelName != c.level || got[0].Derived != c.derived {
			t.Errorf("badges of %s = %+v (err %v), want only level %s (derived %v)", c.name, got, err, c.level, c.derived)
		}
	}
}

// TestCharacterResolvesToItsOwnEntry: CC-CEDICT merges the traditional
// forms of a simplified character into its entry (复 holds 復 and 覆), and
// 覆 also has an entry of its own. A listed or derived character 覆
// resolves to the entry headed by 覆 (its own map cell), not to 复.
func TestCharacterResolvesToItsOwnEntry(t *testing.T) {
	lang.Register(lang.Zh{})

	sqlDB := newDB(t)
	ctx := context.Background()
	importCedict(t, sqlDB,
		"復 复 [fu4] /to return/",
		"覆 复 [fu4] /variant of 復/",
		"覆 覆 [fu4] /to cover/",
		"蓋 盖 [gai4] /lid/",
		"覆蓋 覆盖 [fu4 gai4] /to cover/")
	fu := lexID(t, sqlDB, "character", "复")
	cover := lexID(t, sqlDB, "character", "覆")
	if fu == cover {
		t.Fatal("fixture: 复 and 覆 share an entry")
	}

	chars := buildPack(t, "own-chars", `{"unit":"character","levels":[{"name":"1","entries":["覆"]}]}`)
	if _, err := levels.Import(ctx, sqlDB, chars); err != nil {
		t.Fatalf("import characters: %v", err)
	}
	words := buildPack(t, "own-words", `{"unit":"word","levels":[{"name":"1","entries":["覆盖"]}]}`)
	if _, err := levels.Import(ctx, sqlDB, words); err != nil {
		t.Fatalf("import words: %v", err)
	}
	if got, err := levels.ForEntry(ctx, sqlDB, cover); err != nil || len(got) != 2 {
		t.Errorf("badges of 覆 = %+v (err %v), want the character level and the derived word level", got, err)
	}
	if got, err := levels.ForEntry(ctx, sqlDB, fu); err != nil || len(got) != 0 {
		t.Errorf("badges of 复 = %+v (err %v), want none", got, err)
	}
}

// TestOneLevelPerEntry: an entry carries one level of a scheme, its
// lowest, whatever the pack lists: a word repeated at a higher level
// (HSK lists senses separately: 好 at 1, 2 and 4) and a character derived
// low but listed directly higher (些 from 一些 at 1, 些 itself at 4) keep
// only the lowest.
func TestOneLevelPerEntry(t *testing.T) {
	lang.Register(lang.Zh{})

	sqlDB := newDB(t)
	ctx := context.Background()
	importCedict(t, sqlDB, lineNihao, lineHaoren, lineNi, lineHao, lineRen)
	nihao := lexID(t, sqlDB, "word", "你好")
	hao := lexID(t, sqlDB, "character", "好")
	ren := lexID(t, sqlDB, "character", "人")

	pack := buildPack(t, "lowest-only", `{"unit":"word","levels":[
		{"name":"1","entries":["你好"]},
		{"name":"2","entries":["你好","好人"]},
		{"name":"3","entries":["好","人","你好"]}]}`)
	if _, err := levels.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("import: %v", err)
	}
	for _, c := range []struct {
		name    string
		id      int64
		level   string
		derived bool
	}{
		{"你好", nihao, "1", false},
		{"好", hao, "1", true},
		{"人", ren, "2", true},
	} {
		got, err := levels.ForEntry(ctx, sqlDB, c.id)
		if err != nil || len(got) != 1 || got[0].LevelName != c.level || got[0].Derived != c.derived {
			t.Errorf("badges of %s = %+v (err %v), want only level %s (derived %v)", c.name, got, err, c.level, c.derived)
		}
	}
}

func TestSkippedUnknownForms(t *testing.T) {
	// Entries carry readings normalized through the zh pack.
	lang.Register(lang.Zh{})

	sqlDB := newDB(t)
	ctx := context.Background()
	// 电脑 is no entry; the character 谢 is missing too.
	importCedict(t, sqlDB, lineNihao, lineXiexie, lineNi, lineHao)
	nihao := lexID(t, sqlDB, "word", "你好")
	xiexie := lexID(t, sqlDB, "word", "谢谢")
	ni := lexID(t, sqlDB, "character", "你")
	hao := lexID(t, sqlDB, "character", "好")

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
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM forms WHERE text = '电脑'`).Scan(&unknown); err != nil {
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
	importCedict(t, sqlDB, lineHao, lineNi)
	hao := lexID(t, sqlDB, "character", "好")
	ni := lexID(t, sqlDB, "character", "你")

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
	fe := seedFixture(t, sqlDB)

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

// sharedFormJMdict holds two JMdict words written 下 — the second carries
// priority, so it is the best-ranked — and 食べる.
const sharedFormJMdict = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY n "noun (common) (futsuumeishi)">
<!ENTITY v1 "Ichidan verb">
<!ENTITY uk "word usually written using kana alone">
]>
<JMdict>
<entry>
<ent_seq>1009800</ent_seq>
<k_ele><keb>下</keb></k_ele>
<r_ele><reb>もと</reb></r_ele>
<sense><pos>&n;</pos><gloss>under (the influence of)</gloss></sense>
</entry>
<entry>
<ent_seq>1009850</ent_seq>
<k_ele><keb>下</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>した</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>below</gloss></sense>
</entry>
<entry>
<ent_seq>1358280</ent_seq>
<k_ele><keb>食べる</keb><ke_pri>ichi1</ke_pri></k_ele>
<r_ele><reb>たべる</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v1;</pos><gloss>to eat</gloss></sense>
</entry>
<entry>
<ent_seq>1157170</ent_seq>
<k_ele><keb>為る</keb></k_ele>
<r_ele><reb>する</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&v1;</pos><misc>&uk;</misc><gloss>to do</gloss></sense>
</entry>
<entry>
<ent_seq>1081610</ent_seq>
<r_ele><reb>テレビ</reb><re_pri>ichi1</re_pri></r_ele>
<sense><pos>&n;</pos><gloss>television</gloss></sense>
</entry>
</JMdict>
`

// sharedFormKanjidic2 holds the kanji 下 and 食.
const sharedFormKanjidic2 = `<?xml version="1.0" encoding="UTF-8"?>
<kanjidic2>
<character><literal>下</literal>
<radical><rad_value rad_type="classical">1</rad_value></radical>
<misc><stroke_count>3</stroke_count></misc>
<reading_meaning><rmgroup><reading r_type="ja_on">カ</reading><meaning>below</meaning></rmgroup></reading_meaning>
</character>
<character><literal>食</literal>
<radical><rad_value rad_type="classical">184</rad_value></radical>
<misc><stroke_count>9</stroke_count></misc>
<reading_meaning><rmgroup><reading r_type="ja_on">ショク</reading><meaning>eat</meaning></rmgroup></reading_meaning>
</character>
</kanjidic2>
`

func TestSharedFormResolvesToBestRankedEntry(t *testing.T) {
	lang.Register(lang.Ja{})
	sqlDB := newDB(t)
	ctx := context.Background()
	importDictionary(t, sqlDB, dict.Manifest{
		ID: "jmdict-test", Name: "JMdict test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	}, "jmdict.xml", sharedFormJMdict)
	importDictionary(t, sqlDB, dict.Manifest{
		ID: "kanjidic2", Name: "KANJIDIC2 test", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "kanjidic2",
	}, "kanjidic2.xml", sharedFormKanjidic2)
	key := func(kind, k string) int64 {
		t.Helper()
		var id int64
		if err := sqlDB.QueryRow(`SELECT id FROM entries WHERE language = 'ja' AND kind = ? AND ext_key = ?`, kind, k).Scan(&id); err != nil {
			t.Fatalf("lexicon entry %s/%s: %v", kind, k, err)
		}
		return id
	}
	moto, shita, taberu := key("word", "j:1009800"), key("word", "j:1009850"), key("word", "j:1358280")
	suru, terebi := key("word", "j:1157170"), key("word", "j:1081610")
	shitaChar, shoku := key("character", "下"), key("character", "食")

	dir := t.TempDir()
	manifest := `{"id":"jlpt-test","name":"JLPT test","version":"1.0","type":"levels",` +
		`"language":"ja","license":"CC0-1.0","attribution":"Qinqin test fixtures","format":"json"}`
	for name, body := range map[string]string{
		"manifest.json": manifest,
		"levels.json":   `{"unit":"word","levels":[{"name":"N5","entries":["下","食べる","する","テレビ"]}]}`,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatal(err)
	}
	res, err := levels.Import(ctx, sqlDB, pack)
	if err != nil {
		t.Fatalf("import scheme: %v", err)
	}
	// Kana-written words resolve by their first kana reading (する is
	// the usually-kana 為る, テレビ has no written form). Only the Han
	// characters of the listed forms derive: kana are neither members
	// nor reported as skipped.
	if res.Members != 4 || res.Derived != 2 || len(res.Skipped) != 0 {
		t.Errorf("import result = %+v, want 4 members, 2 derived (下, 食), nothing skipped", res)
	}
	for name, tc := range map[string]struct {
		id      int64
		badges  int
		derived bool
	}{
		"下 (した, best-ranked)": {shita, 1, false},
		"下 (もと)":              {moto, 0, false},
		"食べる":                 {taberu, 1, false},
		"する (為る)":             {suru, 1, false},
		"テレビ":                 {terebi, 1, false},
		"kanji 下":             {shitaChar, 1, true},
		"kanji 食":             {shoku, 1, true},
	} {
		got, err := levels.ForEntry(ctx, sqlDB, tc.id)
		if err != nil || len(got) != tc.badges || (tc.badges > 0 && (got[0].LevelName != "N5" || got[0].Derived != tc.derived)) {
			t.Errorf("badges of %s = %+v (err %v), want %d (derived %v)", name, got, err, tc.badges, tc.derived)
		}
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
