package audio_test

import (
	"context"
	"testing"

	"qinqin/internal/audio"
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
