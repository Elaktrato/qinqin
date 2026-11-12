package segment_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"qinqin/internal/db"
	"qinqin/internal/dict"
	"qinqin/internal/entries"
	"qinqin/internal/lang"
	"qinqin/internal/segment"
)

// jmEntry is one word of the in-test JMdict: its kanji forms (none for a
// kana-only word) and its kana readings, in document order, plus the
// ranking data the real file carries: priority tags per kanji form
// (<ke_pri>) and per reading (<re_pri>), an info flag per kanji form
// (<ke_inf>, an entity name such as "rK"), and whether a sense is
// tagged uk (<misc>&uk;</misc>).
type jmEntry struct {
	kanji    []string
	readings []string
	kpri     map[string][]string
	kinf     map[string]string
	rpri     map[string][]string
	uk       bool
}

// importJMdict runs the real JMdict importer on a JMdict XML built from
// words and returns a segment service over the result, so the entries
// have exactly the shape production data has: written under the kanji
// forms, the kana only as readings (unless the word has no kanji form).
func importJMdict(t *testing.T, words []jmEntry) (segment.Service, entries.Store) {
	t.Helper()
	lang.Register(lang.Ja{})
	ctx := context.Background()
	sqlDB, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { sqlDB.Close() })

	var b strings.Builder
	b.WriteString("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
		"<!DOCTYPE JMdict [\n<!ENTITY uk \"word usually written using kana alone\">\n" +
		"<!ENTITY rK \"rarely used kanji form\">\n]>\n<JMdict>\n")
	for i, w := range words {
		b.WriteString("<entry>\n")
		b.WriteString("<ent_seq>" + itoa(1000000+i) + "</ent_seq>\n")
		for _, k := range w.kanji {
			b.WriteString("<k_ele><keb>" + k + "</keb>")
			if inf := w.kinf[k]; inf != "" {
				b.WriteString("<ke_inf>&" + inf + ";</ke_inf>")
			}
			for _, p := range w.kpri[k] {
				b.WriteString("<ke_pri>" + p + "</ke_pri>")
			}
			b.WriteString("</k_ele>\n")
		}
		for _, r := range w.readings {
			b.WriteString("<r_ele><reb>" + r + "</reb>")
			for _, p := range w.rpri[r] {
				b.WriteString("<re_pri>" + p + "</re_pri>")
			}
			b.WriteString("</r_ele>\n")
		}
		b.WriteString("<sense>")
		if w.uk {
			b.WriteString("<misc>&uk;</misc>")
		}
		b.WriteString("<gloss>gloss " + itoa(i) + "</gloss></sense>\n</entry>\n")
	}
	b.WriteString("</JMdict>\n")

	dir := t.TempDir()
	manifest, err := json.Marshal(dict.Manifest{
		ID: "jmdict-test", Name: "JMdict test", Version: "1", Type: "dictionary",
		Language: "ja", License: "CC BY-SA 4.0", Attribution: "EDRDG", Format: "jmdict",
	})
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "jmdict.xml"), []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	pack, err := dict.LoadPack(dir)
	if err != nil {
		t.Fatalf("LoadPack: %v", err)
	}
	if _, err := dict.Import(ctx, sqlDB, pack); err != nil {
		t.Fatalf("Import: %v", err)
	}
	st := entries.Store{DB: sqlDB}
	return segment.Service{Entries: st}, st
}

func itoa(n int) string { return strconv.Itoa(n) }

// jmFixture is a tiny JMdict in the shape of the real one, its ranking
// tags copied from the real entries (trimmed). The order matters: the
// words that should NOT rank first come first in the file, so their
// entry ids are lower and an id order would pick them.
var jmFixture = []jmEntry{
	// する: 為る is usually written in kana (uk), so it ranks first —
	// though, as in the real file, its kanji form is rK (no penalty for a
	// uk word) and 擦る is uk too through a homograph (擦る/こする), which
	// leaves the two tied at ichi1: する is 為る's first reading.
	{kanji: []string{"擦る"}, readings: []string{"こする", "する"}, kpri: map[string][]string{"擦る": {"ichi1"}}}, // する is its second reading
	{kanji: []string{"擦る"}, readings: []string{"こする"}, uk: true},
	{kanji: []string{"刷る"}, readings: []string{"する"}, kpri: map[string][]string{"刷る": {"news2", "nf30"}}},
	{kanji: []string{"為る"}, readings: []string{"する"}, kinf: map[string]string{"為る": "rK"}, rpri: map[string][]string{"する": {"ichi1"}}, uk: true},
	{kanji: []string{"来る"}, readings: []string{"くる"}},
	// こと: 琴 is common, but 事 is uk.
	{kanji: []string{"琴"}, readings: []string{"こと"}, kpri: map[string][]string{"琴": {"ichi1", "news1", "nf05"}}},
	{kanji: []string{"事"}, readings: []string{"こと"}, kpri: map[string][]string{"事": {"ichi1", "news1", "nf08"}}, uk: true},
	{kanji: []string{"林檎"}, readings: []string{"りんご"}},
	{kanji: []string{"食べる"}, readings: []string{"たべる"}},
	{readings: []string{"これ"}}, // kana-only word: written これ
	// A homophone written in kanji, ranked as high as it gets: the
	// written-form hit これ still wins.
	{kanji: []string{"此れ"}, readings: []string{"これ"}, kpri: map[string][]string{"此れ": {"nf01"}}, uk: true},
	// いる: 射る and 入る are not uk; 居る (rK, ichi1 kana) is uk and shares
	// its form with the common 居る read おる; 要る is uk but less common.
	{kanji: []string{"射る"}, readings: []string{"いる"}, kpri: map[string][]string{"射る": {"news2", "nf26", "spec2"}}},
	{kanji: []string{"入る"}, readings: []string{"はいる", "いる"}, kpri: map[string][]string{"入る": {"ichi1", "news1", "nf05"}}},
	{kanji: []string{"要る"}, readings: []string{"いる"}, kpri: map[string][]string{"要る": {"news2", "nf27", "spec1"}}, uk: true},
	{kanji: []string{"居る"}, readings: []string{"いる"}, kinf: map[string]string{"居る": "rK"}, rpri: map[string][]string{"いる": {"ichi1"}}, uk: true},
	{kanji: []string{"居る"}, readings: []string{"おる"}, kpri: map[string][]string{"居る": {"ichi1", "news1", "nf19"}}, uk: true},
	// ある: 或る (uk, nf37) comes first in the file; 有る/在る (uk, nf05
	// on the kana) rank above it.
	{kanji: []string{"或る", "或"}, readings: []string{"ある"}, kpri: map[string][]string{"或る": {"news2", "nf37"}, "或": {"ichi1"}}, rpri: map[string][]string{"ある": {"ichi1", "news2", "nf37"}}, uk: true},
	{kanji: []string{"有る", "在る"}, readings: []string{"ある"}, kpri: map[string][]string{"有る": {"news1", "nf23", "spec1"}, "在る": {"ichi1", "news1", "nf05"}}, rpri: map[string][]string{"ある": {"ichi1", "news1", "nf05"}}, uk: true},
	// Homographs, as in the real JMdict: 為る is also a form of 成る (なる)
	// and 林檎 also a rare word read りゅうごう. Their readings merge, so
	// する and りんご still find 為る and 林檎.
	{kanji: []string{"成る", "為る"}, readings: []string{"なる"}},
	{kanji: []string{"林檎"}, readings: []string{"りゅうごう"}},
}

// writtenOf returns the written form of every candidate of m, in order.
func writtenOf(t *testing.T, st entries.Store, m *segment.Match) []string {
	t.Helper()
	var out []string
	for _, c := range m.Entries {
		e, err := st.GetByID(context.Background(), c.ID)
		if err != nil {
			t.Fatalf("GetByID(%d): %v", c.ID, err)
		}
		out = append(out, e.Written)
	}
	return out
}

func TestMatchAtKanaByReading(t *testing.T) {
	svc, st := importJMdict(t, jmFixture)
	ctx := context.Background()

	m, err := svc.MatchAt(ctx, "ja", "する", 0)
	if err != nil || m == nil {
		t.Fatalf("MatchAt(する) = %v, %v", m, err)
	}
	if m.Surface != "する" || m.Lemma != "する" || m.Reason != "" || m.End != 2 {
		t.Errorf("match = %+v, want する 0..2", m)
	}
	// 為る and 擦る are both scored uk (擦る only because uk spreads
	// through its homograph 擦る/こする) and tie at ichi1; 為る wins on
	// reading position (する is 擦る's second reading). 刷る is not uk.
	if got := strings.Join(writtenOf(t, st, m), ","); got != "為る,擦る,刷る" {
		t.Errorf("candidates = %s, want 為る,擦る,刷る", got)
	}
	for _, c := range m.Entries {
		if !c.Reading || c.Kind != "word" {
			t.Errorf("candidate %+v, want a reading word candidate", c)
		}
	}

	// Katakana folds to the hiragana plain form.
	m, err = svc.MatchAt(ctx, "ja", "リンゴを食べた", 0)
	if err != nil || m == nil || m.Surface != "リンゴ" {
		t.Fatalf("MatchAt(リンゴ) = %+v, %v", m, err)
	}
	if got := strings.Join(writtenOf(t, st, m), ","); got != "林檎" {
		t.Errorf("リンゴ candidates = %s, want 林檎", got)
	}
	m, err = svc.MatchAt(ctx, "ja", "りんご", 0)
	if err != nil || m == nil || strings.Join(writtenOf(t, st, m), ",") != "林檎" {
		t.Errorf("MatchAt(りんご) = %+v, %v, want 林檎", m, err)
	}

	m, err = svc.MatchAt(ctx, "ja", "ことを", 0)
	if err != nil || m == nil || m.Surface != "こと" || m.Start != 0 || m.End != 2 {
		t.Fatalf("MatchAt(ことを) = %+v, %v, want こと 0..2", m, err)
	}
	if got := strings.Join(writtenOf(t, st, m), ","); got != "事,琴" {
		t.Errorf("こと candidates = %s, want 事,琴", got)
	}
}

// Kana-only surfaces rank their reading candidates the way a reader
// expects: usually-kana (uk) words first, then by JMdict priority, then
// reading position and entry id — not by file order.
func TestMatchAtKanaRanksByUkAndPriority(t *testing.T) {
	svc, st := importJMdict(t, jmFixture)
	for _, c := range []struct{ text, want string }{
		// 居る (uk; its form shared with 居る/おる, nf19) before 要る (uk,
		// spec1), then 入る (nf05) before 射る (nf26).
		{"いる", "居る,要る,入る,射る"},
		{"する", "為る,擦る,刷る"},
		{"こと", "事,琴"},
		// 有る and 在る share the kana's nf05 (ties by entry id); 或る and
		// 或 (ichi1/nf37) follow, though their word comes first in the file.
		{"ある", "有る,在る,或る,或"},
	} {
		m, err := svc.MatchAt(context.Background(), "ja", c.text, 0)
		if err != nil || m == nil {
			t.Errorf("MatchAt(%s) = %v, %v", c.text, m, err)
			continue
		}
		if got := strings.Join(writtenOf(t, st, m), ","); got != c.want {
			t.Errorf("%s candidates = %s, want %s", c.text, got, c.want)
		}
	}
}

// A rare kanji form (rK) of a word loses to the word's common form, even
// when it comes first in the file and so has the lower entry id.
func TestMatchAtRareKanjiFormRanksBelowCommonForm(t *testing.T) {
	svc, st := importJMdict(t, []jmEntry{{
		kanji:    []string{"熬る", "煎る"},
		readings: []string{"いる"},
		kinf:     map[string]string{"熬る": "rK"},
		kpri:     map[string][]string{"熬る": {"news2"}, "煎る": {"news2"}},
	}})
	m, err := svc.MatchAt(context.Background(), "ja", "いる", 0)
	if err != nil || m == nil {
		t.Fatalf("MatchAt(いる) = %v, %v", m, err)
	}
	if got := strings.Join(writtenOf(t, st, m), ","); got != "煎る,熬る" {
		t.Errorf("candidates = %s, want 煎る,熬る (the rK form last)", got)
	}
}

func TestMatchAtKanaDeinflectedByReading(t *testing.T) {
	svc, st := importJMdict(t, jmFixture)
	for _, c := range []struct{ text, surface, lemma, reason, first string }{
		{"した", "した", "する", "past", "為る"},
		{"しない", "しない", "する", "negative", "為る"},
		{"きて", "きて", "くる", "te-form", "来る"},
		{"来ました", "来ました", "来る", "polite past", "来る"},
		{"たべた", "たべた", "たべる", "past", "食べる"},
		{"食べた", "食べた", "食べる", "past", "食べる"},
	} {
		m, err := svc.MatchAt(context.Background(), "ja", c.text, 0)
		if err != nil || m == nil {
			t.Errorf("MatchAt(%q) = %v, %v", c.text, m, err)
			continue
		}
		if m.Surface != c.surface || m.Lemma != c.lemma || m.Reason != c.reason {
			t.Errorf("MatchAt(%q) = %+v, want %s -> %s (%s)", c.text, m, c.surface, c.lemma, c.reason)
		}
		if ws := writtenOf(t, st, m); len(ws) == 0 || ws[0] != c.first {
			t.Errorf("MatchAt(%q) candidates = %v, want %s first", c.text, ws, c.first)
		}
	}
}

func TestMatchAtWrittenBeatsReading(t *testing.T) {
	svc, st := importJMdict(t, jmFixture)
	m, err := svc.MatchAt(context.Background(), "ja", "これは", 0)
	if err != nil || m == nil || m.Surface != "これ" {
		t.Fatalf("MatchAt(これは) = %+v, %v", m, err)
	}
	// The kana-only word written これ wins over 此れ, read これ.
	if got := strings.Join(writtenOf(t, st, m), ","); got != "これ" {
		t.Errorf("candidates = %s, want only the written これ", got)
	}
	if m.Entries[0].Reading {
		t.Errorf("candidate %+v matched by written form, want reading=false", m.Entries[0])
	}
}

func TestMatchAtReadingCandidatesCapped(t *testing.T) {
	var words []jmEntry
	for _, k := range []string{"間", "感", "缶", "館", "巻", "官", "管", "簡", "観", "寒"} {
		words = append(words, jmEntry{kanji: []string{k}, readings: []string{"かん"}})
	}
	svc, st := importJMdict(t, words)
	m, err := svc.MatchAt(context.Background(), "ja", "かん", 0)
	if err != nil || m == nil {
		t.Fatalf("MatchAt(かん) = %v, %v", m, err)
	}
	if got := strings.Join(writtenOf(t, st, m), ","); got != "間,感,缶,館,巻,官,管,簡" {
		t.Errorf("candidates = %s, want the first 8 by entry id", got)
	}
}

// The cap applies after ranking: the best 8 survive, not the first 8 in
// the file.
func TestMatchAtReadingCapAppliesAfterRanking(t *testing.T) {
	var words []jmEntry
	for _, k := range []string{"間", "感", "缶", "館", "巻", "官", "管", "簡", "観", "寒"} {
		words = append(words, jmEntry{kanji: []string{k}, readings: []string{"かん"}})
	}
	words[8].kpri = map[string][]string{"観": {"news1"}} // 9th in the file
	words[9].uk = true                                  // 10th: uk and scored
	words[9].kpri = map[string][]string{"寒": {"news2"}}
	svc, st := importJMdict(t, words)
	m, err := svc.MatchAt(context.Background(), "ja", "かん", 0)
	if err != nil || m == nil {
		t.Fatalf("MatchAt(かん) = %v, %v", m, err)
	}
	if got := strings.Join(writtenOf(t, st, m), ","); got != "寒,観,間,感,缶,館,巻,官" {
		t.Errorf("candidates = %s, want 寒 (uk, news2), 観 (news1), then the first 6 by entry id", got)
	}
}

func TestMatchAtReadingIsJapaneseOnly(t *testing.T) {
	svc, _ := importJMdict(t, jmFixture)
	// The same kana in zh text finds nothing: zh matches written forms only.
	m, err := svc.MatchAt(context.Background(), "zh", "する", 0)
	if err != nil || m != nil {
		t.Errorf("MatchAt(zh, する) = %+v, %v, want nil", m, err)
	}
}

func TestReadingLookupUsesPlainIndex(t *testing.T) {
	_, st := importJMdict(t, jmFixture)
	// The shape of EntriesByReading's query: the ranking attrs join by
	// entry_attrs' primary key, so neither join scans.
	rows, err := st.DB.Query(`EXPLAIN QUERY PLAN
		SELECT r.plain, e.id FROM readings r JOIN entries e ON e.id = r.entry_id
		LEFT JOIN entry_attrs uk ON uk.entry_id = e.id AND uk.key = 'jmdict.uk'
		LEFT JOIN entry_attrs pri ON pri.entry_id = e.id AND pri.key = 'jmdict.pri'
		WHERE e.language = 'ja' AND e.deleted_at IS NULL AND r.deleted_at IS NULL
		  AND r.type = 'kana' AND r.plain IN ('する', 'こと')
		GROUP BY r.plain, e.id
		ORDER BY r.plain,
		         MAX(uk.value IS NOT NULL AND COALESCE(CAST(pri.value AS INTEGER), 0) > 0) DESC,
		         MAX(COALESCE(CAST(pri.value AS INTEGER), 0)) DESC, MIN(r.ord), e.id`)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	defer rows.Close()
	var plan []string
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		plan = append(plan, detail)
	}
	joined := strings.Join(plan, "\n")
	if !strings.Contains(joined, "idx_readings_plain") {
		t.Errorf("plan = %q, want it to use idx_readings_plain", plan)
	}
	for _, p := range plan {
		if strings.HasPrefix(p, "SCAN") && !strings.Contains(p, "USING") {
			t.Errorf("plan step %q scans a table", p)
		}
	}
	if strings.Count(joined, "sqlite_autoindex_entry_attrs_1") != 2 {
		t.Errorf("plan = %q, want both attr joins by entry_attrs' primary key", plan)
	}
}
