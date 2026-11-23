package dict_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"qinqin/internal/dbtest"
	"qinqin/internal/dict"
	"qinqin/internal/lexicon"
)

// lexPack writes one data file and the manifest m into a fresh directory
// and loads it as a pack.
func lexPack(t *testing.T, m dict.Manifest, file, content string) *dict.Pack {
	t.Helper()
	dir := t.TempDir()
	manifest, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	mustWriteFile(t, filepath.Join(dir, "manifest.json"), string(manifest))
	mustWriteFile(t, filepath.Join(dir, file), content)
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	return &pack
}

func importLexiconPack(t *testing.T, sqlDB *sql.DB, p *dict.Pack) dict.Result {
	t.Helper()
	res, err := dict.ImportLexicon(context.Background(), sqlDB, p)
	if err != nil {
		t.Fatalf("ImportLexicon(%s): %v", p.ID, err)
	}
	return res
}

// lexByKey loads the active entry of (language, kind, key).
func lexByKey(t *testing.T, sqlDB *sql.DB, language, kind, key string) lexicon.Entry {
	t.Helper()
	var id int64
	if err := sqlDB.QueryRow(`SELECT id FROM entries WHERE language = ? AND kind = ? AND ext_key = ? AND deleted_at IS NULL`,
		language, kind, key).Scan(&id); err != nil {
		t.Fatalf("find entry %s/%s/%s: %v", language, kind, key, err)
	}
	e, err := lexicon.Store{DB: sqlDB}.Get(context.Background(), id)
	if err != nil {
		t.Fatalf("get entry %s/%s/%s: %v", language, kind, key, err)
	}
	return *e
}

// lexLinks returns the keys of the entries e links to with typ.
func lexLinks(t *testing.T, sqlDB *sql.DB, e lexicon.Entry, typ string) []string {
	t.Helper()
	rows, err := sqlDB.Query(`SELECT x.ext_key FROM entry_links l JOIN entries x ON x.id = l.to_id
		WHERE l.from_id = ? AND l.type = ? AND l.deleted_at IS NULL ORDER BY x.ext_key`, e.ID, typ)
	if err != nil {
		t.Fatalf("links of %s: %v", e.Key, err)
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			t.Fatal(err)
		}
		keys = append(keys, k)
	}
	return keys
}

func readingList(e lexicon.Entry) []string {
	var out []string
	for _, r := range e.Readings {
		out = append(out, r.Type+"|"+r.Value+"|"+r.Plain)
	}
	return out
}

func formList(e lexicon.Entry) []string {
	var out []string
	for _, f := range e.Forms {
		out = append(out, f.Text+"|"+strings.Join(f.Flags, ","))
	}
	return out
}

// senseGlosses returns "<pack id>: gloss/gloss" per active sense.
func senseGlosses(t *testing.T, sqlDB *sql.DB, e lexicon.Entry) []string {
	t.Helper()
	var out []string
	for _, s := range e.Senses {
		var packID string
		if err := sqlDB.QueryRow(`SELECT pack_id FROM dictionaries WHERE id = ?`, s.DictionaryID).Scan(&packID); err != nil {
			t.Fatal(err)
		}
		out = append(out, packID+": "+strings.Join(s.Glosses, "/"))
	}
	return out
}

func assertNoLexiconRows(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	for _, table := range []string{"entries", "forms", "readings", "senses", "entry_links", "dictionaries"} {
		if n := totalRows(t, sqlDB, table); n != 0 {
			t.Errorf("%s has %d rows after a failed import, want 0", table, n)
		}
	}
}

func countWhere(t *testing.T, sqlDB *sql.DB, table, where string) int {
	t.Helper()
	var n int
	if err := sqlDB.QueryRow(`SELECT COUNT(*) FROM ` + table + ` WHERE ` + where).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

const lexCedict = `# CC-CEDICT
行 行 [xing2] /to walk/to go/
行 行 [hang2] /row/line/
發 发 [fa1] /to send out/
髮 发 [fa4] /hair/
乾 干 [gan1] /dry/
乾 乾 [qian2] /heaven (trigram)/
好 好 [hao3] /good/
你好 你好 [ni3 hao3] /hello/hi/
`

var cedictLexManifest = dict.Manifest{
	ID: "cedict-lex", Name: "CC-CEDICT lex", Version: "1.0", Type: "dictionary", Language: "zh",
	License: "CC BY-SA 4.0", Attribution: "CC-CEDICT contributors", Format: "cedict",
}

func cedictLexPack(t *testing.T, content string) *dict.Pack {
	t.Helper()
	return lexPack(t, cedictLexManifest, "dictionary.txt", content)
}

func TestLexiconCedictHomographsMergeIntoOneEntry(t *testing.T) {
	sqlDB := dbtest.Open(t)
	res := importLexiconPack(t, sqlDB, cedictLexPack(t, lexCedict))
	// 行, 发, 干, 乾, 好, 你好: six simplified forms.
	if res.Entries != 6 || res.Senses != 8 || res.Skipped != 0 || res.Unconverted != 0 {
		t.Errorf("result = %+v, want 6 entries, 8 senses", res)
	}

	xing := lexByKey(t, sqlDB, "zh", "character", "行")
	want := []string{"pinyin|xíng|xing", "pinyin|háng|hang", "bopomofo|ㄒㄧㄥˊ|ㄒㄧㄥˊ", "bopomofo|ㄏㄤˊ|ㄏㄤˊ"}
	if got := readingList(xing); !reflect.DeepEqual(got, want) {
		t.Errorf("行 readings = %v, want %v", got, want)
	}
	if got, want := senseGlosses(t, sqlDB, xing), []string{"cedict-lex: to walk/to go", "cedict-lex: row/line"}; !reflect.DeepEqual(got, want) {
		t.Errorf("行 senses = %v, want %v", got, want)
	}
	if n := countWhere(t, sqlDB, "entries", "ext_key = '行'"); n != 1 {
		t.Errorf("行 entries = %d, want 1", n)
	}

	hao := lexByKey(t, sqlDB, "zh", "word", "你好")
	if hao.Language != "zh" || hao.Kind != "word" {
		t.Errorf("你好 identity = %s/%s", hao.Language, hao.Kind)
	}
}

func TestLexiconCedictTraditionalForms(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importLexiconPack(t, sqlDB, cedictLexPack(t, lexCedict))
	st := lexicon.Store{DB: sqlDB}
	ctx := context.Background()

	fa := lexByKey(t, sqlDB, "zh", "character", "发")
	if got, want := formList(fa), []string{"发|", "發|trad", "髮|trad"}; !reflect.DeepEqual(got, want) {
		t.Errorf("发 forms = %v, want %v", got, want)
	}
	byForm, err := st.ByForm(ctx, "zh", []string{"發", "髮", "乾"})
	if err != nil {
		t.Fatal(err)
	}
	for _, trad := range []string{"發", "髮"} {
		if es := byForm[trad]; len(es) != 1 || es[0].Key != "发" {
			t.Errorf("ByForm(%s) = %v, want the simplified entry 发", trad, es)
		}
	}
	// 乾 is the traditional form of 干 and the simplified form of 乾.
	var keys []string
	for _, e := range byForm["乾"] {
		keys = append(keys, e.Key)
	}
	if want := []string{"干", "乾"}; !reflect.DeepEqual(keys, want) {
		t.Errorf("ByForm(乾) keys = %v, want %v", keys, want)
	}
	// A form that is its own simplified form carries no trad flag.
	if got, want := formList(lexByKey(t, sqlDB, "zh", "character", "乾")), []string{"乾|"}; !reflect.DeepEqual(got, want) {
		t.Errorf("乾 forms = %v, want %v", got, want)
	}
}

func TestLexiconCedictCountsSkippedAndUnconverted(t *testing.T) {
	sqlDB := dbtest.Open(t)
	var b strings.Builder
	for i := 0; i < 40; i++ {
		fmt.Fprintf(&b, "字%d 字%d [zi4] /letter %d/\n", i, i, i)
	}
	b.WriteString("not an entry line\n")
	b.WriteString("非 非 [qqq9] /odd pinyin/\n")
	res := importLexiconPack(t, sqlDB, cedictLexPack(t, b.String()))
	if res.Skipped != 1 || res.Unconverted != 1 || res.Entries != 41 {
		t.Errorf("result = %+v, want 41 entries, 1 skipped, 1 unconverted", res)
	}
	fei := lexByKey(t, sqlDB, "zh", "character", "非")
	if got := readingList(fei); len(got) != 1 || !strings.HasPrefix(got[0], "pinyin|qqq9|") {
		t.Errorf("unconverted pinyin readings = %v, want the pinyin kept as written", got)
	}
}

func TestLexiconCedictMalformedShareAbortsWholePack(t *testing.T) {
	sqlDB := dbtest.Open(t)
	bad := "好 好 [hao3] /good/\n你好 你好 [ni3 hao3] /hello/\nbroken line one\n"
	if _, err := dict.ImportLexicon(context.Background(), sqlDB, cedictLexPack(t, bad)); err == nil {
		t.Fatal("ImportLexicon with 1/3 malformed lines succeeded")
	}
	assertNoLexiconRows(t, sqlDB)
}

func TestLexiconCedictReadingsAreSearchableByPlain(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importLexiconPack(t, sqlDB, cedictLexPack(t, lexCedict))
	got, err := lexicon.Store{DB: sqlDB}.ByReading(context.Background(), "zh", []string{"hang"})
	if err != nil {
		t.Fatal(err)
	}
	if es := got["hang"]; len(es) != 1 || es[0].Key != "行" {
		t.Errorf("ByReading(hang) = %v, want 行", es)
	}
}

func unihanLexPack(t *testing.T) *dict.Pack {
	t.Helper()
	data, err := os.ReadFile(unihanFixture)
	if err != nil {
		t.Fatal(err)
	}
	return lexPack(t, unihanManifest, "dictionary.txt", string(data))
}

func TestLexiconUnihanEntriesLinksAndSenses(t *testing.T) {
	sqlDB := dbtest.Open(t)
	res := importLexiconPack(t, sqlDB, unihanLexPack(t))
	// 好, 复, 復, 複 are mentioned; the bare radical 女 is not counted.
	if res.Entries != 4 || res.Senses != 1 {
		t.Errorf("result = %+v, want 4 entries, 1 sense", res)
	}
	hao := lexByKey(t, sqlDB, "zh", "character", "好")
	if got, want := senseGlosses(t, sqlDB, hao), []string{"unihan: good, excellent, fine; well"}; !reflect.DeepEqual(got, want) {
		t.Errorf("好 senses = %v, want %v", got, want)
	}
	if got, want := formList(hao), []string{"好|"}; !reflect.DeepEqual(got, want) {
		t.Errorf("好 forms = %v, want %v", got, want)
	}
	if len(hao.Readings) != 0 {
		t.Errorf("好 readings = %v, want none", hao.Readings)
	}
	if got, want := lexLinks(t, sqlDB, hao, "radical"), []string{"女"}; !reflect.DeepEqual(got, want) {
		t.Errorf("好 radical links = %v, want %v", got, want)
	}
	nu := lexByKey(t, sqlDB, "zh", "character", "女")
	if len(nu.Senses) != 0 || nu.Language != "zh" {
		t.Errorf("radical entry 女 = %+v, want bare zh entry", nu)
	}

	fu := lexByKey(t, sqlDB, "zh", "character", "复")
	if got, want := lexLinks(t, sqlDB, fu, "variant"), []string{"復", "複"}; !reflect.DeepEqual(got, want) {
		t.Errorf("复 variants = %v, want %v", got, want)
	}
	for _, trad := range []string{"復", "複"} {
		e := lexByKey(t, sqlDB, "zh", "character", trad)
		if got := lexLinks(t, sqlDB, e, "variant"); !reflect.DeepEqual(got, []string{"复"}) {
			t.Errorf("%s variants = %v, want [复] (both directions)", trad, got)
		}
	}
	var packID string
	if err := sqlDB.QueryRow(`SELECT pack_id FROM dictionaries`).Scan(&packID); err != nil || packID != "unihan" {
		t.Errorf("dictionary = %q, %v, want the built-in unihan", packID, err)
	}
}

const lexCedictChars = "復 复 [fu4] /to repeat/\n好 好 [hao3] /good/\n"

// checkMergedChars asserts what CEDICT and Unihan together must leave on
// the single hanzi they both mention, whichever imported first.
func checkMergedChars(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	hao := lexByKey(t, sqlDB, "zh", "character", "好")
	if got, want := readingList(hao), []string{"pinyin|hǎo|hao", "bopomofo|ㄏㄠˇ|ㄏㄠˇ"}; !reflect.DeepEqual(got, want) {
		t.Errorf("好 readings = %v, want %v", got, want)
	}
	got := senseGlosses(t, sqlDB, hao)
	slices.Sort(got)
	if want := []string{"cedict-lex: good", "unihan: good, excellent, fine; well"}; !reflect.DeepEqual(got, want) {
		t.Errorf("好 senses = %v, want %v", got, want)
	}
	if got, want := lexLinks(t, sqlDB, hao, "radical"), []string{"女"}; !reflect.DeepEqual(got, want) {
		t.Errorf("好 radical links = %v, want %v", got, want)
	}
	fu := lexByKey(t, sqlDB, "zh", "character", "复")
	if got, want := formList(fu), []string{"复|", "復|trad"}; !reflect.DeepEqual(got, want) {
		t.Errorf("复 forms = %v, want %v", got, want)
	}
	if got, want := readingList(fu), []string{"pinyin|fù|fu", "bopomofo|ㄈㄨˋ|ㄈㄨˋ"}; !reflect.DeepEqual(got, want) {
		t.Errorf("复 readings = %v, want %v", got, want)
	}
	if got := lexLinks(t, sqlDB, fu, "variant"); !reflect.DeepEqual(got, []string{"復", "複"}) {
		t.Errorf("复 variants = %v", got)
	}
	if n := countWhere(t, sqlDB, "entries", "ext_key = '好' AND kind = 'character'"); n != 1 {
		t.Errorf("好 character entries = %d, want 1", n)
	}
}

func TestLexiconCedictThenUnihanKeepsReadingsAndForms(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importLexiconPack(t, sqlDB, cedictLexPack(t, lexCedictChars))
	importLexiconPack(t, sqlDB, unihanLexPack(t))
	checkMergedChars(t, sqlDB)
}

func TestLexiconUnihanThenCedictKeepsUnihanSensesAndLinks(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importLexiconPack(t, sqlDB, unihanLexPack(t))
	importLexiconPack(t, sqlDB, cedictLexPack(t, lexCedictChars))
	checkMergedChars(t, sqlDB)
}

func TestLexiconJSONPack(t *testing.T) {
	sqlDB := dbtest.Open(t)
	pack := loadFixture(t)
	res, err := dict.ImportLexicon(context.Background(), sqlDB, &pack)
	if err != nil {
		t.Fatal(err)
	}
	if res.Entries != 2 || res.Senses != 2 {
		t.Errorf("result = %+v, want 2 entries and 2 senses", res)
	}
	nihao := lexByKey(t, sqlDB, "zh", "word", "你好")
	if got, want := formList(nihao), []string{"你好|", "妳好|trad"}; !reflect.DeepEqual(got, want) {
		t.Errorf("你好 forms = %v, want %v", got, want)
	}
	if got, want := readingList(nihao), []string{"pinyin|nǐ hǎo|nihao", "bopomofo|ㄋㄧˇ ㄏㄠˇ|ㄋㄧˇ ㄏㄠˇ"}; !reflect.DeepEqual(got, want) {
		t.Errorf("你好 readings = %v, want %v", got, want)
	}
	if got, want := senseGlosses(t, sqlDB, nihao), []string{"mkgloss: hello/hi"}; !reflect.DeepEqual(got, want) {
		t.Errorf("你好 senses = %v, want %v", got, want)
	}
	hao := lexByKey(t, sqlDB, "zh", "character", "好")
	if got, want := formList(hao), []string{"好|"}; !reflect.DeepEqual(got, want) {
		t.Errorf("好 forms = %v (the trad twin equals it), want %v", got, want)
	}
	byForm, err := lexicon.Store{DB: sqlDB}.ByForm(context.Background(), "zh", []string{"妳好"})
	if err != nil || len(byForm["妳好"]) != 1 || byForm["妳好"][0].Key != "你好" {
		t.Errorf("ByForm(妳好) = %v, %v", byForm, err)
	}
}

func TestLexiconJSONDataOnlyLanguage(t *testing.T) {
	sqlDB := dbtest.Open(t)
	m := dict.Manifest{
		ID: "es-demo", Name: "Demo Spanish dictionary", Version: "1.0", Type: "dictionary", Language: "es",
		License: "CC0", Attribution: "Qinqin test fixtures", Format: "json",
	}
	pack := lexPack(t, m, "dictionary.json", `{"entries": [
		{"written": "Hola", "kind": "word", "readings": [{"type": "latin", "value": "Hola"}], "glosses": ["hello"]}]}`)
	importLexiconPack(t, sqlDB, pack)
	var name string
	if err := sqlDB.QueryRow(`SELECT name FROM languages WHERE code = 'es'`).Scan(&name); err != nil || name != m.Name {
		t.Errorf("es language = %q, %v, want auto-registered %q", name, err, m.Name)
	}
	hola := lexByKey(t, sqlDB, "es", "word", "Hola")
	if got, want := readingList(hola), []string{"latin|Hola|hola"}; !reflect.DeepEqual(got, want) {
		t.Errorf("readings = %v, want %v", got, want)
	}
	if got, want := senseGlosses(t, sqlDB, hola), []string{"es-demo: hello"}; !reflect.DeepEqual(got, want) {
		t.Errorf("senses = %v, want %v", got, want)
	}
}

func TestLexiconJSONInvalidEntryWritesNothing(t *testing.T) {
	sqlDB := dbtest.Open(t)
	m := dict.Manifest{
		ID: "bad-json", Name: "Bad", Version: "1.0", Type: "dictionary", Language: "zh",
		License: "CC0", Attribution: "t", Format: "json",
	}
	pack := lexPack(t, m, "dictionary.json", `{"entries": [
		{"written": "好", "kind": "character", "glosses": ["good"]},
		{"written": "", "kind": "word", "glosses": ["nothing"]}]}`)
	if _, err := dict.ImportLexicon(context.Background(), sqlDB, pack); err == nil {
		t.Fatal("ImportLexicon of an invalid pack succeeded")
	}
	assertNoLexiconRows(t, sqlDB)
}

var zhMiniLexManifest = dict.Manifest{
	ID: "zh-mini-lex", Name: "zh mini", Version: "1.0", Type: "dictionary", Language: "zh",
	License: "CC0", Attribution: "t", Format: "json",
}

const lexMiniJSON = `{"entries": [
	{"written": "行", "kind": "character", "readings": [{"type": "pinyin", "value": "háng"}], "glosses": ["row (mini)"]}]}`

func miniLexPack(t *testing.T, content string) *dict.Pack {
	t.Helper()
	return lexPack(t, zhMiniLexManifest, "dictionary.json", content)
}

var xingReadings = []string{"pinyin|xíng|xing", "pinyin|háng|hang", "bopomofo|ㄒㄧㄥˊ|ㄒㄧㄥˊ", "bopomofo|ㄏㄤˊ|ㄏㄤˊ"}

func TestLexiconMergeJSONAfterCedictKeepsCedictReadings(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importLexiconPack(t, sqlDB, cedictLexPack(t, lexCedict))
	importLexiconPack(t, sqlDB, miniLexPack(t, lexMiniJSON))
	xing := lexByKey(t, sqlDB, "zh", "character", "行")
	if got := readingList(xing); !reflect.DeepEqual(got, xingReadings) {
		t.Errorf("行 readings = %v, want %v", got, xingReadings)
	}
	got := senseGlosses(t, sqlDB, xing)
	slices.Sort(got)
	if want := []string{"cedict-lex: row/line", "cedict-lex: to walk/to go", "zh-mini-lex: row (mini)"}; !reflect.DeepEqual(got, want) {
		t.Errorf("行 senses = %v, want %v", got, want)
	}
}

func TestLexiconMergeCedictAfterJSONOwnsReadings(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importLexiconPack(t, sqlDB, miniLexPack(t, lexMiniJSON))
	importLexiconPack(t, sqlDB, cedictLexPack(t, lexCedict))
	xing := lexByKey(t, sqlDB, "zh", "character", "行")
	if got := readingList(xing); !reflect.DeepEqual(got, xingReadings) {
		t.Errorf("行 readings = %v, want CEDICT's %v", got, xingReadings)
	}
	got := senseGlosses(t, sqlDB, xing)
	slices.Sort(got)
	if want := []string{"cedict-lex: row/line", "cedict-lex: to walk/to go", "zh-mini-lex: row (mini)"}; !reflect.DeepEqual(got, want) {
		t.Errorf("行 senses = %v, want %v", got, want)
	}
}

func TestLexiconMergeJSONDuplicateWrittenInOnePack(t *testing.T) {
	sqlDB := dbtest.Open(t)
	res := importLexiconPack(t, sqlDB, miniLexPack(t, `{"entries": [
		{"written": "行", "kind": "character", "readings": [{"type": "pinyin", "value": "xíng"}], "glosses": ["to walk"]},
		{"written": "行", "kind": "character", "readings": [{"type": "pinyin", "value": "háng"}], "glosses": ["row"]},
		{"written": "好", "kind": "character", "glosses": ["good"]}]}`))
	// Entries counts distinct lexicon entries, not entry lines.
	if res.Entries != 2 || res.Senses != 3 {
		t.Errorf("result = %+v, want 2 entries, 3 senses", res)
	}
	xing := lexByKey(t, sqlDB, "zh", "character", "行")
	// JSON lines carry their derived bopomofo right after their own pinyin.
	if got, want := readingList(xing), []string{"pinyin|xíng|xing", "bopomofo|ㄒㄧㄥˊ|ㄒㄧㄥˊ", "pinyin|háng|hang", "bopomofo|ㄏㄤˊ|ㄏㄤˊ"}; !reflect.DeepEqual(got, want) {
		t.Errorf("行 readings = %v, want %v", got, want)
	}
	if got, want := senseGlosses(t, sqlDB, xing), []string{"zh-mini-lex: to walk", "zh-mini-lex: row"}; !reflect.DeepEqual(got, want) {
		t.Errorf("行 senses = %v, want %v", got, want)
	}
}

func lexiconCounts(t *testing.T, sqlDB *sql.DB) map[string]int {
	t.Helper()
	m := map[string]int{}
	for _, table := range []string{"entries", "forms", "readings", "senses", "entry_links"} {
		m[table] = totalRows(t, sqlDB, table)
	}
	return m
}

func TestLexiconReimportsWriteNothing(t *testing.T) {
	packs := map[string]func(*testing.T) *dict.Pack{
		"cedict":    func(t *testing.T) *dict.Pack { return cedictLexPack(t, lexCedict+lexCedictChars) },
		"json":      func(t *testing.T) *dict.Pack { return miniLexPack(t, lexMiniJSON) },
		"unihan":    func(t *testing.T) *dict.Pack { return unihanLexPack(t) },
		"kanjidic2": func(t *testing.T) *dict.Pack { return kanjidicLexPack(t, "") },
	}
	// Each case imports its packs in order, backdates every row, then
	// runs the last pack again.
	for name, order := range map[string][]string{
		"cedict":              {"cedict"},
		"json":                {"json"},
		"unihan after cedict": {"cedict", "unihan"},
		"cedict after unihan": {"unihan", "cedict"},
		"unihan":              {"unihan"},
		"json after cedict":   {"cedict", "json"},
		"kanjidic2":           {"kanjidic2"},
	} {
		t.Run(name, func(t *testing.T) {
			sqlDB := dbtest.Open(t)
			for _, id := range order {
				importLexiconPack(t, sqlDB, packs[id](t))
			}
			// dictionaries too: an unchanged pack restamps no registry row.
			tables := []string{"entries", "forms", "readings", "senses", "entry_links", "dictionaries"}
			for _, table := range tables {
				if _, err := sqlDB.Exec(`UPDATE ` + table + ` SET updated_at = '` + longAgo + `'`); err != nil {
					t.Fatalf("backdate %s: %v", table, err)
				}
			}
			before := map[string]int{}
			for _, table := range tables {
				before[table] = totalRows(t, sqlDB, table)
			}
			importLexiconPack(t, sqlDB, packs[order[len(order)-1]](t))
			for _, table := range tables {
				if n := countWhere(t, sqlDB, table, `updated_at > '2021-01-01T00:00:00Z'`); n != 0 {
					t.Errorf("%s: %d rows written by an identical re-import", table, n)
				}
				if got := totalRows(t, sqlDB, table); got != before[table] {
					t.Errorf("%s rows %d -> %d", table, before[table], got)
				}
			}
		})
	}
}

// A changed manifest or an uninstalled dictionary still writes the
// registry row: only an identical re-import skips it.
func TestLexiconReimportUpdatesChangedDictionaryRow(t *testing.T) {
	sqlDB := dbtest.Open(t)
	importLexiconPack(t, sqlDB, miniLexPack(t, lexMiniJSON))
	var id int64
	if err := sqlDB.QueryRow(`SELECT id FROM dictionaries WHERE pack_id = 'zh-mini-lex'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := sqlDB.Exec(`UPDATE dictionaries SET updated_at = '` + longAgo + `'`); err != nil {
		t.Fatal(err)
	}
	m := zhMiniLexManifest
	m.Version = "2.0"
	importLexiconPack(t, sqlDB, lexPack(t, m, "dictionary.json", lexMiniJSON))
	var version, stamp string
	var gotID int64
	if err := sqlDB.QueryRow(`SELECT id, version, updated_at FROM dictionaries WHERE pack_id = 'zh-mini-lex'`).Scan(&gotID, &version, &stamp); err != nil {
		t.Fatal(err)
	}
	if gotID != id || version != "2.0" || stamp == longAgo {
		t.Errorf("after a version bump: id %d version %s updated_at %s, want id %d, 2.0, restamped", gotID, version, stamp, id)
	}
	if err := dict.Uninstall(context.Background(), sqlDB, id); err != nil {
		t.Fatal(err)
	}
	importLexiconPack(t, sqlDB, lexPack(t, m, "dictionary.json", lexMiniJSON))
	var deleted sql.NullString
	if err := sqlDB.QueryRow(`SELECT deleted_at FROM dictionaries WHERE id = ?`, id).Scan(&deleted); err != nil || deleted.Valid {
		t.Errorf("re-import after uninstall: deleted_at = %v, %v; want revived", deleted, err)
	}
}
