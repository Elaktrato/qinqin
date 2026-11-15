package audio_test

import (
	"context"
	"testing"

	"qinqin/internal/audio"
	"qinqin/internal/dict"
)

func TestResolveJapaneseTermByKatakanaReading(t *testing.T) {
	ctx, sqlDB, store := context.Background(), newDB(t), t.TempDir()
	p := makePack(t, "ja1", "ja", "CC BY 4.0", []string{"term\t風\tかぜ\taudio/a.opus\t\t\t"}, []clipFile{{"a.opus", oggClip("a")}})
	if _, err := audio.Import(ctx, sqlDB, p, store); err != nil {
		t.Fatal(err)
	}
	r, err := audio.Resolve(ctx, sqlDB, "ja", "風", []string{"カゼ"})
	if err != nil || len(r.Terms) != 1 {
		t.Fatalf("Resolve = %+v, %v", r, err)
	}
	c := r.Terms[0]
	if c.PackID != "ja1" || c.Ext != "opus" || len(c.SHA) != 64 || c.License != "CC BY 4.0" || c.Attribution != "Tester" {
		t.Errorf("clip = %+v", c)
	}
	if r.Syllables != nil {
		t.Errorf("ja Syllables = %v, want nil", r.Syllables)
	}
	if r, _ := audio.Resolve(ctx, sqlDB, "ja", "風", []string{"ふう"}); len(r.Terms) != 0 {
		t.Errorf("other reading matched: %+v", r.Terms)
	}
	if r, _ := audio.Resolve(ctx, sqlDB, "ja", "風", nil); len(r.Terms) != 0 {
		t.Errorf("no readings matched: %+v", r.Terms)
	}
}

func TestResolveChineseTermAndSyllables(t *testing.T) {
	ctx, sqlDB, store := context.Background(), newDB(t), t.TempDir()
	p := makePack(t, "zh1", "zh", "CC0", []string{
		"term\t你好\tni3 hao3\taudio/t.ogg\t\t\t",
		"syllable\t\tni3\taudio/n.ogg\t\t\t",
		"syllable\t\thao3\taudio/h.ogg\t\t\t",
		"syllable\t\txing2\taudio/x.ogg\t\t\t",
		"syllable\t\thang2\taudio/g.ogg\t\t\t",
		"syllable\t\tni1\taudio/n1.ogg\t\t\t",
	}, []clipFile{{"t.ogg", oggClip("t")}, {"n.ogg", oggClip("n")}, {"h.ogg", oggClip("h")},
		{"x.ogg", oggClip("x")}, {"g.ogg", oggClip("g")}, {"n1.ogg", oggClip("n1")}})
	if _, err := audio.Import(ctx, sqlDB, p, store); err != nil {
		t.Fatal(err)
	}
	r, err := audio.Resolve(ctx, sqlDB, "zh", "你好", []string{"nǐ hǎo"})
	if err != nil || len(r.Terms) != 1 || len(r.Syllables) != 1 || len(r.Syllables[0]) != 2 {
		t.Fatalf("Resolve = %+v, %v", r, err)
	}
	// In order: ni3 then hao3.
	n, _ := audio.Resolve(ctx, sqlDB, "zh", "x", []string{"nǐ"})
	h, _ := audio.Resolve(ctx, sqlDB, "zh", "x", []string{"hǎo"})
	if r.Syllables[0][0] != n.Syllables[0][0] || r.Syllables[0][1] != h.Syllables[0][0] {
		t.Errorf("syllable order wrong: %+v", r.Syllables[0])
	}

	// No term clip: syllables only. One missing syllable: nil.
	r, _ = audio.Resolve(ctx, sqlDB, "zh", "好你", []string{"hǎo nǐ"})
	if len(r.Terms) != 0 || len(r.Syllables) != 1 || len(r.Syllables[0]) != 2 {
		t.Errorf("syllables only = %+v", r)
	}
	r, _ = audio.Resolve(ctx, sqlDB, "zh", "你们", []string{"nǐ men"})
	if len(r.Syllables) != 1 || r.Syllables[0] != nil {
		t.Errorf("incomplete = %+v, want [nil]", r.Syllables)
	}

	// Polyphonic character: one sequence per reading, aligned.
	r, _ = audio.Resolve(ctx, sqlDB, "zh", "行", []string{"xíng", "háng"})
	if len(r.Syllables) != 2 || len(r.Syllables[0]) != 1 || len(r.Syllables[1]) != 1 || r.Syllables[0][0] == r.Syllables[1][0] {
		t.Errorf("polyphonic = %+v", r.Syllables)
	}
	// An unparsable reading gives nil for that slot only.
	r, _ = audio.Resolve(ctx, sqlDB, "zh", "行", []string{"???", "xíng"})
	if len(r.Syllables) != 2 || r.Syllables[0] != nil || len(r.Syllables[1]) != 1 {
		t.Errorf("unparsable = %+v", r.Syllables)
	}
}

func TestResolveKeepsPackImportOrder(t *testing.T) {
	ctx, sqlDB, store := context.Background(), newDB(t), t.TempDir()
	row := []string{"term\t風\tかぜ\taudio/a.opus\t\t\t"}
	for _, id := range []string{"zz-first", "aa-second"} {
		p := makePack(t, id, "ja", "CC0", row, []clipFile{{"a.opus", oggClip(id)}})
		if _, err := audio.Import(ctx, sqlDB, p, store); err != nil {
			t.Fatal(err)
		}
	}
	r, _ := audio.Resolve(ctx, sqlDB, "ja", "風", []string{"かぜ"})
	if len(r.Terms) != 2 || r.Terms[0].PackID != "zz-first" || r.Terms[1].PackID != "aa-second" {
		t.Errorf("order = %+v", r.Terms)
	}
}

// A term row without a reading (a Lingua Libre recording knows only its
// word) matches the form under any reading, after exact-reading rows.
func TestResolveTermWithoutReadingMatchesAnyReading(t *testing.T) {
	ctx, sqlDB, store := context.Background(), newDB(t), t.TempDir()
	loose := makePack(t, "loose", "zh", "CC0", []string{"term\t你好\t\taudio/a.ogg\t\t\t"}, []clipFile{{"a.ogg", oggClip("loose")}})
	exact := makePack(t, "exact", "zh", "CC0", []string{"term\t你好\tnǐ hǎo\taudio/b.ogg\t\t\t"}, []clipFile{{"b.ogg", oggClip("exact")}})
	for _, p := range []dict.Pack{loose, exact} {
		if _, err := audio.Import(ctx, sqlDB, p, store); err != nil {
			t.Fatal(err)
		}
	}
	r, _ := audio.Resolve(ctx, sqlDB, "zh", "你好", []string{"nǐ hǎo"})
	if len(r.Terms) != 2 || r.Terms[0].PackID != "exact" || r.Terms[1].PackID != "loose" {
		t.Errorf("terms = %+v, want exact first, then the reading-less clip", r.Terms)
	}
	r, _ = audio.Resolve(ctx, sqlDB, "zh", "你好", []string{"nì hào"})
	if len(r.Terms) != 1 || r.Terms[0].PackID != "loose" {
		t.Errorf("other reading = %+v, want the reading-less clip only", r.Terms)
	}
	r, _ = audio.Resolve(ctx, sqlDB, "zh", "你好", nil)
	if len(r.Terms) != 1 || r.Terms[0].PackID != "loose" {
		t.Errorf("no readings = %+v, want the reading-less clip", r.Terms)
	}
}

// One request cannot trigger an unbounded number of syllable lookups.
func TestResolveCapsSyllableQueries(t *testing.T) {
	ctx, sqlDB, store := context.Background(), newDB(t), t.TempDir()
	var rows []string
	var readings []string
	for _, ini := range []string{"b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "zh", "ch", "sh", "z", "c", "s"} {
		for tone := 1; tone <= 4; tone++ {
			syl := ini + "a" + string(rune('0'+tone))
			rows = append(rows, "syllable\t\t"+syl+"\taudio/a.ogg\t\t\t")
			readings = append(readings, syl)
		}
	}
	if len(readings) <= audio.MaxSyllableQueries {
		t.Fatalf("fixture has %d readings, need more than the cap %d", len(readings), audio.MaxSyllableQueries)
	}
	p := makePack(t, "z", "zh", "CC0", rows, []clipFile{{"a.ogg", oggClip("a")}})
	if _, err := audio.Import(ctx, sqlDB, p, store); err != nil {
		t.Fatal(err)
	}
	r, err := audio.Resolve(ctx, sqlDB, "zh", "x", readings)
	if err != nil || len(r.Syllables) != len(readings) {
		t.Fatalf("Resolve = %d slots, %v", len(r.Syllables), err)
	}
	found := 0
	for i, seq := range r.Syllables {
		if seq != nil {
			found++
		} else if i < audio.MaxSyllableQueries {
			t.Errorf("slot %d inside the cap is nil", i)
		}
	}
	if found != audio.MaxSyllableQueries {
		t.Errorf("%d slots resolved, want exactly the cap %d", found, audio.MaxSyllableQueries)
	}
	// Repeating a syllable costs one lookup, not one per use.
	same := make([]string, 200)
	for i := range same {
		same[i] = "ba1"
	}
	r, _ = audio.Resolve(ctx, sqlDB, "zh", "x", same)
	for i, seq := range r.Syllables {
		if seq == nil {
			t.Fatalf("repeated syllable: slot %d is nil", i)
		}
	}
}
