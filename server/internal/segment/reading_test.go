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
// kana-only word) and its kana readings, in document order.
type jmEntry struct {
	kanji    []string
	readings []string
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
	b.WriteString("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<JMdict>\n")
	for i, w := range words {
		b.WriteString("<entry>\n")
		b.WriteString("<ent_seq>" + itoa(1000000+i) + "</ent_seq>\n")
		for _, k := range w.kanji {
			b.WriteString("<k_ele><keb>" + k + "</keb></k_ele>\n")
		}
		for _, r := range w.readings {
			b.WriteString("<r_ele><reb>" + r + "</reb></r_ele>\n")
		}
		b.WriteString("<sense><gloss>gloss " + itoa(i) + "</gloss></sense>\n</entry>\n")
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

// jmFixture is a tiny JMdict in the shape of the real one. The order
// matters: 擦る and 刷る come before 為る, so their entry ids are lower.
var jmFixture = []jmEntry{
	{kanji: []string{"擦る"}, readings: []string{"こする", "する"}}, // する is its second reading
	{kanji: []string{"刷る"}, readings: []string{"する"}},
	{kanji: []string{"為る"}, readings: []string{"する"}},
	{kanji: []string{"来る"}, readings: []string{"くる"}},
	{kanji: []string{"事"}, readings: []string{"こと"}},
	{kanji: []string{"林檎"}, readings: []string{"りんご"}},
	{kanji: []string{"食べる"}, readings: []string{"たべる"}},
	{readings: []string{"これ"}},                        // kana-only word: written これ
	{kanji: []string{"此れ"}, readings: []string{"これ"}}, // homophone written in kanji
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
	// First-reading entries first (ties by entry id), then the rest.
	if got := strings.Join(writtenOf(t, st, m), ","); got != "刷る,為る,擦る" {
		t.Errorf("candidates = %s, want 刷る,為る,擦る", got)
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
	if got := strings.Join(writtenOf(t, st, m), ","); got != "事" {
		t.Errorf("こと candidates = %s, want 事", got)
	}
}

func TestMatchAtKanaDeinflectedByReading(t *testing.T) {
	svc, st := importJMdict(t, jmFixture)
	for _, c := range []struct{ text, surface, lemma, reason, first string }{
		{"した", "した", "する", "past", "刷る"},
		{"しない", "しない", "する", "negative", "刷る"},
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
	rows, err := st.DB.Query(`EXPLAIN QUERY PLAN
		SELECT r.plain, e.id FROM readings r JOIN entries e ON e.id = r.entry_id
		WHERE e.language = 'ja' AND e.deleted_at IS NULL AND r.deleted_at IS NULL
		  AND r.type = 'kana' AND r.plain IN ('する', 'こと')`)
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
	if !strings.Contains(strings.Join(plan, "\n"), "idx_readings_plain") {
		t.Errorf("plan = %q, want it to use idx_readings_plain", plan)
	}
}
