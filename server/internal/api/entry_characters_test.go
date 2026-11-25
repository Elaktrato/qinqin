package api_test

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	"qinqin/internal/api"
	"qinqin/internal/dbtest"
	"qinqin/internal/lang"
	"qinqin/internal/pack"
)

const entriesCharacters = "学 学 [xue2] /to learn/\n" +
	"习 习 [xi2] /to practise/\n" +
	"学习 学习 [xue2xi2] /to study/\n"

// entriesFoldedCharacters: CC-CEDICT merges 覆 into 复's entry (复 holds 覆),
// while 覆 also heads an entry of its own.
const entriesFoldedCharacters = "復 复 [fu4] /to return/\n" +
	"覆 复 [fu4] /variant of 復/\n" +
	"覆 覆 [fu4] /to cover/\n" +
	"蓋 盖 [gai4] /lid/\n" +
	"覆蓋 覆盖 [fu4 gai4] /to cover/\n"

func TestEntryCharactersChineseWord(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	lookupImport(t, sqlDB, pack.Manifest{
		ID: "chars-test", Name: "Character test", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "test", Format: "cedict",
	}, "dictionary.txt", entriesCharacters)
	id := lexID(t, sqlDB, "zh", "word", "学习")
	body := getEntryBody(t, ts.URL, id)
	if len(body.Characters) != 2 {
		t.Fatalf("characters = %+v", body.Characters)
	}
	xue, xi := body.Characters[0], body.Characters[1]
	if xue.Written != "学" || xi.Written != "习" || xue.Gloss != "to learn" || xi.Gloss != "to practise" {
		t.Errorf("characters = %+v, want 学 then 习 with their glosses", body.Characters)
	}
	if xue.Reading == nil || xue.Reading.Type != "pinyin" || xue.Reading.Value == "" {
		t.Errorf("学 reading = %+v", xue.Reading)
	}
	if xue.Radical != nil || xue.Strokes != 0 || xue.Levels == nil || len(xue.Levels) != 0 {
		t.Errorf("学 extras = radical %+v strokes %d levels %+v, want none and []", xue.Radical, xue.Strokes, xue.Levels)
	}
}

// TestEntryCharactersResolveTheirOwnForm: 覆 appears as a traditional form of
// 复's entry AND as its own entry; the character of 覆盖 is 覆 (its own entry,
// glyph, strokes and gloss), not 复.
func TestEntryCharactersResolveTheirOwnForm(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	lookupImport(t, sqlDB, pack.Manifest{
		ID: "folded-chars", Name: "Folded characters", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "test", Format: "cedict",
	}, "dictionary.txt", entriesFoldedCharacters)
	id := lexID(t, sqlDB, "zh", "word", "覆盖")
	fu := lexID(t, sqlDB, "zh", "character", "复")
	fuCover := lexID(t, sqlDB, "zh", "character", "覆")
	if fu == fuCover {
		t.Fatal("fixture: 复 and 覆 share an entry")
	}
	body := getEntryBody(t, ts.URL, id)
	if len(body.Characters) != 2 {
		t.Fatalf("characters = %+v, want 覆 then 盖", body.Characters)
	}
	cover, gai := body.Characters[0], body.Characters[1]
	if cover.Written != "覆" || cover.ID != fuCover {
		t.Errorf("first character = %+v, want 覆 (id %d), not 复 (id %d)", cover, fuCover, fu)
	}
	if cover.Gloss != "to cover" {
		t.Errorf("覆 gloss = %q, want its own entry's %q", cover.Gloss, "to cover")
	}
	if gai.Written != "盖" {
		t.Errorf("second character = %+v, want 盖", gai)
	}
}

// TestEntryCharactersDedupeByEntry: two written forms that fold into one
// character entry produce one row (a duplicate id would break the keyed list).
func TestEntryCharactersDedupeByEntry(t *testing.T) {
	// A clean lexicon: Unihan's own character rows would give 復 and 覆
	// their own entries, and this test needs both forms to fold into 复.
	lang.Register(lang.Zh{})
	ts, sqlDB := newServer(t)
	lookupImport(t, sqlDB, pack.Manifest{
		ID: "folded-one", Name: "Folded forms", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "test", Format: "cedict",
	}, "dictionary.txt", "復 复 [fu4] /to return/\n覆 复 [fu4] /variant of 復/\n復覆 復覆 [fu4 fu4] /(rare) both/\n")
	id := lexID(t, sqlDB, "zh", "word", "復覆")
	fu := lexID(t, sqlDB, "zh", "character", "复")
	body := getEntryBody(t, ts.URL, id)
	if len(body.Characters) != 1 {
		t.Fatalf("characters = %+v, want one row for the 复 entry", body.Characters)
	}
	if got := body.Characters[0]; got.ID != fu || got.Written != "復" {
		t.Errorf("character = %+v, want 復 with the 复 entry id %d", got, fu)
	}
}

func TestEntryCharactersJapaneseWord(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	const jmdict = `<?xml version="1.0" encoding="UTF-8"?>
<JMdict>
<entry>
<ent_seq>9999901</ent_seq>
<k_ele><keb>学ぶ</keb></k_ele>
<r_ele><reb>まなぶ</reb></r_ele>
<sense><gloss>to learn</gloss></sense>
</entry>
</JMdict>
`
	lookupImport(t, sqlDB, pack.Manifest{
		ID: "jmdict-characters", Name: "JMdict characters", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "test", Format: "jmdict",
	}, "jmdict.xml", jmdict)
	kanji, err := os.ReadFile("../dict/testdata/kanjidic2-sample.xml")
	if err != nil {
		t.Fatalf("read kanjidic2 fixture: %v", err)
	}
	lookupImport(t, sqlDB, pack.Manifest{
		ID: "kanjidic2-characters", Name: "KANJIDIC2 characters", Version: "1", Type: "dictionary", Language: "ja",
		License: "CC BY-SA 4.0", Attribution: "test", Format: "kanjidic2",
	}, "kanjidic2.xml", string(kanji))
	id := lexID(t, sqlDB, "ja", "word", "j:9999901")
	gaku := lexID(t, sqlDB, "ja", "character", "学")
	body := getEntryBody(t, ts.URL, id)
	if len(body.Characters) != 1 {
		t.Fatalf("characters = %+v, want only the kanji 学", body.Characters)
	}
	if got := body.Characters[0]; got.ID != gaku || got.Written != "学" {
		t.Errorf("character = %+v, want 学 (id %d); the kana is never a character", got, gaku)
	}
	if got := body.Characters[0]; got.Reading == nil || got.Gloss == "" {
		t.Errorf("学 = %+v, want KANJIDIC2's reading and gloss", got)
	}
}

func TestEntryCharactersDistinctAndCapped(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	forms := []string{"一", "二", "三", "四", "五", "六", "七", "八", "九", "人"}
	var b strings.Builder
	for _, f := range forms {
		fmt.Fprintf(&b, "%s %s [yi1] /one/\n", f, f)
	}
	fmt.Fprintf(&b, "一二三四五六七八九 一二三四五六七八九 [yi1] /many/\n")
	fmt.Fprintf(&b, "人人 人人 [ren2 ren2] /everybody/\n")
	lookupImport(t, sqlDB, pack.Manifest{
		ID: "cap-chars", Name: "Cap characters", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "test", Format: "cedict",
	}, "dictionary.txt", b.String())

	nine := lexID(t, sqlDB, "zh", "word", "一二三四五六七八九")
	body := getEntryBody(t, ts.URL, nine)
	if len(body.Characters) != 8 {
		t.Fatalf("characters = %d (%+v), want at most 8", len(body.Characters), body.Characters)
	}
	if got := []rune(body.Characters[0].Written)[0]; got != '一' {
		t.Errorf("first character = %q, want 一", string(got))
	}
	seen := map[int64]bool{}
	for _, c := range body.Characters {
		if seen[c.ID] {
			t.Errorf("character id %d appears twice: %+v", c.ID, body.Characters)
		}
		seen[c.ID] = true
	}

	people := lexID(t, sqlDB, "zh", "word", "人人")
	body = getEntryBody(t, ts.URL, people)
	if len(body.Characters) != 1 || body.Characters[0].Written != "人" {
		t.Errorf("人人 characters = %+v, want one 人", body.Characters)
	}
}

// countingConnector counts every statement its connections run.
type countingConnector struct {
	drv   driver.Driver
	dsn   string
	count *atomic.Int64
}

func (c countingConnector) Connect(context.Context) (driver.Conn, error) {
	conn, err := c.drv.Open(c.dsn)
	if err != nil {
		return nil, err
	}
	return countingConn{conn, c.count}, nil
}

func (c countingConnector) Driver() driver.Driver { return c.drv }

type countingConn struct {
	driver.Conn
	count *atomic.Int64
}

func (c countingConn) Prepare(query string) (driver.Stmt, error) {
	c.count.Add(1)
	return c.Conn.Prepare(query)
}

func (c countingConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	q, ok := c.Conn.(driver.QueryerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	c.count.Add(1)
	return q.QueryContext(ctx, query, args)
}

func (c countingConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	e, ok := c.Conn.(driver.ExecerContext)
	if !ok {
		return nil, driver.ErrSkip
	}
	c.count.Add(1)
	return e.ExecContext(ctx, query, args)
}

// TestEntryCharactersQueriesBounded: a 2-character and a 6-character word
// cost the same number of statements (one ByForm, one Radicals, one
// GetMany for each, one levels query — never one per character).
func TestEntryCharactersQueriesBounded(t *testing.T) {
	sqlDB, path := dbtest.OpenPath(t)
	seedEntries(t, sqlDB)
	var b strings.Builder
	for _, f := range []string{"一", "二", "三", "四", "五", "六"} {
		fmt.Fprintf(&b, "%s %s [yi1] /one/\n", f, f)
	}
	fmt.Fprintf(&b, "一二 一二 [yi1er4] /two/\n")
	fmt.Fprintf(&b, "一二三四五六 一二三四五六 [yi1] /six/\n")
	lookupImport(t, sqlDB, pack.Manifest{
		ID: "bounded-chars", Name: "Bounded characters", Version: "1", Type: "dictionary", Language: "zh",
		License: "CC BY-SA 4.0", Attribution: "test", Format: "cedict",
	}, "dictionary.txt", b.String())

	var count atomic.Int64
	counted := sql.OpenDB(countingConnector{
		drv:   sqlDB.Driver(),
		dsn:   path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)",
		count: &count,
	})
	t.Cleanup(func() { counted.Close() })
	ts := newTestServer(counted, api.New(counted, t.TempDir(), nil))
	t.Cleanup(ts.Close)

	two := lexID(t, sqlDB, "zh", "word", "一二")
	six := lexID(t, sqlDB, "zh", "word", "一二三四五六")

	count.Store(0)
	if body := getEntryBody(t, ts.URL, two); len(body.Characters) != 2 {
		t.Fatalf("two-character word characters = %+v", body.Characters)
	}
	short := count.Load()

	count.Store(0)
	if body := getEntryBody(t, ts.URL, six); len(body.Characters) != 6 {
		t.Fatalf("six-character word characters = %+v", body.Characters)
	}
	long := count.Load()

	if short != long {
		t.Errorf("a 2-character word ran %d statements, a 6-character word %d; want the same", short, long)
	}
}

func TestEntryCharactersEmpty(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	hao := lexID(t, sqlDB, "zh", "character", "好")
	body := getEntryBody(t, ts.URL, hao)
	if body.Characters == nil || len(body.Characters) != 0 {
		t.Errorf("character entry characters = %#v, want []", body.Characters)
	}
}
