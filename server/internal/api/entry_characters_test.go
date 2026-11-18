package api_test

import (
	"testing"

	"qinqin/internal/dict"
)

const entriesCharacters = "学 学 [xue2] /to learn/\n" +
	"习 习 [xi2] /to practise/\n" +
	"学习 学习 [xue2xi2] /to study/\n"

func TestEntryCharactersChineseWord(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	lookupImport(t, sqlDB, dict.Manifest{
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

func TestEntryCharactersEmpty(t *testing.T) {
	ts, sqlDB := newServer(t)
	seedEntries(t, sqlDB)
	hao := lexID(t, sqlDB, "zh", "character", "好")
	body := getEntryBody(t, ts.URL, hao)
	if body.Characters == nil || len(body.Characters) != 0 {
		t.Errorf("character entry characters = %#v, want []", body.Characters)
	}
}
