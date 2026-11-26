package starter_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"qinqin/internal/lexicon"
	"qinqin/internal/starter"
)

const good = `{"version":1,"id":"starter-xx","language":"xx","name":"N","license":"CC-BY-4.0","attribution":"A","humanReviewed":false,
"words":[{"form":"a","gloss":"g","picture":{"pack":"images-openmoji","concept":"1F34E"}}]}`

func TestParseAcceptsAGoodSet(t *testing.T) {
	s, err := starter.Parse([]byte(good))
	if err != nil {
		t.Fatal(err)
	}
	if s.ID != "starter-xx" || len(s.Words) != 1 || s.Words[0].Picture.Concept != "1F34E" {
		t.Fatalf("parsed %+v", s)
	}
}

func TestParseRefuses(t *testing.T) {
	cases := map[string]string{
		"version":        strings.Replace(good, `"version":1`, `"version":2`, 1),
		"id":             strings.Replace(good, `"starter-xx"`, `"Starter XX"`, 1),
		"language":       strings.Replace(good, `"language":"xx"`, `"language":"x"`, 1),
		"empty name":     strings.Replace(good, `"name":"N"`, `"name":""`, 1),
		"no words":       strings.Replace(good, `"words":[{"form":"a","gloss":"g","picture":{"pack":"images-openmoji","concept":"1F34E"}}]`, `"words":[]`, 1),
		"empty form":     strings.Replace(good, `"form":"a"`, `"form":""`, 1),
		"bad concept":    strings.Replace(good, `"1F34E"`, `"../x"`, 1),
		"no pack":        strings.Replace(good, `"pack":"images-openmoji"`, `"pack":""`, 1),
		"unknown member": strings.Replace(good, `"gloss":"g"`, `"gloss":"g","sense":1`, 1),
		"not json":       "{",
	}
	for name, raw := range cases {
		if _, err := starter.Parse([]byte(raw)); err == nil {
			t.Errorf("%s: parsed, want an error", name)
		}
	}
}

func TestParseRefusesADuplicateWordAndTooManyWords(t *testing.T) {
	word := `{"form":"a","gloss":"g","picture":{"pack":"p","concept":"c"}}`
	dup := strings.Replace(good, `"words":[`, `"words":[`+word+`,`, 1)
	if _, err := starter.Parse([]byte(dup)); err == nil || !strings.Contains(err.Error(), "twice") {
		t.Errorf("duplicate: %v", err)
	}
	var many []string
	for i := 0; i <= starter.MaxWords; i++ {
		many = append(many, fmt.Sprintf(`{"form":"w%d","gloss":"g","picture":{"pack":"p","concept":"c"}}`, i))
	}
	big := strings.Replace(good, `"words":[{"form":"a","gloss":"g","picture":{"pack":"images-openmoji","concept":"1F34E"}}]`, `"words":[`+strings.Join(many, ",")+`]`, 1)
	if _, err := starter.Parse([]byte(big)); err == nil {
		t.Error("more than MaxWords words parsed")
	}
}

type fakeResolver map[string]int64

func (f fakeResolver) BestWordReadingID(_ context.Context, language, form, reading string) (int64, error) {
	if id, ok := f[language+"|"+form+"|"+reading]; ok {
		return id, nil
	}
	return 0, lexicon.ErrNotFound
}

func (f fakeResolver) BestCharacterID(_ context.Context, language, form string) (int64, error) {
	if id, ok := f["char|"+language+"|"+form]; ok {
		return id, nil
	}
	return 0, lexicon.ErrNotFound
}

func TestResolveKeepsOrderAndSkipsMissingAndRepeatedEntries(t *testing.T) {
	s := starter.Set{ID: "s", Language: "ja", Words: []starter.Word{
		{Form: "犬", Reading: "いぬ"}, {Form: "無い"}, {Form: "狗"}, {Form: "猫", Reading: "ねこ"},
	}}
	r := fakeResolver{"ja|犬|いぬ": 10, "ja|狗|": 10, "ja|猫|ねこ": 11}
	got, err := starter.Resolve(context.Background(), r, s)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].EntryID != 10 || got[1].EntryID != 11 || got[1].Word.Form != "猫" {
		t.Fatalf("resolved %+v", got)
	}
}

type failing struct{}

func (failing) BestWordReadingID(context.Context, string, string, string) (int64, error) {
	return 0, errors.New("boom")
}

func (failing) BestCharacterID(context.Context, string, string) (int64, error) {
	return 0, errors.New("boom")
}

// A single hanzi that is not a word falls back to its character entry; a longer form does not.
func TestResolveFallsBackToTheCharacterEntryOfOneHanzi(t *testing.T) {
	s := starter.Set{ID: "s", Language: "zh", Words: []starter.Word{{Form: "狗"}, {Form: "小狗"}}}
	r := fakeResolver{"char|zh|狗": 20, "char|zh|小狗": 21}
	got, err := starter.Resolve(context.Background(), r, s)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].EntryID != 20 || !got[0].Character {
		t.Fatalf("resolved %+v", got)
	}
}

func TestResolveReportsADatabaseError(t *testing.T) {
	s := starter.Set{ID: "s", Language: "ja", Words: []starter.Word{{Form: "犬"}}}
	if _, err := starter.Resolve(context.Background(), failing{}, s); err == nil {
		t.Fatal("want the error")
	}
}

// The shipped sets parse, name their language once, hold the issue's order of size, and every picture they
// promise is in the committed mapping of its images pack (scripts/images/<pack>/map.tsv), so a set never
// lists a word whose picture the mapping does not give.
func TestShippedSets(t *testing.T) {
	sets, err := starter.Sets()
	if err != nil {
		t.Fatal(err)
	}
	if len(sets) < 2 {
		t.Fatalf("%d sets, want one for ja and one for zh", len(sets))
	}
	languages := map[string]bool{}
	for _, s := range sets {
		if languages[s.Language] {
			t.Errorf("two sets for %s", s.Language)
		}
		languages[s.Language] = true
		if s.License == "" || s.Attribution == "" {
			t.Errorf("%s: licence and attribution are required", s.ID)
		}
	}
	for _, want := range []string{"ja", "zh"} {
		if !languages[want] {
			t.Errorf("no set for %s", want)
		}
	}
	for _, s := range sets {
		rows := mappingRows(t, s)
		for _, w := range s.Words {
			target := w.Picture.Target
			if target == "" {
				target = w.Form
			}
			if !rows[s.Language+"\t"+target+"\t"+w.Picture.Concept] {
				t.Errorf("%s: %s: the mapping of %s has no %s row for %s", s.ID, w.Form, w.Picture.Pack, s.Language, target+" -> "+w.Picture.Concept)
			}
		}
	}
}

// mappingRows reads the committed mapping of the set's pictures: language TAB target TAB concept keys.
func mappingRows(t *testing.T, s starter.Set) map[string]bool {
	t.Helper()
	rows := map[string]bool{}
	packs := map[string]bool{}
	for _, w := range s.Words {
		packs[w.Picture.Pack] = true
	}
	for pack := range packs {
		dir := strings.TrimPrefix(pack, "images-")
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "scripts", "images", dir, "map.tsv"))
		if err != nil {
			t.Fatalf("%s: %v", pack, err)
		}
		for i, line := range strings.Split(string(raw), "\n") {
			f := strings.Split(line, "\t")
			if i == 0 || len(f) < 4 {
				continue
			}
			rows[f[0]+"\t"+f[1]+"\t"+f[3]] = true
		}
	}
	return rows
}
