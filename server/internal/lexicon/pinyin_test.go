package lexicon_test

import (
	"context"
	"testing"

	"qinqin/internal/lexicon"
)

func TestPinyinLongestMatchThenCharacters(t *testing.T) {
	st := newStore(t)
	dict := addDictionary(t, st, "cedict")
	put := func(kind, key, reading string, pri int, forms ...string) {
		e := &lexicon.Entry{Language: "zh", Kind: kind, Key: key, Pri: pri,
			Readings: []lexicon.Reading{{Type: "pinyin", Value: reading}},
			Senses:   []lexicon.Sense{{Glosses: []string{key}}}}
		for _, f := range forms {
			e.Forms = append(e.Forms, lexicon.Form{Text: f})
		}
		mustPut(t, st, e, dict)
	}
	put("word", "红楼梦", "Hóng lóu mèng", 0, "红楼梦", "紅樓夢")
	put("word", "红楼", "hóng lóu", 0, "红楼")
	put("character", "红", "hóng", 0, "红", "紅")
	put("character", "楼", "lóu", 0, "楼", "樓")
	put("character", "梦", "mèng", 0, "梦", "夢")
	put("character", "曹", "Cáo", 0, "曹")
	put("character", "雪", "xuě", 0, "雪")
	put("character", "芹", "qín", 0, "芹")
	put("character", "女", "nǚ", 0, "女")
	// two entries share a form: the higher priority one decides
	put("character", "行", "háng", 0, "行")
	put("word", "行", "xíng", 5, "行")
	// a Japanese entry with the same form never answers
	if _, err := st.Put(context.Background(), &lexicon.Entry{Language: "ja", Kind: "word", Key: "梦x",
		Forms: []lexicon.Form{{Text: "梦"}}, Readings: []lexicon.Reading{{Type: "pinyin", Value: "yume"}}}, dict); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	for in, want := range map[string]string{
		"红楼梦":          "hong lou meng",
		"紅樓夢":          "hong lou meng",
		"《红楼梦》第1回":     "hong lou meng", // unknown characters and punctuation drop
		"梦红楼":          "meng hong lou",
		"曹, 雪芹":        "cao xue qin",
		"女":            "nv",
		"行":            "xing",
		"Dream of Red": "",
		"":             "",
	} {
		got, err := st.Pinyin(ctx, in)
		if err != nil || got != want {
			t.Errorf("Pinyin(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
}
